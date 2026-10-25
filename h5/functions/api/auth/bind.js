/** POST /api/auth/bind —— 游客升级为正式账号。 */
import { handleBind } from '../_lib/api.js';
import { corsPreflight } from '../_lib/http.js';

export const onRequest = (ctx) => handleBind(ctx.request, ctx.env);
export const onRequestOptions = () => corsPreflight(); // 跨域预检放行（github.io → pages.dev）

export default onRequest;
