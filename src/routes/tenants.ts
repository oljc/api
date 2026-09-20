import { Hono } from "hono";
import { AppError } from "@/lib/errors";
import { ok } from "@/lib/response";
import { zValidator } from "@/lib/validator";
import { requireAuth } from "@/middleware/auth";
import { createTenantSchema, tenantIdParamSchema } from "@/schemas/tenants";
import * as tenantsService from "@/services/tenants";
import type { AppEnv } from "@/types/api";

export const tenantsRoutes = new Hono<AppEnv>();

tenantsRoutes.use("*", requireAuth);

tenantsRoutes.get("/", async (c) => {
	const accountId = c.get("accountId");
	if (!accountId) {
		throw new AppError(401, "未登录或会话已过期");
	}
	const result = await tenantsService.listTenants(accountId);
	return ok(c, result);
});

tenantsRoutes.post("/", zValidator("json", createTenantSchema), async (c) => {
	const accountId = c.get("accountId");
	const sessionId = c.get("sessionId");
	if (!accountId || !sessionId) {
		throw new AppError(401, "未登录或会话已过期");
	}
	const input = c.req.valid("json");
	const result = await tenantsService.createTenant(accountId, sessionId, input);
	return ok(c, result, "工作区创建成功", 201);
});

tenantsRoutes.post(
	"/:id/switch",
	zValidator("param", tenantIdParamSchema),
	async (c) => {
		const accountId = c.get("accountId");
		const sessionId = c.get("sessionId");
		if (!accountId || !sessionId) {
			throw new AppError(401, "未登录或会话已过期");
		}
		const { id } = c.req.valid("param");
		const result = await tenantsService.switchTenant(accountId, sessionId, id);
		return ok(c, result, "已切换工作区");
	},
);
