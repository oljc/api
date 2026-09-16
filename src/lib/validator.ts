import { zValidator as zhValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import { type ZodType, z } from "zod";
import { type AppContext, fail } from "@/lib/response";

export function zValidator<
	T extends ZodType,
	Target extends keyof ValidationTargets,
>(target: Target, schema: T) {
	return zhValidator(target, schema, (result, c) => {
		if (!result.success) {
			return fail(
				c as AppContext,
				400,
				"参数有误，请检查后重试",
				z.flattenError(result.error),
			);
		}
	});
}
