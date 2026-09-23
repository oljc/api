import { z } from "zod";

/** 与 tenant.tenant_key_check 保持一致 */
const tenantKeySchema = z
	.string()
	.trim()
	.regex(
		/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/,
		"仅支持小写字母、数字与连字符，且不能以连字符开头或结尾",
	);

export const createTenantSchema = z.object({
	name: z.string().trim().min(1).max(100),
	tenantKey: tenantKeySchema.optional(),
});

export const tenantIdParamSchema = z.object({
	id: z.uuid(),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
