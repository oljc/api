import { z } from "zod";

export const identityTypeSchema = z.enum(["email", "mobile"]);

const captchaFields = {
	captchaId: z.string().trim().min(1),
	captchaCode: z.string().trim().min(4).max(8),
};

export const registerSchema = z.object({
	identityType: identityTypeSchema,
	identityKey: z.string().trim().min(1).max(255),
	password: z.string().min(8).max(128),
	name: z.string().trim().min(1).max(100).optional(),
	...captchaFields,
});

export const loginSchema = z.object({
	identityType: identityTypeSchema,
	identityKey: z.string().trim().min(1).max(255),
	password: z.string().min(1).max(128),
	...captchaFields,
});

export const refreshSchema = z.object({
	refreshToken: z.string().min(1),
});

export const changePasswordSchema = z.object({
	oldPassword: z.string().min(1).max(128),
	newPassword: z.string().min(8).max(128),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
