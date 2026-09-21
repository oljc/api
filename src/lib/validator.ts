import { zValidator as zhValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import { type ZodType, z } from "zod";
import { AppError } from "@/lib/errors";

export const validate =
	<Target extends keyof ValidationTargets>(target: Target) =>
	<T extends ZodType>(schema: T) =>
		zhValidator(target, schema, (result) => {
			if (!result.success) {
				throw new AppError(400, "参数有误，请检查后重试", {
					data: z.flattenError(result.error),
					cause: result.error,
				});
			}
		});

export const json = validate("json");
export const form = validate("form");
export const query = validate("query");
export const param = validate("param");
export const header = validate("header");
export const cookie = validate("cookie");
