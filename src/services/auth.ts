import { sql } from "@/db/client";
import { AppError } from "@/lib/errors";
import { hashPassword, verifyPassword } from "@/lib/password";
import { generateToken, hashToken } from "@/lib/session-token";
import type {
	ChangePasswordInput,
	LoginInput,
	RegisterInput,
} from "@/schemas/auth";
import { consumeCaptcha } from "@/services/captcha";

const ACCESS_TTL_MS = 2 * 60 * 60 * 1000; // 2h
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d
const MAX_FAIL_COUNT = 5;
const LOCK_MINUTES = 15;

type AccountRow = {
	id: string;
	status: number;
	name: string | null;
	avatar: string | null;
	locale: string;
	timezone: string;
};

type CredentialRow = {
	account_id: string;
	password_hash: string;
	fail_count: number;
	lock_until: string | null;
	account_status: number;
	account_name: string | null;
	account_avatar: string | null;
	account_locale: string;
	account_timezone: string;
};

type TenantMemberRow = {
	tenant_id: string;
	tenant_key: string;
	tenant_name: string;
	tenant_avatar: string | null;
	user_id: string;
	user_name: string | null;
	user_avatar: string | null;
	user_status: number;
};

export type PublicAccount = {
	id: string;
	name: string | null;
	avatar: string | null;
	locale: string;
	timezone: string;
};

export type PublicTenant = {
	id: string;
	tenantKey: string;
	name: string;
	avatar: string | null;
};

export type PublicUser = {
	id: string;
	name: string | null;
	avatar: string | null;
	status: number;
};

export type AuthTokens = {
	accessToken: string;
	refreshToken: string;
	expiresAt: string;
};

function toPublicAccount(row: AccountRow): PublicAccount {
	return {
		id: row.id,
		name: row.name,
		avatar: row.avatar,
		locale: row.locale,
		timezone: row.timezone,
	};
}

function normalizeIdentityKey(type: string, key: string): string {
	const trimmed = key.trim();
	return type === "email" ? trimmed.toLowerCase() : trimmed;
}

async function listActiveTenants(
	accountId: string,
): Promise<TenantMemberRow[]> {
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
}

function toPublicTenant(row: TenantMemberRow): PublicTenant {
	return {
		id: row.tenant_id,
		tenantKey: row.tenant_key,
		name: row.tenant_name,
		avatar: row.tenant_avatar,
	};
}

function toPublicUser(row: TenantMemberRow): PublicUser {
	return {
		id: row.user_id,
		name: row.user_name,
		avatar: row.user_avatar,
		status: row.user_status,
	};
}

async function createSession(params: {
	accountId: string;
	tenantId: string | null;
	ip?: string | null;
	userAgent?: string | null;
}): Promise<AuthTokens & { sessionId: string }> {
	const accessToken = generateToken();
	const refreshToken = generateToken();
	const expireTime = new Date(Date.now() + ACCESS_TTL_MS);
	const refreshExpireTime = new Date(Date.now() + REFRESH_TTL_MS);

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
}

export async function register(input: RegisterInput): Promise<{
	account: PublicAccount;
}> {
	await consumeCaptcha(input.captchaId, input.captchaCode);

	const identityKey = normalizeIdentityKey(
		input.identityType,
		input.identityKey,
	);
	const passwordHash = await hashPassword(input.password);
	const accountId = crypto.randomUUID();
	const identityId = crypto.randomUUID();

	try {
		await sql.transaction([
			sql`
				INSERT INTO account (id, name, status)
				VALUES (${accountId}, ${input.name ?? null}, 1)
			`,
			sql`
				INSERT INTO identity (
					id, account_id, identity_type, identity_key, is_primary, verified_time
				) VALUES (
					${identityId},
					${accountId},
					${input.identityType},
					${identityKey},
					true,
					now()
				)
			`,
			sql`
				INSERT INTO credential (account_id, password_hash, password_algo)
				VALUES (${accountId}, ${passwordHash}, 'argon2id')
			`,
		]);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.includes("identity_type_key_uk") || message.includes("23505")) {
			throw new AppError(409, "该身份已注册");
		}
		throw err;
	}

	return {
		account: {
			id: accountId,
			name: input.name ?? null,
			avatar: null,
			locale: "zh-CN",
			timezone: "Asia/Shanghai",
		},
	};
}

export async function login(
	input: LoginInput,
	meta?: { ip?: string | null; userAgent?: string | null },
): Promise<
	AuthTokens & {
		account: PublicAccount;
		tenant: PublicTenant | null;
		user: PublicUser | null;
	}
