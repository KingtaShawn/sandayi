/** GET /api/leaderboard —— 排行榜 top100。 */
import { handleLeaderboard } from '../_lib/api.js';
export const onRequest = (ctx) => handleLeaderboard(ctx.request, ctx.env);
