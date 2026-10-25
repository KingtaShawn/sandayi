/** POST /api/auth/wx —— 小程序 code 换 openid 登录。 */
import { handleWx } from '../_lib/api.js';
import { corsPreflight } from '../_lib/http.js';

export const onRequest = (ctx) => handleWx(ctx.request, ctx.env);
export const onRequestOptions = () => corsPreflight(); // 跨域预检放行（github.io → pages.dev）

export default onRequest;
