import { query, sql } from "@/db/client";
import { AppError } from "@/lib/errors";
import { ACCESS_MAX_AGE, REFRESH_MAX_AGE } from "../cookies";
import { generateToken, hashToken } from "../internal/session-token";
import type {
	AuthTokens,
	PublicAccount,
	PublicTenant,
	PublicUser,
	TenantMemberRow,
} from "../types";
import { toPublicTenant, toPublicUser } from "../types";

export const listActiveTenants = async (
	accountId: string,
): Promise<TenantMemberRow[]> => {
	return query<TenantMemberRow>(
		accountId,
		null,
		sql`
			SELECT
				t.id AS tenant_id,
				t.tenant_key,
				t.name AS tenant_name,
				t.avatar AS tenant_avatar,
				u.id AS user_id,
				u.name AS user_name,
				u.avatar AS user_avatar,
				u.status AS user_status
			FROM "user" u
			INNER JOIN tenant t ON t.id = u.tenant_id
			WHERE u.account_id = ${accountId}
				AND u.status = 1
				AND u.delete_time IS NULL
				AND t.status = 1
				AND t.delete_time IS NULL
			ORDER BY u.join_time NULLS LAST, u.create_time
		`,
	);
};

const loadActiveMember = async (
	accountId: string,
	tenantId: string,
): Promise<TenantMemberRow | null> => {
	const rows = await query<TenantMemberRow>(
		accountId,
		tenantId,
		sql`
			SELECT
				t.id AS tenant_id,
				t.tenant_key,
				t.name AS tenant_name,
				t.avatar AS tenant_avatar,
				u.id AS user_id,
				u.name AS user_name,
				u.avatar AS user_avatar,
				u.status AS user_status
			FROM "user" u
			INNER JOIN tenant t ON t.id = u.tenant_id
			WHERE u.account_id = ${accountId}
				AND u.tenant_id = ${tenantId}
				AND u.status = 1
				AND u.delete_time IS NULL
				AND t.status = 1
				AND t.delete_time IS NULL
			LIMIT 1
		`,
	);
	return rows[0] ?? null;
};

export const createSession = async (params: {
	accountId: string;
	tenantId: string | null;
	ip?: string | null;
	userAgent?: string | null;
}): Promise<AuthTokens & { sessionId: string }> => {
	const accessToken = generateToken();
	const refreshToken = generateToken();
	const expireTime = new Date(Date.now() + ACCESS_MAX_AGE * 1000);
	const refreshExpireTime = new Date(Date.now() + REFRESH_MAX_AGE * 1000);

	const rows = await sql`
		INSERT INTO session (
			account_id,
			tenant_id,
			token_hash,
			refresh_hash,
			expire_time,
			refresh_expire_time,
			ip,
			user_agent
		) VALUES (
			${params.accountId},
			${params.tenantId},
			${hashToken(accessToken)},
			${hashToken(refreshToken)},
			${expireTime.toISOString()},
			${refreshExpireTime.toISOString()},
			${params.ip ?? null},
			${params.userAgent ?? null}
		)
		RETURNING id
	`;

	const session = rows[0] as { id: string } | undefined;
	if (!session) {
		throw new AppError(500, "创建会话失败");
	}

	return {
		sessionId: session.id,
		accessToken,
		refreshToken,
		expiresAt: expireTime.toISOString(),
	};
};

export const logout = async (sessionId: string): Promise<{ ok: true }> => {
	await sql`
		UPDATE session
		SET revoke_time = now()
		WHERE id = ${sessionId} AND revoke_time IS NULL
	`;
	return { ok: true };
};

export const logoutByTokens = async (params: {
	accessToken?: string | null;
	refreshToken?: string | null;
}): Promise<{ ok: true }> => {
	const tokenHash = params.accessToken ? hashToken(params.accessToken) : null;
	const refreshHash = params.refreshToken
		? hashToken(params.refreshToken)
		: null;
	if (tokenHash || refreshHash) {
		await sql`
			UPDATE session
			SET revoke_time = now()
			WHERE revoke_time IS NULL
				AND (
					(${tokenHash}::text IS NOT NULL AND token_hash = ${tokenHash})
					OR
					(${refreshHash}::text IS NOT NULL AND refresh_hash = ${refreshHash})
				)
		`;
	}
	return { ok: true };
};

export const refresh = async (
	refreshToken: string,
): Promise<
	AuthTokens & {
		account: PublicAccount;
		tenant: PublicTenant | null;
		user: PublicUser | null;
	}
> => {
	const refreshHash = hashToken(refreshToken);
	const rows = await sql`
		SELECT
			s.account_id,
			s.tenant_id,
			a.status AS account_status,
			a.name,
			a.avatar,
			a.locale,
			a.timezone
		FROM session s
		INNER JOIN account a ON a.id = s.account_id
		WHERE s.refresh_hash = ${refreshHash}
			AND s.revoke_time IS NULL
			AND s.refresh_expire_time IS NOT NULL
			AND s.refresh_expire_time > now()
			AND a.delete_time IS NULL
		LIMIT 1
	`;

	const current = rows[0] as
		| {
				account_id: string;
				tenant_id: string | null;
				account_status: number;
				name: string | null;
				avatar: string | null;
				locale: string;
				timezone: string;
		  }
		| undefined;

	if (!current) {
		throw new AppError(401, "刷新令牌无效或已过期");
	}
	if (current.account_status !== 1) {
		throw new AppError(403, "账号不可用");
	}

	let tenantId: string | null = null;
	let tenant: PublicTenant | null = null;
	let user: PublicUser | null = null;
	if (current.tenant_id) {
		const member = await loadActiveMember(
			current.account_id,
			current.tenant_id,
		);
		if (member) {
			tenantId = member.tenant_id;
			tenant = toPublicTenant(member);
			user = toPublicUser(member);
		}
	}

	const accessToken = generateToken();
	const nextRefreshToken = generateToken();
	const expireTime = new Date(Date.now() + ACCESS_MAX_AGE * 1000);
	const refreshExpireTime = new Date(Date.now() + REFRESH_MAX_AGE * 1000);

	// session 无 RLS；单语句 CAS 轮换，避免 Neon 事务数组无法串联 RETURNING。
	const rotated = await sql`
		WITH revoked AS (
			UPDATE session
			SET revoke_time = now()
			WHERE refresh_hash = ${refreshHash}
				AND revoke_time IS NULL
				AND refresh_expire_time IS NOT NULL
				AND refresh_expire_time > now()
			RETURNING account_id
		)
		INSERT INTO session (
			account_id,
			tenant_id,
			token_hash,
			refresh_hash,
			expire_time,
			refresh_expire_time
		)
		SELECT
			account_id,
			${tenantId},
			${hashToken(accessToken)},
			${hashToken(nextRefreshToken)},
			${expireTime.toISOString()},
			${refreshExpireTime.toISOString()}
		FROM revoked
		RETURNING account_id
	`;

	if (!rotated[0]) {
		throw new AppError(401, "刷新令牌无效或已过期");
	}

	return {
		accessToken,
		refreshToken: nextRefreshToken,
		expiresAt: expireTime.toISOString(),
		account: {
			id: current.account_id,
			name: current.name,
			avatar: current.avatar,
			locale: current.locale,
			timezone: current.timezone,
		},
		tenant,
		user,
	};
};
