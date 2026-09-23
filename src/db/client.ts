import { type NeonQueryPromise, neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	throw new Error("未设置 DATABASE_URL");
}

export const sql = neon(databaseUrl);

type Query = NeonQueryPromise<false, false>;

// RLS 上下文只在当前事务生效，适配 Neon/PgBouncer 的事务池模式。
const roleQuery = (): Query => sql`SET LOCAL ROLE app`;

const contextQuery = (
	accountId: string,
	tenantId?: string | null,
): Query => sql`
	SELECT
		set_config('app.account_id', ${accountId}, true),
		set_config('app.tenant_id', ${tenantId ?? ""}, true)
`;

/** 在受限角色和指定账号/租户上下文中执行单条查询。 */
export const query = async <T>(
	accountId: string,
	tenantId: string | null | undefined,
	stmt: Query,
): Promise<T[]> => {
	const results = await sql.transaction([
		roleQuery(),
		contextQuery(accountId, tenantId),
		stmt,
	]);
	return results[2] as T[];
};

/** 在同一 RLS 上下文和事务中按顺序执行多条查询。 */
export const transaction = async (
	accountId: string,
	tenantId: string | null | undefined,
	stmts: Query[],
) => {
	const results = await sql.transaction([
		roleQuery(),
		contextQuery(accountId, tenantId),
		...stmts,
	]);
	return results.slice(2);
};

/** 判断 PostgreSQL 23505 唯一约束错误，可选匹配约束名。 */
export const isUnique = (error: unknown, constraint?: string) => {
	if (!error || typeof error !== "object") return false;
	const value = error as { code?: unknown; constraint?: unknown };
	return (
		value.code === "23505" &&
		(constraint === undefined || value.constraint === constraint)
	);
};
