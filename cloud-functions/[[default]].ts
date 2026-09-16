import { createApp } from "@/app";
import type { Env } from "@/types/api";

const app = createApp();

export type EdgeOneContext = {
	request: Request;
	params: Record<string, string>;
	env: Env;
	uuid?: string;
};

/**
 * EdgeOne Cloud Functions 入口。
 * 通过 onRequest + app.fetch 接入，不要调用 app.listen()。
 */
export async function onRequest(context: EdgeOneContext): Promise<Response> {
	const headers = new Headers(context.request.headers);
	if (context.uuid && !headers.has("x-trace-id")) {
		headers.set("x-trace-id", context.uuid);
	}

	return app.fetch(new Request(context.request, { headers }), context.env);
}

export default app;
