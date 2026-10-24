/** POST /api/auth/guest —— 建游客账号。 */
import { handleGuest } from '../../_lib/api.js';
export const onRequest = (ctx) => handleGuest(ctx.request, ctx.env);
