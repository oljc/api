import { createMiddleware } from "hono/factory";
import { sql } from "@/db/client";
import { AppError } from "@/lib/errors";
import { hashToken } from "@/lib/session-token";
import type { AppEnv } from "@/types/api";

type SessionRow = {
	id: string;
	account_id: string;
	tenant_id: string | null;
	account_status: number;
};

async function loadSessionByAccessToken(
	accessToken: string,
): Promise<SessionRow> {
	const tokenHash = hashToken(accessToken);
	const rows = await sql`
		SELECT
			s.id,
			s.account_id,
			s.tenant_id,
			a.status AS account_status
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
	return session;
}

async function resolveTenantUser(
	accountId: string,
	tenantId: string | null,
): Promise<{ tenantId: string | null; userId: string | null }> {
	if (!tenantId) {
		return { tenantId: null, userId: null };
	}

	const rows = await sql`
		SELECT u.id AS user_id
		FROM "user" u
		INNER JOIN tenant t ON t.id = u.tenant_id
		WHERE u.account_id = ${accountId}
			AND u.tenant_id = ${tenantId}
			AND u.status = 1
			AND u.delete_time IS NULL
			AND t.status = 1
			AND t.delete_time IS NULL
		LIMIT 1
	`;

	const row = rows[0] as { user_id: string } | undefined;
	if (!row) {
		return { tenantId: null, userId: null };
	}
	return { tenantId, userId: row.user_id };
}

function extractBearerToken(authorization: string | undefined): string | null {
	if (!authorization) return null;
	const [scheme, token] = authorization.split(" ");
	if (scheme?.toLowerCase() !== "bearer" || !token) return null;
	return token;
}

/** 要求有效 access token；注入 accountId / sessionId；尽力解析租户成员 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
	const token = extractBearerToken(c.req.header("Authorization"));
	if (!token) {
		throw new AppError(401, "未登录或会话已过期");
	}

	const session = await loadSessionByAccessToken(token);
	const { tenantId, userId } = await resolveTenantUser(
		session.account_id,
		session.tenant_id,
	);

	c.set("accountId", session.account_id);
	c.set("sessionId", session.id);
	c.set("tenantId", tenantId);
	c.set("userId", userId);
	await next();
});

/** 在 requireAuth 之后使用：要求会话已绑定有效租户成员 */
export const requireTenant = createMiddleware<AppEnv>(async (c, next) => {
	if (!c.get("tenantId") || !c.get("userId")) {
		throw new AppError(403, "请先选择工作区");
	}
	await next();
});
