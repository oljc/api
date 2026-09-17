import { createApp } from "@/app";

/**
 * EdgeOne Cloud Functions 入口（Hono 框架模式）。
 * 与 Express/Koa 一致：仅 export default app，禁止 app.listen()。
 * 平台会直接调用 app.fetch(request, env)；trace 用请求头 eo-log-uuid。
 */
const app = createApp();

export default app;
