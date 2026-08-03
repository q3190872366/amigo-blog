// Cloudflare Pages Function —— 飞书事件回调入口
// 路由: /webhook/feishu  (GET 用于飞书地址校验, POST 接收事件)
// 机器人主体逻辑在 ../../bot-src/index.js (Hono app)
import worker from '../../bot-src/index.js';

export const onRequest = (context) =>
	worker.fetch(context.request, context.env, context);
