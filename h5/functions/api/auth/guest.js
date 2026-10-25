/** POST /api/auth/guest —— 建游客账号。 */
import { handleGuest } from '../_lib/api.js';
import { corsPreflight } from '../_lib/http.js';

export const onRequest = (ctx) => handleGuest(ctx.request, ctx.env);
export const onRequestOptions = () => corsPreflight(); // 跨域预检放行（github.io → pages.dev）

export default onRequest;
