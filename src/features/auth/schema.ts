import { z } from "zod";

const captchaFields = {
	captchaId: z.string().trim().min(1),
	captchaCode: z.string().trim().min(4).max(8),
};

const accountField = z.string().trim().min(1).max(255);

export const registerSchema = z.object({
	account: accountField,
	password: z.string().min(8).max(128),
	name: z.string().trim().min(1).max(100).optional(),
	...captchaFields,
});

export const passwordLoginSchema = z.object({
	loginType: z.literal("password"),
	account: accountField,
	password: z.string().min(1).max(128),
	...captchaFields,
});

export const smsLoginSchema = z.object({
	loginType: z.literal("sms"),
	account: accountField,
	smsCode: z.string().trim().min(4).max(8),
});

export const loginSchema = z.discriminatedUnion("loginType", [
	passwordLoginSchema,
	smsLoginSchema,
]);

export const sendSmsSchema = z.object({
	mobile: z.string().trim().min(1).max(32),
});

export const changePasswordSchema = z.object({
	oldPassword: z.string().min(1).max(128),
	newPassword: z.string().min(8).max(128),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type PasswordLoginInput = z.infer<typeof passwordLoginSchema>;
export type SmsLoginInput = z.infer<typeof smsLoginSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type SendSmsInput = z.infer<typeof sendSmsSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
