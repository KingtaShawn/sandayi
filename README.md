# 游戏小院：三打一 + 果园消消乐 + 消灭星星

首页提供三个游戏入口，H5 与微信小程序均可进入。三打一保留原有规则、账号和排行榜；新增 **果园消消乐**：8×8 棋盘、相邻交换三消、连锁计分、12 关目标分数挑战、提示、自动洗牌，以及独立的本机进度/最佳分数。完整规则和实现方案见 [双游戏大厅方案](docs/GAME-LOBBY-MATCH3.md)。H5 手机大厅与消消乐保持自然方向，三打一牌桌继续横屏。

单机版：1 真人（南）+ 3 AI。**三打一**（1 庄家 vs 3 闲家报分定庄），双副牌 108 张；恒打 2，主牌 = 王 + 全部 2 + 主花色（共 36 张）。全部规则参数化（`miniprogram/engine/config.js` 唯一来源，R1~R26）。

奖惩积分：普通胜局 +1、负局 −1；我方阵营得满 200 分获胜时 +2，得 0 分落败时 −2。积分与牌面得分分开，结算展示即记账，首页显示累计积分，随账号战绩同步；保留最近200局时累计余额不丢失。旧局不追补积分，满分坐庄榜仍每局计一次。AI 会为庄家已展开的副牌保留控制牌和缓冲长度，三家公开无主后分工守门，避免被连续对子清空。

规则要点：默认不打拖拉机，连对也按多副对子甩牌逐对检查；同大不压先出。八张同点可整甩（8 个 6 一起出），任何牌压不住（主牌对王也不行），唯有更大的八张同点（级牌八张最大）能压。甩牌失败只出所选牌中被压住的最小单元，其余收回，并按原甩牌张数罚 10 分/张给对方阵营。叫分 90 起、步长 10、可跳档、160 封顶，未放弃者循环加价直到无人再加；四家全不叫重发（首报者轮到下家）。跟甩牌有对必逐对跟（领出含 k 对、该门有 m 对须跟 min(k,m) 对）。末墩赢家收底牌分 ×1；庄家得分 ≥ 合同分即庄胜。

引擎另保留升级（2v2）玩法实现（`gameMode: 'shengji'`）；本项目产品定位为三打一。

新增 **消灭星星**：10×10、5 色、相连两颗起消、平方计分、下落及空列左移、不补块、剩余奖励和累计分数闯关，使用独立本机存档。果园消消乐现支持真实交换轨迹、按空位距离下落、落地轻弹；H5 还包含消除碎片与连锁飘分。规则与验证见 [动画优化与消灭星星](docs/GAME-ANIMATION-POPSTAR.md)。

## 目录

```
miniprogram/          小程序主体（微信原生，CommonJS）
  engine/             规则引擎（纯函数，Node 直跑，禁 wx.*）
  core/               游戏状态机（纯逻辑，禁 wx.*）
  ai/                 AI 策略（贪心启发式，禁 wx.*）
  services/           应用服务层（GameService/hint/stats，禁 wx.*）
  storage/            持久化适配（wx.setStorageSync 封装，唯一 wx.* 存储点）
  utils/              随机源/格式化
  pages/              首页 / 牌桌 / 规则速查
  components/         牌张/手牌区/出牌区/座位/状态栏/亮主条/埋底条/结算/历史
h5/                   H5 版（app.js 主程序 + 构建产物）
tests/                Node 内置 node:test 单测（零依赖）
docs/                 AI 长期优化路线图、系统类图/时序图
```

## 开发

1. 微信开发者工具导入项目根目录（`project.config.json`，appid 为测试号占位）。
2. 编译预览：游戏大厅 → 三打一 / 果园消消乐。

## 测试（零依赖，Node ≥ 18）

```bash
node tests/run-tests.js          # 全量
node --test tests/test-combo.js  # 单文件
npm run build:h5 && npm run test:h5  # H5 DOM 集成检查（先 npm ci --ignore-scripts 安装开发依赖）
```

AI 压测：`node --test tests/test-ai-legal.js`（100 局完整模拟，零非法出牌断言）。
AI 对弈基准：`node tools/ai-bench.js 400`（同种子 A/B 双向判定，见 `docs/AI-LONG-TERM-UPGRADE.md`）。

## 发布 H5（EdgeOne Pages）

```bash
npm run build:h5   # 重打 game-bundle → h5/dist/（只含发布文件，注入 ?v= 版本号防缓存）
```

## 音乐素材

背景音乐（`h5/music/bgm.m4a`）：[Monkeys Spinning Monkeys — Kevin MacLeod](https://incompetech.com/music/royalty-free/)，
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)（俏皮钢琴，免费音乐圈最出名的曲目之一）。
取原曲标志性钢琴起句 16 秒 + 全乐队热闹段 50 秒拼成 72 秒无缝循环：段间与循环点均 3 秒
等功率交叉淡化，接缝两侧响度差 0.02dB，单声道 64kbps AAC。🎵 开关状态与音效独立，
存 `tractor:settings.music`。

两个入口由同一个 GitHub Actions 工作流（`.github/workflows/deploy-h5.yml`）自动发布：每次 push 到 `main`，先运行测试并构建一次，再独立发布 Cloudflare Pages 和 GitHub Pages，各自核对线上版本、静态资源哈希及 API，最后统一复核。单个入口发布失败不会阻塞另一个入口更新；修复授权后可重跑失败任务补发。支持在 Actions 中手动重新发布 `main`；同一时间只执行一轮发布。
- **GitHub Pages（玩家主入口，静态）**：`https://kingtashawn.github.io/sandayi/`。云端功能跨域调用下面的后端（`CLOUD_BASE` 已配置）。
- **Cloudflare Pages（全栈，后端+备用入口）**：`https://sandayi.pages.dev`，同源带 `/api` 后端（KV + AUTH_SECRET 已配）。工作流携带编译后的 `_worker.js`，保留账号、存档和排行榜；首次授权及手动部署见 `h5/functions/README.md`。

## 规则配置

所有规则数值（起叫分 90、叫分封顶 160、8 张底牌、末墩收底 ×1 等）只从
`miniprogram/engine/config.js` 读取；`createConfig(overrides)` 合并自定义参数，
规则速查页文案由该配置动态渲染。
