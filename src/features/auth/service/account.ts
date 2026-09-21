import { sql } from "@/db/client";
import { AppError } from "@/lib/errors";
import { consumeCaptcha } from "../internal/captcha";
import { parseAccount } from "../internal/identity";
import { hashPassword, verifyPassword } from "../internal/password";
import type {
	ChangePasswordInput,
	PasswordLoginInput,
	RegisterInput,
} from "../schema";
import type {
	AccountRow,
	AuthTokens,
	PublicAccount,
	PublicTenant,
	PublicUser,
	TenantMemberRow,
} from "../types";
import { toPublicAccount, toPublicTenant, toPublicUser } from "../types";
import { createSession, listActiveTenants } from "./session";

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

export const register = async (
	input: RegisterInput,
): Promise<{
	account: PublicAccount;
}> => {
	await consumeCaptcha(input.captchaId, input.captchaCode);

	const identity = parseAccount(input.account);
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
					${identity.type},
					${identity.key},
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
};

export const login = async (
	input: PasswordLoginInput,
	meta?: { ip?: string | null; userAgent?: string | null },
): Promise<
	AuthTokens & {
		account: PublicAccount;
		tenant: PublicTenant | null;
		user: PublicUser | null;
	}
> => {
	await consumeCaptcha(input.captchaId, input.captchaCode);

	const identity = parseAccount(input.account);

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
		WHERE i.identity_type = ${identity.type}
			AND i.identity_key = ${identity.key}
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
		if (nextFail >= 5) {
			const lockUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
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
};

export const getMe = async (params: {
	accountId: string;
	tenantId: string | null;
	userId: string | null;
}): Promise<{
	account: PublicAccount;
	tenant: PublicTenant | null;
	user: PublicUser | null;
	permissions: string[];
}> => {
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
};

export const changePassword = async (
	accountId: string,
	input: ChangePasswordInput,
): Promise<{ ok: true }> => {
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
};
