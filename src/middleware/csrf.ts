import { createMiddleware } from "hono/factory";
import { AppError } from "@/lib/errors";
import { isAllowedOrigin, parseOrigins } from "@/lib/origins";
import type { AppEnv } from "@/types/api";

const requestOrigin = (url: string): string | null => {
	try {
		return new URL(url).origin;
	} catch {
		return null;
	}
};

/** 校验非安全方法的 Origin；与 CORS 白名单共用 CORS_ORIGINS */
export const csrfOrigin = createMiddleware<AppEnv>(async (c, next) => {
	if (["GET", "HEAD", "OPTIONS"].includes(c.req.method.toUpperCase())) {
		await next();
		return;
	}

	const origin = c.req.header("Origin");
	if (origin) {
		const allowlist = parseOrigins(c.env.CORS_ORIGINS);
		const sameOrigin = origin === requestOrigin(c.req.url);
		if (!sameOrigin && !isAllowedOrigin(origin, allowlist)) {
			throw new AppError(403, "拒绝跨站请求");
		}
		await next();
		return;
	}

	if (c.req.header("Sec-Fetch-Site") === "same-origin") {
		await next();
		return;
	}

	throw new AppError(403, "拒绝跨站请求");
});
