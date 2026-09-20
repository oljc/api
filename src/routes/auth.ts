import { Hono } from "hono";
import { AppError } from "@/lib/errors";
import { ok } from "@/lib/response";
import { zValidator } from "@/lib/validator";
import { requireAuth } from "@/middleware/auth";
import {
	changePasswordSchema,
	loginSchema,
	refreshSchema,
	registerSchema,
} from "@/schemas/auth";
import * as authService from "@/services/auth";
import { createCaptcha } from "@/services/captcha";
import type { AppEnv } from "@/types/api";

export const authRoutes = new Hono<AppEnv>();

authRoutes.get("/captcha", async (c) => {
	const result = await createCaptcha();
	return ok(c, result);
});

authRoutes.post("/register", zValidator("json", registerSchema), async (c) => {
	const input = c.req.valid("json");
	const result = await authService.register(input);
	return ok(c, result, "注册成功", 201);
});

authRoutes.post("/login", zValidator("json", loginSchema), async (c) => {
	const input = c.req.valid("json");
	const result = await authService.login(input, {
		ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
		userAgent: c.req.header("user-agent") ?? null,
	});
	return ok(c, result, "登录成功");
});

authRoutes.post("/refresh", zValidator("json", refreshSchema), async (c) => {
	const { refreshToken } = c.req.valid("json");
	const result = await authService.refresh(refreshToken);
	return ok(c, result, "刷新成功");
});

authRoutes.post("/logout", requireAuth, async (c) => {
	const sessionId = c.get("sessionId");
	if (!sessionId) {
		throw new AppError(401, "未登录或会话已过期");
	}
	const result = await authService.logout(sessionId);
	return ok(c, result, "已退出登录");
});

authRoutes.get("/me", requireAuth, async (c) => {
	const accountId = c.get("accountId");
	if (!accountId) {
		throw new AppError(401, "未登录或会话已过期");
	}
	const result = await authService.getMe({
		accountId,
		tenantId: c.get("tenantId") ?? null,
		userId: c.get("userId") ?? null,
	});
	return ok(c, result);
});

authRoutes.post(
	"/password",
	requireAuth,
	zValidator("json", changePasswordSchema),
	async (c) => {
		const accountId = c.get("accountId");
		if (!accountId) {
			throw new AppError(401, "未登录或会话已过期");
		}
		const input = c.req.valid("json");
		const result = await authService.changePassword(accountId, input);
		return ok(c, result, "密码已更新，请重新登录");
	},
);
