import { createMiddleware } from "hono/factory";
import { query, sql } from "@/db/client";
import { AppError } from "@/lib/errors";
import type { AppEnv } from "@/types/api";
import { getAccessToken } from "./cookies";
import { hashToken } from "./internal/session-token";
import type { PublicAccount, PublicTenant, PublicUser } from "./types";

type SessionRow = {
	id: string;
	account_id: string;
	account_status: number;
	account_name: string | null;
	account_avatar: string | null;
	account_locale: string;
	account_timezone: string;
	tenant_id: string | null;
};

type TenantRow = {
	tenant_key: string;
	tenant_name: string;
	tenant_avatar: string | null;
	user_id: string;
	user_name: string | null;
	user_avatar: string | null;
	user_status: number;
};

const loadSessionByAccessToken = async (
	accessToken: string,
): Promise<{
	sessionId: string;
	account: PublicAccount;
	tenant: PublicTenant | null;
	user: PublicUser | null;
}> => {
	const tokenHash = hashToken(accessToken);
	const rows = await sql`
		SELECT
			s.id,
			s.account_id,
			a.status AS account_status,
			a.name AS account_name,
			a.avatar AS account_avatar,
			a.locale AS account_locale,
			a.timezone AS account_timezone,
			s.tenant_id
		FROM session s
		INNER JOIN account a ON a.id = s.account_id
		WHERE s.token_hash = ${tokenHash}
			AND s.revoke_time IS NULL
			AND s.expire_time > now()
			AND a.delete_time IS NULL
		LIMIT 1
	`;

	const session = rows[0] as SessionRow | undefined;
	if (!session) {
		throw new AppError(401, "未登录或会话已过期");
	}
	if (session.account_status !== 1) {
		throw new AppError(403, "账号不可用");
	}

	let member: TenantRow | undefined;
	if (session.tenant_id) {
		const members = await query<TenantRow>(
			session.account_id,
			session.tenant_id,
			sql`
				SELECT
					t.tenant_key,
					t.name AS tenant_name,
					t.avatar AS tenant_avatar,
					u.id AS user_id,
					u.name AS user_name,
					u.avatar AS user_avatar,
					u.status AS user_status
				FROM "user" u
				INNER JOIN tenant t ON t.id = u.tenant_id
				WHERE u.account_id = ${session.account_id}
					AND u.tenant_id = ${session.tenant_id}
					AND u.status = 1
					AND u.delete_time IS NULL
					AND t.status = 1
					AND t.delete_time IS NULL
				LIMIT 1
			`,
		);
		member = members[0];
	}

	const account: PublicAccount = {
		id: session.account_id,
		name: session.account_name,
		avatar: session.account_avatar,
		locale: session.account_locale,
		timezone: session.account_timezone,
	};
	const tenant: PublicTenant | null =
		session.tenant_id && member
			? {
					id: session.tenant_id,
					tenantKey: member.tenant_key,
					name: member.tenant_name,
					avatar: member.tenant_avatar,
				}
			: null;
	const user: PublicUser | null =
		tenant && member
			? {
					id: member.user_id,
					name: member.user_name,
					avatar: member.user_avatar,
					status: member.user_status,
				}
			: null;
	return { sessionId: session.id, account, tenant, user };
};

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
	const token = getAccessToken(c);
	if (!token) {
		throw new AppError(401, "未登录或会话已过期");
	}

	const auth = await loadSessionByAccessToken(token);
	c.set("accountId", auth.account.id);
	c.set("sessionId", auth.sessionId);
	c.set("tenantId", auth.tenant?.id ?? null);
	c.set("userId", auth.user?.id ?? null);
	c.set("authAccount", auth.account);
	c.set("authTenant", auth.tenant);
	c.set("authUser", auth.user);
	await next();
});

export const requireTenant = createMiddleware<AppEnv>(async (c, next) => {
	if (!c.get("tenantId") || !c.get("userId")) {
		throw new AppError(403, "请先选择工作区");
	}
	await next();
});
