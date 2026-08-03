import worker from '../../bot-src/index.js';
export const onRequest = (c) => worker.fetch(c.request, c.env, c);
