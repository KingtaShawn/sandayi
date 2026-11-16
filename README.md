# 游戏小院：三打一、德州扑克、消除、经典弹球与数独

首页提供六个游戏入口，H5 与微信小程序均可进入。三打一保留原有规则、账号和排行榜；新增 **果园消消乐**：8×8 棋盘、相邻交换三消、连锁计分、12 关目标分数挑战、提示、自动洗牌，以及独立的本机进度/最佳分数。完整规则和实现方案见 [双游戏大厅方案](docs/GAME-LOBBY-MATCH3.md)。H5 手机大厅与消消乐保持自然方向，三打一牌桌继续横屏。

单机版：1 真人（南）+ 3 AI。**三打一**（1 庄家 vs 3 闲家报分定庄），双副牌 108 张；恒打 2，主牌 = 王 + 全部 2 + 主花色（共 36 张）。全部规则参数化（`miniprogram/engine/config.js` 唯一来源，R1~R26）。

奖惩积分：普通胜局 +1、负局 −1；我方阵营得满 200 分获胜时 +2，得 0 分落败时 −2。积分与牌面得分分开，结算展示即记账，首页显示累计积分，随账号战绩同步；保留最近200局时累计余额不丢失。旧局不追补积分，满分坐庄榜仍每局计一次。AI 会为庄家已展开的副牌保留控制牌和缓冲长度，三家公开无主后分工守门，避免被连续对子清空。

规则要点：默认不打拖拉机，连对也按多副对子甩牌逐对检查；同大不压先出。八张同点可整甩（8 个 6 一起出），任何牌压不住（主牌对王也不行），唯有更大的八张同点（级牌八张最大）能压。甩牌失败只出所选牌中被压住的最小单元，其余收回，并按原甩牌张数罚 10 分/张给对方阵营。叫分 90 起、步长 10、可跳档、160 封顶，未放弃者循环加价直到无人再加；四家全不叫重发（首报者轮到下家）。跟甩牌有对必逐对跟（领出含 k 对、该门有 m 对须跟 min(k,m) 对）。末墩赢家收底牌分 ×1；庄家得分 ≥ 合同分即庄胜。

引擎另保留升级（2v2）玩法实现（`gameMode: 'shengji'`）；本项目产品定位为三打一。

新增 **消灭星星**：10×10、5 色、相连两颗起消、平方计分、下落及空列左移、不补块、剩余奖励和累计分数闯关，使用独立本机存档。果园消消乐现支持真实交换轨迹、按空位距离下落、落地轻弹；H5 还包含消除碎片与连锁飘分。规则与验证见 [动画优化与消灭星星](docs/GAME-ANIMATION-POPSTAR.md)。

## 经典弹球与数独

两款游戏均接入 H5 和微信小程序大厅，共用 `miniprogram/breakout/`、`miniprogram/sudoku/` 中的规则逻辑，H5 构建时自动打包。

- **经典弹球**：挡板接球、反弹打砖块，共 6 关、3 条生命。每次击中砖块得 10 分，后期带标记的砖块需要击中两次。触屏拖动或鼠标移动控制挡板，H5 也支持 ← → / A D、空格发球、P / Esc 暂停。挡板边缘改变反弹方向。切换游戏、切后台自动暂停，返回后点击继续；刷新或关闭页面重新开局，历史最高分独立保存在本机。
- **数独**：9×9 棋盘，简单 / 中等 / 困难三档按留白数量区分，随机题目逐次挖空并校验唯一解。支持数字键、候选笔记、擦除、撤销、冲突标记、检查与提示，完成后停表。H5 支持方向键移动、数字键输入、Delete / Backspace 擦除、N 切换笔记。进度、笔记、用时和提示次数独立保存在本机，暂停、弹窗与离开页面不计时；撤销历史仅保留当前页面会话。换题或换难度需要确认。

这两款游戏使用独立存储键 `breakout:best:v1`、`sudoku:progress:v1`，不并入三打一账号积分、战绩或排行榜。

验证：`node --test tests/test-breakout.js tests/test-sudoku.js tests/test-mini-games-mp.js`；`npm run build:h5 && npm run test:h5` 覆盖大厅入口、游戏操作、终局、暂停、存档和切换。小程序生命周期测试使用模拟 wx / Canvas，发布前仍需微信开发者工具及真机验证触屏和 Canvas 2D。

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
2. 编译预览：游戏大厅 → 三打一 / 德州扑克 / 果园消消乐 / 消灭星星 / 经典弹球 / 数独。

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

## 德州扑克

H5 与微信大厅新增德州扑克：默认 1 真人 + 6 AI（可选 2～8 AI），无限注，2000 初始筹码，10/20 盲注；支持全押、边池、平分、短码加注行动权限制；加注提供半池、全池、两倍底池或三倍底池（均以跟注后的底池为基准），并自动调整到合法范围。每手结束后所有参与者亮出底牌。底池筹码堆随金额变化，以数字显示精确金额，收池动画按实际分配飞向获款座位。座位显示本手位置（庄家、小盲、大盲、枪口、中位、劫位、关煞，人数变化时相应调整）；筹码归零的玩家在下一手开始前自动补码 2000，其他玩家保持当前筹码；筹码仅限本桌，重新开桌重置，不并入三打一战绩或账号积分。离开页面暂停，刷新/关闭页面不保留本桌。

AI 使用仅含本人底牌和公共信息的观察对象，蒙特卡洛胜率采样结合底池赔率、位置、价值下注、诈唬及半诈唬。各风格均保留诈唬机会。目前为启发式策略，未经过职业牌手或 GTO 基准认证，不能宣称达到“毒王”水平。

验证：`node --test tests/test-poker.js`；浏览器实现复用 `miniprogram/poker/engine.js`（镜像 `h5/js/poker-engine.js`）。

九人桌策略基准：`node tools/poker-bench.js ./baselines/poker-v1.js 1500`（旧版自我对照在末尾加 `baseline`）。固定随机种子，每手重置 2000 筹码、轮换测试座位，测试牌手面对 8 个旧版 AI；每次决策采样 24 次以控制耗时，实际游戏使用 160 次。该模拟统计每百手筹码变化，牌局和下注随机路径会随策略变化，结果波动较大，不代表职业牌手或真实玩家对局水平。

七人桌入池率基准：`node tools/poker-vpip-bench.js ../miniprogram/poker/engine 3000 392117`。模拟将七个座位都交给 AI，每手重置筹码并轮换庄位；统计翻牌前自愿跟注或加注，不计强制盲注和免费过牌。评估时每次翻后决策采样 12 次以控制耗时（实际游戏为 160 次）。固定种子自对弈用于观察风格，不同策略的随机路径会分叉，不应视为同一组牌的严格配对或职业强度认证。与这次调整前比较时，可先执行 `git show 0cc949a:miniprogram/poker/engine.js > /tmp/sandayi-poker-vpip-before.js`，再运行 `node tools/poker-vpip-bench.js /tmp/sandayi-poker-vpip-before.js 3000 392117`。

德州牌桌的荷官肖像由 AI 生成。发牌按荷官到座位的方向逐张进行，下注与收池分别连接下注座位、底池和实际获款座位；页面旋转时按牌桌坐标换算。若本机装有 Chromium，可运行 `node h5/test/poker-motion-e2e.js` 检查横持与竖持旋转下的实际起终点（也可用 `PUPPETEER_EXECUTABLE_PATH` 指定浏览器）。
