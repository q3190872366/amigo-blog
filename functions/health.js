// Cloudflare Pages Function —— 健康检查
// 路由: /health
import worker from '../bot-src/index.js';

export const onRequest = (context) =>
	worker.fetch(context.request, context.env, context);
