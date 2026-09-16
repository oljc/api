import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { API_CODE_OK, type ApiResponse, type AppEnv } from "@/types/api";

export type AppContext = Context<AppEnv>;

export function ok<T>(
	c: AppContext,
	data: T,
	message = "成功",
	status: ContentfulStatusCode = 200,
) {
	const body: ApiResponse<T> = {
		code: API_CODE_OK,
		message,
		data,
		traceId: c.get("traceId"),
	};
	return c.json(body, status);
}

export function fail<T = null>(
	c: AppContext,
	code: number,
	message: string,
	data: T = null as T,
	status?: ContentfulStatusCode,
) {
	// 未显式传入 HTTP 状态码时：业务码落在 4xx/5xx 则复用，否则默认 400
	const httpStatus: ContentfulStatusCode =
		status ??
		(code >= 400 && code < 600 ? (code as ContentfulStatusCode) : 400);

	const body: ApiResponse<T> = {
		code,
		message,
		data,
		traceId: c.get("traceId"),
	};
	return c.json(body, httpStatus);
}
