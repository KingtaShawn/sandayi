# functions/ —— 云端接口（EdgeOne Pages 边缘函数）

账号 + 云端档案 + 排行榜的全部后端。逻辑集中在 `_lib/api.js` 一份，边缘函数入口（`api/**`）与本地 `h5/serve.js` 共用，行为不分叉。**发布目录自动带上本目录**（tools/build-h5.js 拷贝 functions/ → dist/functions/ 与 dist/edge-functions/，兼容两种目录约定）。

## 上线清单（后端已上线：Cloudflare Pages）

> **2026-10-25 现状**：后端跑在 **https://sandayi.pages.dev**（Cloudflare Pages 免费档，KV + AUTH_SECRET 已配好，全端点 curl 验证通过）。
> H5 前端 `CLOUD_BASE` 与小程序 `CLOUD_BASE` 均已指向它；github.io 静态站跨域调用同一后端（CORS 已放行）。
>
> 为什么不是 EdgeOne：EdgeOne 默认域名不备案只有 3 小时有效的预览链接、大陆直连 401（官方错误码文档明确），
> 个人无备案域名用不了；`*.workers.dev` 又被大陆 SNI 阻断——`*.pages.dev` 是免费方案里唯一大陆可达的。EdgeOne 兼容代码（双目录 + 全局 KV）保留，将来有备案域名可迁回。

### 自动部署（前端、AI 与后端共用）

每次推送 `main`，`.github/workflows/deploy-h5.yml` 会运行测试并构建一次 H5，生成 Cloudflare API Worker，再由两个独立任务发布到 `sandayi.pages.dev` 和 GitHub Pages。每个入口发布后分别核对版本及 6 项静态资源哈希，并检查排行榜、CORS 和存档鉴权；两边成功后再统一复核。单个入口发布失败会在 Actions 中显示，不阻塞另一个入口更新。两家平台不能原子切换，发布期间可能短暂不同步；修复授权后可在同一工作流运行中选择 Re-run failed jobs，使用原来的构建补发。

GitHub 仓库 **Settings → Secrets and variables → Actions** 需要一次性配置：
- Secret `CLOUDFLARE_API_TOKEN`：Cloudflare 自定义 API Token，权限为 **Account → Cloudflare Pages → Edit**，账户限定为该项目所在账户。
- Variable `CLOUDFLARE_ACCOUNT_ID`：项目所在的 Cloudflare Account ID。

令牌只存 GitHub Secret；本机 Wrangler 的 OAuth 登录和刷新令牌不用于 CI。现有云端 `AUTH_SECRET` 与 KV 绑定继续沿用 `wrangler.toml` 配置，无需放入 GitHub。

工作流固定使用 Wrangler `4.152.0`、Node.js 22；只允许 `main` 发布生产入口。若更新工具版本，需要验证下面的 Worker 构建行为以及 `/api` 端点。

### 手动部署（故障恢复）

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
| GET /api/leaderboard | 无 | 满分坐庄榜 top100（至少满分坐庄1次） |

## 设计取舍（改这里前先读）

- **无状态 token**（HMAC 签名）：KV 最终一致（~60s 传播），会话存 KV 会出现"注册完立刻登录失败"；验签零回读。
- **档案同步搬原始字符串**：客户端把 localStorage 各键原样上传（含双重 stringify），服务端不解析内容——引擎存档 schema 永远不需要后端跟进。
- **LWW + 时间戳防脏**：普通档案按最后写入者合并，拒绝未来时间戳。满分坐庄累计次数单独取设备、现存档案和榜单中的较大值，避免迟到同步倒扣；同步响应捎带本次已确认的榜单行，客户端可在KV缓存传播前显示自己的最新成绩。
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
