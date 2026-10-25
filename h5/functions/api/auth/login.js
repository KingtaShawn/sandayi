/** POST /api/auth/login —— 用户名+密码登录。 */
import { handleLogin } from '../_lib/api.js';
import { corsPreflight } from '../_lib/http.js';

export const onRequest = (ctx) => handleLogin(ctx.request, ctx.env);
export const onRequestOptions = () => corsPreflight(); // 跨域预检放行（github.io → pages.dev）

export default onRequest;
