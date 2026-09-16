import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "@/lib/errors";
import { fail } from "@/lib/response";
import { traceMiddleware } from "@/middleware/trace";
import { registerRoutes } from "@/routes/index";
import type { AppEnv } from "@/types/api";

export function createApp() {
	const app = new Hono<AppEnv>();

	app.use("*", traceMiddleware);
	app.use("*", logger());
	app.use(
		"*",
		cors({
			origin: "*",
			allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
			allowHeaders: ["Content-Type", "Authorization", "X-Trace-Id"],
		}),
	);

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
}

export type App = ReturnType<typeof createApp>;
