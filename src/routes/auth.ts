import { Hono } from "hono";
import { requireAuth } from "@/features/auth";
import {
	clearAuthCookies,
	getAccessToken,
	getRefreshToken,
	setAuthCookies,
} from "@/features/auth/cookies";
import { createCaptcha } from "@/features/auth/internal/captcha";
import {
	changePasswordSchema,
	loginSchema,
	registerSchema,
	sendSmsSchema,
} from "@/features/auth/schema";
import * as accountService from "@/features/auth/service/account";
import * as sessionService from "@/features/auth/service/session";
import * as smsService from "@/features/auth/service/sms";
import { toClientSession } from "@/features/auth/types";
import { AppError } from "@/lib/errors";
import { ok } from "@/lib/response";
import { json } from "@/lib/validator";
import type { AppEnv } from "@/types/api";

export const authRoutes = new Hono<AppEnv>();

authRoutes.get("/captcha", async (c) => {
	const result = await createCaptcha();
	return ok(c, result);
});

authRoutes.post("/sms/send", json(sendSmsSchema), async (c) => {
	const { mobile } = c.req.valid("json");
	const result = await smsService.sendSms(mobile);
	return ok(c, result);
});

authRoutes.post("/register", json(registerSchema), async (c) => {
	const input = c.req.valid("json");
	const result = await accountService.register(input);
	return ok(c, result, "注册成功", 201);
});

authRoutes.post("/login", json(loginSchema), async (c) => {
	const input = c.req.valid("json");
	const meta = {
		ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
		userAgent: c.req.header("user-agent") ?? null,
	};
	const result =
		input.loginType === "sms"
			? await smsService.loginWithSms(input)
			: await accountService.login(input, meta);
	setAuthCookies(c, result);
	return ok(c, toClientSession(result), "登录成功");
});

authRoutes.post("/refresh", async (c) => {
	const refreshToken = getRefreshToken(c);
	if (!refreshToken) {
		throw new AppError(401, "刷新令牌无效或已过期");
	}
	const result = await sessionService.refresh(refreshToken);
	setAuthCookies(c, result);
	return ok(c, toClientSession(result), "刷新成功");
});

authRoutes.post("/logout", async (c) => {
	await sessionService.logoutByTokens({
		accessToken: getAccessToken(c),
		refreshToken: getRefreshToken(c),
	});
	clearAuthCookies(c);
	return ok(c, { ok: true }, "已退出登录");
});

authRoutes.get("/me", requireAuth, async (c) => {
	const accountId = c.get("accountId");
	if (!accountId) {
		throw new AppError(401, "未登录或会话已过期");
	}
	const result = await accountService.getMe({
		accountId,
		tenantId: c.get("tenantId") ?? null,
		userId: c.get("userId") ?? null,
	});
	return ok(c, result);
});

authRoutes.post(
	"/password",
	requireAuth,
	json(changePasswordSchema),
	async (c) => {
		const accountId = c.get("accountId");
		if (!accountId) {
			throw new AppError(401, "未登录或会话已过期");
		}
		const input = c.req.valid("json");
		const result = await accountService.changePassword(accountId, input);
		clearAuthCookies(c);
		return ok(c, result, "密码已更新，请重新登录");
	},
);
