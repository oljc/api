import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	throw new Error("未设置 DATABASE_URL");
}

/** 应用查询：pooled 连接 */
export const sql = neon(databaseUrl);
