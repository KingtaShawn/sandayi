// 牌谱按账号和局号存放，可通过只读链接或已公开的账号名分页读取。
import { jsonResp, errResp, getBearer } from './http.js';
import { verifyToken } from './token.js';
import Users from './users.js';
import { kvOf } from './runtime.js';

const maxBytes = 256 * 1024;
const keyPattern = /^[a-f0-9]{64}$/;

async function readReplay(request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let size = 0, json = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new RangeError(); }
    json += decoder.decode(value, { stream: true });
  }
  return JSON.parse(json + decoder.decode());
}

export async function handleReplays(request, env) {
  const kv = kvOf(env);
  const url = new URL(request.url);
  if (url.searchParams.has('visibility')) {
    if (!env?.AUTH_SECRET) return errResp(503, '云牌谱服务未配置');
    const uid = await verifyToken(env, getBearer(request));
    if (!uid) return errResp(401, '请先连接云账号');
    const user = await Users.getUser(env, uid);
    if (!user?.login) return errResp(400, '请先绑定账号名');
    const name = user.login.name;
    const key = 'publicReplayName:' + user.login.nameKey;
    const method = request.method;
    if (method === 'PUT') await kv.put(key, uid);
    else if (method === 'DELETE') await kv.delete(key);
    else if (method !== 'GET') return errResp(405, '请求方法不支持');
    const published = method === 'GET' ? await kv.get(key) === uid : method === 'PUT';
    return jsonResp({ name, published });
  }

  if (request.method === 'GET') {
    if (url.searchParams.has('accounts')) {
      const prefix = 'publicReplayName:';
      const page = await kv.list({ prefix, limit: 25, cursor: url.searchParams.get('cursor') || undefined });
      return jsonResp({ names: page.keys.map(item => item.name.slice(prefix.length)),
        cursor: page.list_complete ? null : page.cursor });
    }
    let owner;
    if (url.searchParams.has('name')) {
      const name = url.searchParams.get('name').trim();
      if (Users.validateName(name)) return errResp(400, '请输入有效账号名');
      owner = await kv.get('publicReplayName:' + name.toLowerCase());
      if (!owner) return errResp(404, '未找到该账号的公开牌谱');
    } else {
      const key = url.searchParams.get('key') || '';
      if (!keyPattern.test(key)) return errResp(403, '复盘链接无效');
      owner = await kv.get('review:' + key);
      if (!owner || await kv.get('reviewKey:' + owner) !== key) return errResp(403, '复盘链接无效');
    }
    const page = await kv.list({ prefix: 'replay:' + owner + ':', limit: 10, cursor: url.searchParams.get('cursor') || undefined });
    const values = await Promise.all(page.keys.map(item => kv.get(item.name)));
    if (!page.list_complete) url.searchParams.set('cursor', page.cursor);
    return jsonResp({ version: 1, rounds: values.filter(Boolean).map(v => JSON.parse(v)), next: page.list_complete ? null : url.href });
  }

  if (!env?.AUTH_SECRET) return errResp(503, '云牌谱服务未配置');
  const uid = await verifyToken(env, getBearer(request));
  if (!uid) return errResp(401, '请先连接云账号');
  if (request.method === 'POST') {
    let key = await kv.get('reviewKey:' + uid);
    if (!key) {
      key = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
      await kv.put('review:' + key, uid);
      await kv.put('reviewKey:' + uid, key);
    }
    return jsonResp({ url: url.origin + '/api/replays?key=' + key });
  }
  if (request.method === 'DELETE') {
    await kv.delete('reviewKey:' + uid);
    return jsonResp({ ok: true });
  }
  if (request.method !== 'PUT') return errResp(405, '请求方法不支持');
  let round;
  try { round = await readReplay(request); }
  catch (e) { return errResp(e instanceof RangeError ? 413 : 400, '牌谱过大或格式异常'); }
  if (round?.version !== 1 || typeof round.id !== 'string' || !/^[a-z0-9-]{3,64}$/.test(round.id)
    || round.initial?.config?.gameMode !== 'san_da_yi' || round.initial?.players?.length !== 4
    || !Array.isArray(round.actions) || round.actions.length > 512) return errResp(400, '牌谱格式不对');
  const name = 'replay:' + uid + ':' + round.id;
  const raw = JSON.stringify(round);
  if (await kv.get(name) !== raw) await kv.put(name, raw);
  return jsonResp({ ok: true, id: round.id });
}
