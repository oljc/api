import type { Hono } from "hono";
import { ok } from "@/lib/response";
import { healthRoutes } from "@/routes/health";
import { usersRoutes } from "@/routes/users";
import type { AppEnv } from "@/types/api";

export function registerRoutes(app: Hono<AppEnv>) {
	app.get("/", (c) => ok(c, new Date().toISOString(), "没挂"));

	app.route("/health", healthRoutes);
	app.route("/users", usersRoutes);
}
