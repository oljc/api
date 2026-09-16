import { z } from "zod";

export const createUserSchema = z.object({
	name: z.string().trim().min(1, "请填写姓名"),
	email: z.string().trim().email("邮箱格式不正确"),
});

export const updateUserSchema = z
	.object({
		name: z.string().trim().min(1, "请填写姓名").optional(),
		email: z.string().trim().email("邮箱格式不正确").optional(),
	})
	.refine((v) => v.name !== undefined || v.email !== undefined, {
		message: "请至少填写姓名或邮箱其中一项",
	});

export const userIdParamSchema = z.object({
	id: z.string().min(1, "用户 ID 不能为空"),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export type User = {
	id: string;
	name: string;
	email: string;
	createdAt: string;
};
