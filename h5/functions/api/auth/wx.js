/** POST /api/auth/wx —— 小程序 code 换 openid 登录。 */
import { handleWx } from '../_lib/api.js';
export const onRequest = (ctx) => handleWx(ctx.request, ctx.env);

export default onRequest;
