import type { Hono } from "hono";
import { ok } from "@/lib/response";
import type { AppEnv } from "@/types/api";
import { authRoutes } from "./auth";
import { tenantsRoutes } from "./tenants";

export const registerRoutes = (app: Hono<AppEnv>) => {
	app.get("/", (c) => ok(c, new Date().toISOString(), "没挂"));

	app.route("/auth", authRoutes);
	app.route("/tenants", tenantsRoutes);
};
