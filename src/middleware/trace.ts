import { createMiddleware } from "hono/factory";
import type { AppEnv } from "@/types/api";

export const traceMiddleware = createMiddleware<AppEnv>(async (c, next) => {
	const traceId = c.req.header("functions-request-id") || crypto.randomUUID();
	c.set("traceId", traceId);
	await next();
});
