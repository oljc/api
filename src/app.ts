import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "@/lib/errors";
import { parseOrigins } from "@/lib/origins";
import { fail } from "@/lib/response";
import { csrfOrigin } from "@/middleware/csrf";
import { traceMiddleware } from "@/middleware/trace";
import { registerRoutes } from "@/routes";
import type { AppEnv } from "@/types/api";

export const createApp = () => {
	const app = new Hono<AppEnv>();

	app.use("*", traceMiddleware);
	app.use("*", async (c, next) => {
		const allowlist = parseOrigins(c.env.CORS_ORIGINS);
		const handler = cors({
			origin: (origin) => (allowlist.includes(origin) ? origin : undefined),
			credentials: true,
			allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
			allowHeaders: ["Content-Type"],
		});
		return handler(c, next);
	});
	app.use("*", csrfOrigin);

	registerRoutes(app);

	app.notFound((c) =>
		fail(c, 404, `接口不存在：${c.req.method} ${c.req.path}`),
	);

	app.onError((err, c) => {
		if (err instanceof AppError) {
			return fail(
				c,
				err.code,
				err.message,
				err.data,
				err.status as ContentfulStatusCode,
			);
		}

		console.error(err);
		return fail(c, 500, "服务异常，请稍后重试");
	});

	return app;
};

export type App = ReturnType<typeof createApp>;
