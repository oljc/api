import { Hono } from "hono";
import { ok } from "@/lib/response";
import type { AppEnv } from "@/types/api";

export const healthRoutes = new Hono<AppEnv>();

healthRoutes.get("/", (c) =>
	ok(c, {
		status: "正常" as const,
		timestamp: new Date().toISOString(),
	}),
);
