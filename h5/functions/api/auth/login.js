/** POST /api/auth/login —— 用户名+密码登录。 */
import { handleLogin } from '../_lib/api.js';
export const onRequest = (ctx) => handleLogin(ctx.request, ctx.env);

export default onRequest;