> {
	await consumeCaptcha(input.captchaId, input.captchaCode);

	const identityKey = normalizeIdentityKey(
		input.identityType,
		input.identityKey,
	);

	const rows = await sql`
		SELECT
			c.account_id,
			c.password_hash,
			c.fail_count,
			c.lock_until,
			a.status AS account_status,
			a.name AS account_name,
			a.avatar AS account_avatar,
			a.locale AS account_locale,
			a.timezone AS account_timezone
		FROM identity i
		INNER JOIN credential c ON c.account_id = i.account_id
		INNER JOIN account a ON a.id = i.account_id
		WHERE i.identity_type = ${input.identityType}
			AND i.identity_key = ${identityKey}
			AND i.delete_time IS NULL
			AND a.delete_time IS NULL
		LIMIT 1
	`;

	const cred = rows[0] as CredentialRow | undefined;
	if (!cred) {
		throw new AppError(401, "账号或密码错误");
	}

	if (cred.account_status !== 1) {
		throw new AppError(403, "账号不可用");
	}

	if (cred.lock_until && new Date(cred.lock_until) > new Date()) {
		throw new AppError(403, "账号已锁定，请稍后再试");
	}

	const ok = await verifyPassword(input.password, cred.password_hash);
	if (!ok) {
		const nextFail = cred.fail_count + 1;
		if (nextFail >= MAX_FAIL_COUNT) {
			const lockUntil = new Date(
				Date.now() + LOCK_MINUTES * 60 * 1000,
			).toISOString();
			await sql`
				UPDATE credential
				SET fail_count = ${nextFail},
					lock_until = ${lockUntil}
				WHERE account_id = ${cred.account_id}
			`;
			throw new AppError(403, "密码错误次数过多，账号已临时锁定");
		}
		await sql`
			UPDATE credential
			SET fail_count = ${nextFail}
			WHERE account_id = ${cred.account_id}
		`;
		throw new AppError(401, "账号或密码错误");
	}

	await sql`
		UPDATE credential
		SET fail_count = 0, lock_until = NULL
		WHERE account_id = ${cred.account_id}
	`;
	await sql`
		UPDATE account
		SET last_login_time = now(), update_time = now()
		WHERE id = ${cred.account_id}
	`;

	const tenants = await listActiveTenants(cred.account_id);
	const auto = tenants.length === 1 ? (tenants[0] ?? null) : null;

	const tokens = await createSession({
		accountId: cred.account_id,
		tenantId: auto?.tenant_id ?? null,
		ip: meta?.ip,
		userAgent: meta?.userAgent,
	});

	return {
		accessToken: tokens.accessToken,
		refreshToken: tokens.refreshToken,
		expiresAt: tokens.expiresAt,
		account: {
			id: cred.account_id,
			name: cred.account_name,
			avatar: cred.account_avatar,
			locale: cred.account_locale,
			timezone: cred.account_timezone,
		},
		tenant: auto ? toPublicTenant(auto) : null,
		user: auto ? toPublicUser(auto) : null,
	};
}

export async function logout(sessionId: string): Promise<{ ok: true }> {
	await sql`
		UPDATE session
		SET revoke_time = now(), update_time = now()
		WHERE id = ${sessionId} AND revoke_time IS NULL
	`;
	return { ok: true };
}

export async function refresh(refreshToken: string): Promise<
	AuthTokens & {
		account: PublicAccount;
		tenant: PublicTenant | null;
		user: PublicUser | null;
	}
> {
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
}

export async function getMe(params: {
	accountId: string;
	tenantId: string | null;
	userId: string | null;
}): Promise<{
	account: PublicAccount;
	tenant: PublicTenant | null;
	user: PublicUser | null;
	permissions: string[];
}> {
	const accountRows = await sql`
		SELECT id, status, name, avatar, locale, timezone
		FROM account
		WHERE id = ${params.accountId} AND delete_time IS NULL
		LIMIT 1
	`;
	const account = accountRows[0] as AccountRow | undefined;
	if (account?.status !== 1) {
		throw new AppError(401, "未登录或会话已过期");
	}

	let tenant: PublicTenant | null = null;
	let user: PublicUser | null = null;
	let permissions: string[] = [];

	if (params.tenantId && params.userId) {
		const memberRows = await sql`
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
			WHERE u.id = ${params.userId}
				AND u.account_id = ${params.accountId}
				AND u.tenant_id = ${params.tenantId}
				AND u.status = 1
				AND u.delete_time IS NULL
				AND t.status = 1
				AND t.delete_time IS NULL
			LIMIT 1
		`;
		const member = memberRows[0] as TenantMemberRow | undefined;
		if (member) {
			tenant = toPublicTenant(member);
			user = toPublicUser(member);

			const permRows = await sql`
				SELECT DISTINCT p.code
				FROM user_role ur
				INNER JOIN role_perm rp ON rp.role_id = ur.role_id
				INNER JOIN permission p ON p.id = rp.permission_id
				INNER JOIN role r ON r.id = ur.role_id
				WHERE ur.user_id = ${params.userId}
					AND ur.tenant_id = ${params.tenantId}
					AND r.delete_time IS NULL
				ORDER BY p.code
			`;
			permissions = (permRows as { code: string }[]).map((r) => r.code);
		}
	}

	return {
		account: toPublicAccount(account),
		tenant,
		user,
		permissions,
	};
}

export async function changePassword(
	accountId: string,
	input: ChangePasswordInput,
): Promise<{ ok: true }> {
	const rows = await sql`
		SELECT password_hash
		FROM credential
		WHERE account_id = ${accountId}
		LIMIT 1
	`;
	const cred = rows[0] as { password_hash: string } | undefined;
	if (!cred) {
		throw new AppError(400, "账号未设置密码");
	}

	const matched = await verifyPassword(input.oldPassword, cred.password_hash);
	if (!matched) {
		throw new AppError(400, "原密码不正确");
	}

	const passwordHash = await hashPassword(input.newPassword);
	await sql`
		UPDATE credential
		SET password_hash = ${passwordHash},
			password_algo = 'argon2id',
			password_update_time = now(),
			fail_count = 0,
			lock_until = NULL
		WHERE account_id = ${accountId}
	`;

	// 改密后撤销其他会话，保留当前由调用方决定；这里撤销全部，强制重新登录更安全
	await sql`
		UPDATE session
		SET revoke_time = now(), update_time = now()
		WHERE account_id = ${accountId} AND revoke_time IS NULL
	`;

	return { ok: true };
}

export { listActiveTenants, toPublicTenant, toPublicUser };
