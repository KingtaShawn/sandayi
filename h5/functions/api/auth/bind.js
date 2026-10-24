/** POST /api/auth/bind —— 游客升级为正式账号。 */
import { handleBind } from '../_lib/api.js';
export const onRequest = (ctx) => handleBind(ctx.request, ctx.env);

export default onRequest;
