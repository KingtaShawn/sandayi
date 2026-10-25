/** GET /api/leaderboard —— 排行榜 top100。 */
import { handleLeaderboard } from './_lib/api.js';
import { corsPreflight } from './_lib/http.js';

export const onRequest = (ctx) => handleLeaderboard(ctx.request, ctx.env);
export const onRequestOptions = () => corsPreflight(); // 跨域预检放行（github.io → pages.dev）

export default onRequest;
