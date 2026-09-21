import { sql } from "@/db/client";
import { AppError } from "@/lib/errors";
import { ACCESS_MAX_AGE, REFRESH_MAX_AGE } from "../cookies";
import { generateToken, hashToken } from "../internal/session-token";
import type {
	AccountRow,
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
	const rows = await sql`
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
	`;
	return rows as TenantMemberRow[];
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
		SET revoke_time = now(), update_time = now()
		WHERE id = ${sessionId} AND revoke_time IS NULL
	`;
	return { ok: true };
};

export const logoutByTokens = async (params: {
	accessToken?: string | null;
	refreshToken?: string | null;
}): Promise<{ ok: true }> => {
	if (params.accessToken) {
		const tokenHash = hashToken(params.accessToken);
		await sql`
			UPDATE session
			SET revoke_time = now(), update_time = now()
			WHERE token_hash = ${tokenHash} AND revoke_time IS NULL
		`;
	}
	if (params.refreshToken) {
		const refreshHash = hashToken(params.refreshToken);
		await sql`
			UPDATE session
			SET revoke_time = now(), update_time = now()
			WHERE refresh_hash = ${refreshHash} AND revoke_time IS NULL
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
			s.id,
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

	const session = rows[0] as
		| (AccountRow & {
				id: string;
				account_id: string;
				tenant_id: string | null;
				account_status: number;
		  })
		| undefined;

	if (!session) {
		throw new AppError(401, "刷新令牌无效或已过期");
	}
	if (session.account_status !== 1) {
		throw new AppError(403, "账号不可用");
	}

	// 撤销旧会话，再签发新会话（refresh 轮换）
	await sql`
		UPDATE session
		SET revoke_time = now(), update_time = now()
		WHERE id = ${session.id}
	`;

	let tenantId: string | null = session.tenant_id;
	let tenant: PublicTenant | null = null;
	let user: PublicUser | null = null;

	if (tenantId) {
		const members = await listActiveTenants(session.account_id);
		const matched = members.find((m) => m.tenant_id === tenantId);
		if (matched) {
			tenant = toPublicTenant(matched);
			user = toPublicUser(matched);
		} else {
			tenantId = null;
		}
	}

	const tokens = await createSession({
		accountId: session.account_id,
		tenantId,
	});

	return {
		accessToken: tokens.accessToken,
		refreshToken: tokens.refreshToken,
		expiresAt: tokens.expiresAt,
		account: {
			id: session.account_id,
			name: session.name,
			avatar: session.avatar,
			locale: session.locale,
			timezone: session.timezone,
		},
		tenant,
		user,
	};
};
