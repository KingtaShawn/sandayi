/** GET/PUT /api/sync —— 云端档案拉取/推送。 */
import { handleSyncGet, handleSyncPut } from './_lib/api.js';
export const onRequest = (ctx) => ctx.request.method === 'PUT' ? handleSyncPut(ctx.request, ctx.env) : handleSyncGet(ctx.request, ctx.env);

export default onRequest;
