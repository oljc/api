import { createMiddleware } from "hono/factory";
import type { AppEnv } from "@/types/api";

/**
 * 使用 EdgeOne 平台注入的 eo-log-uuid 作为统一 traceId。
 * 不接受客户端自定义的 x-trace-id；本地开发无该头时再兜底生成。
 */
export const traceMiddleware = createMiddleware<AppEnv>(async (c, next) => {
	const traceId = c.req.header("eo-log-uuid") || crypto.randomUUID();
	c.set("traceId", traceId);
	await next();
	c.header("x-trace-id", traceId);
});
