import type { Hono } from "hono";
import { ok } from "@/lib/response";
import { authRoutes } from "@/routes/auth";
import { tenantsRoutes } from "@/routes/tenants";
import type { AppEnv } from "@/types/api";

export function registerRoutes(app: Hono<AppEnv>) {
	app.get("/", (c) => ok(c, new Date().toISOString(), "没挂"));

	app.route("/auth", authRoutes);
	app.route("/tenants", tenantsRoutes);
}
