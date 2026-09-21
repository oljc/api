import { z } from "zod";

export const createTenantSchema = z.object({
	name: z.string().trim().min(1).max(100),
	tenantKey: z
		.string()
		.trim()
		.min(2)
		.max(64)
		.regex(/^[a-z0-9][a-z0-9_-]*$/, "仅支持小写字母、数字、下划线与连字符")
		.optional(),
});

export const tenantIdParamSchema = z.object({
	id: z.uuid(),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
