# functions/ —— 云端接口（EdgeOne Pages 边缘函数）

账号 + 云端档案 + 排行榜的全部后端。逻辑集中在 `_lib/api.js` 一份，边缘函数入口（`api/**`）与本地 `h5/serve.js` 共用，行为不分叉。

## 部署配置（EdgeOne Pages 控制台，一次性）

1. **KV 存储**：控制台建一个 KV 命名空间，绑定到本项目，**变量名 `KV`**。
2. **环境变量** `AUTH_SECRET`：随机长字符串（token 签名密钥，泄露=所有人可伪造登录态）。可用 `openssl rand -hex 32` 生成。
3. 小程序登录开通时再配 `WX_APPID` / `WX_SECRET`（调 jscode2session 用；不配则 `/api/auth/wx` 返回 501）。

本地开发零配置：`node h5/serve.js` 自动用固定弱密钥 + `.dev-kv.json` 落盘模拟 KV。

## 端点

| 方法/路径 | 鉴权 | 说明 |
|---|---|---|
| POST /api/auth/guest | 无 | 建游客账号，返回 token（无感登录） |
| POST /api/auth/login | 无 | {username, password} → token + 云端档案 |
| POST /api/auth/bind | Bearer 游客 | 游客升级正式账号，uid 不变战绩不丢 |
| POST /api/auth/wx | 无 | {code} → openid 登录（需 WX_APPID/WX_SECRET） |
| GET /api/sync | Bearer | 拉云端档案 |
| PUT /api/sync | Bearer | 推档案（LWW）+ 合并排行榜 |
| GET /api/leaderboard | 无 | top100（≥20 局才上榜） |

## 设计取舍（改这里前先读）

- **无状态 token**（HMAC 签名）：KV 最终一致（~60s 传播），会话存 KV 会出现"注册完立刻登录失败"；验签零回读。
- **档案同步搬原始字符串**：客户端把 localStorage 各键原样上传（含双重 stringify），服务端不解析内容——引擎存档 schema 永远不需要后端跟进。
- **LWW + 时间戳防脏**：拒绝未来时间戳，防客户端时钟错乱霸占"最新"。
- **排行榜单机战绩天然可刷**：休闲榜不做反作弊，联机后才可信。
- **PBKDF2 50k 迭代**：边缘 CPU 受限的折中；若注册接口偶发超时再下调。

## KV 键一览

```
u:{uid}        用户档案 JSON（nick/created/login{salt,hash}/wxOpenid）
login:{name}   用户名小写 → uid 索引（重名竞态窗口 ~60s，可接受）
wx:{openid}    openid → uid（小程序）
save:{uid}     云端档案 {updatedAt, data:{键:原始字符串}}
lb:global      排行榜快照 top100
```
