# functions/ —— 云端接口（EdgeOne Pages 边缘函数）

账号 + 云端档案 + 排行榜的全部后端。逻辑集中在 `_lib/api.js` 一份，边缘函数入口（`api/**`）与本地 `h5/serve.js` 共用，行为不分叉。**发布目录自动带上本目录**（tools/build-h5.js 已拷贝 functions/ → dist/functions/）。

## 上线清单（控制台操作，一次性）

### EdgeOne Pages（H5 后端）
1. **KV 存储**：控制台建一个 KV 命名空间，绑定到本项目，**变量名 `KV`**。
2. **环境变量** `AUTH_SECRET`：随机长字符串（token 签名密钥，泄露=所有人可伪造登录态）。可用 `openssl rand -hex 32` 生成。
3. （可选，开小程序微信登录时）`WX_APPID` / `WX_SECRET`：小程序正式 AppID + AppSecret（公众平台"开发管理"里拿）。不配则小程序端自动降级游客模式，功能不受损。

### 小程序端（miniprogram）
1. **域名**：把 `miniprogram/utils/cloud.js` 顶部 `CLOUD_BASE` 换成 EdgeOne Pages 实际域名（默认 `*.edgeone.app` 免备案）。
2. **request 合法域名**：微信公众平台"开发管理 → 开发设置 → 服务器域名"把该域名加入 request 合法域名。
3. **正式 AppID**：project.config.json 目前是测试号占位（touristappid），发布前替换，并与上面 WX_APPID 一致。
4. 隐私指引：公众平台"隐私保护指引"补充"匿名账号与游戏档案云同步"条目（app.js initPrivacy 注释已同步）。

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
- **LWW + 时间戳防脏**：拒绝未来时间戳，防客户端时钟错乱霸占"最新"。H5 与小程序绑同一账号时，两端档案整体以"最后写入者"为准（单机休闲游戏可接受；联机后改为服务端权威）。
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
