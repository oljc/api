import { createMiddleware } from "hono/factory";
import type { AppEnv } from "@/types/api";

export const traceMiddleware = createMiddleware<AppEnv>(async (c, next) => {
	const incoming = c.req.header("x-trace-id");
	c.set("traceId", incoming || crypto.randomUUID());
	await next();
});
