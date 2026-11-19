import { handleReplays } from './_lib/replays.js';
import { corsPreflight } from './_lib/http.js';

export const onRequest = ctx => handleReplays(ctx.request, ctx.env);
export const onRequestOptions = () => corsPreflight();
