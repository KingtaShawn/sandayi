# functions/ —— 云端接口（EdgeOne Pages 边缘函数）

账号 + 云端档案 + 排行榜的全部后端。逻辑集中在 `_lib/api.js` 一份，边缘函数入口（`api/**`）与本地 `h5/serve.js` 共用，行为不分叉。**发布目录自动带上本目录**（tools/build-h5.js 拷贝 functions/ → dist/functions/ 与 dist/edge-functions/，兼容两种目录约定）。

## 上线清单（后端已上线：Cloudflare Pages）

> **2026-10-25 现状**：后端跑在 **https://sandayi.pages.dev**（Cloudflare Pages 免费档，KV + AUTH_SECRET 已配好，全端点 curl 验证通过）。
> H5 前端 `CLOUD_BASE` 与小程序 `CLOUD_BASE` 均已指向它；github.io 静态站跨域调用同一后端（CORS 已放行）。
>
> 为什么不是 EdgeOne：EdgeOne 默认域名不备案只有 3 小时有效的预览链接、大陆直连 401（官方错误码文档明确），
> 个人无备案域名用不了；`*.workers.dev` 又被大陆 SNI 阻断——`*.pages.dev` 是免费方案里唯一大陆可达的。EdgeOne 兼容代码（双目录 + 全局 KV）保留，将来有备案域名可迁回。

### 日常部署（改了后端代码 h5/functions/** 后）

```bash
npm run build:h5                                              # 重建 dist
wrangler pages functions build --directory h5/dist/functions --outdir /tmp/sdy-worker
cp /tmp/sdy-worker/index.js h5/dist/_worker.js                # Advanced Mode 后端入口
wrangler pages deploy h5/dist --project-name sandayi --branch main
curl https://sandayi.pages.dev/api/leaderboard                # 验证
```

坑位备忘（wrangler 4.15x，2026-10 实测）：
- `functions build --directory` 必须指向 **h5/dist/functions 本体**——指向 dist 根会把目录名拼进路由（/functions/api/...），全部 404 回静态页
- `--outfile` 有 bug 会把上传用的 multipart 原文写进文件，**只能用 --outdir 再拷贝**
- dist/.assetsignore 只 ignore `functions`/`edge-functions`；**千万别把 `_worker.js` 写进去**（会连 worker 入口一起忽略）
- 需要 `compatibility_flags = ["nodejs_compat"]`（wrangler.toml 已配，打包产物引用了 node:stream）
- workers.dev 域名被大陆阻断，别用；pages.dev 可达

### 已配置的资源（Cloudflare 账号内）
- Pages 项目 `sandayi`（production 分支 main，域名 sandayi.pages.dev）
- KV 命名空间 `sandayi-kv`（id 见 wrangler.toml，绑定变量名 KV）
- Secret `AUTH_SECRET`（已注入，值不在代码库）

### 小程序端（miniprogram）
1. **域名**：`miniprogram/utils/cloud.js` 的 `CLOUD_BASE` 已指向 sandayi.pages.dev；开发者工具勾"不校验合法域名"即可联调。
2. **request 合法域名**（正式发布前）：pages.dev 未备案，小程序后台加不进去——届时需备案域名做代理，或后端迁备案平台（EdgeOne 见上文）。
3. **正式 AppID**：project.config.json 目前是测试号占位（touristappid），发布前替换；配 WX_APPID/WX_SECRET secret 后微信登录自动启用（现在 501 降级游客）。
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
