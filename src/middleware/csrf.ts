import { createMiddleware } from "hono/factory";
import { AppError } from "@/lib/errors";
import { isTrustedOrigin } from "@/lib/origin";
import type { AppEnv } from "@/types/api";

export const csrfOrigin = createMiddleware<AppEnv>((c, next) => {
	const method = c.req.method;
	if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
		return next();
	}

	const origin = c.req.header("Origin");
	if (origin) {
		if (!isTrustedOrigin(origin)) {
			throw new AppError(403, "拒绝跨站请求");
		}
		return next();
	}

	if (c.req.header("Sec-Fetch-Site") === "same-origin") {
		return next();
	}

	throw new AppError(403, "拒绝跨站请求");
});
