import type { Hono } from "hono";
import { ok } from "@/lib/response";
import { healthRoutes } from "@/routes/health";
import { usersRoutes } from "@/routes/users";
import type { AppEnv } from "@/types/api";

export function registerRoutes(app: Hono<AppEnv>) {
	app.get("/", (c) =>
		ok(c, {
			name: "edgeone-hono-api",
			docs: {
				health: "GET /health",
				users: "GET|POST /users",
				userById: "GET|PUT|DELETE /users/:id",
			},
		}),
	);

	app.route("/health", healthRoutes);
	app.route("/users", usersRoutes);
}
