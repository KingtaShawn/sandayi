# 三打一微信小程序 + H5

单机版：1 真人（南）+ 3 AI。**三打一**（1 庄家 vs 3 闲家报分定庄），双副牌 108 张；恒打 2，主牌 = 王 + 全部 2 + 主花色（共 36 张）。全部规则参数化（`miniprogram/engine/config.js` 唯一来源，R1~R26）。

规则要点：默认不打拖拉机，连对也按多副对子甩牌逐对检查；同大不压先出。甩牌失败只出所选牌中被压住的最小单元，其余收回，并按原甩牌张数罚 10 分/张给对方阵营。叫分 90 起、步长 10、可跳档、160 封顶，未放弃者循环加价直到无人再加；四家全不叫重发（首报者轮到下家）。跟甩牌有对必逐对跟（领出含 k 对、该门有 m 对须跟 min(k,m) 对）。末墩赢家收底牌分 ×1；庄家得分 ≥ 合同分即庄胜。

引擎另保留升级（2v2）玩法实现（`gameMode: 'shengji'`）；本项目产品定位为三打一。

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
2. 编译预览：首页 → 开始对局 → 完整对局。

## 测试（零依赖，Node ≥ 18）

```bash
node tests/run-tests.js          # 全量
node --test tests/test-combo.js  # 单文件
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

EdgeOne Pages 控制台导入 GitHub 仓库：构建命令 `npm run build:h5`，输出目录 `h5/dist`。
push 即自动部署；默认域名 `*.edgeone.app` 无需备案。

## 规则配置

所有规则数值（起叫分 90、叫分封顶 160、8 张底牌、末墩收底 ×1 等）只从
`miniprogram/engine/config.js` 读取；`createConfig(overrides)` 合并自定义参数，
规则速查页文案由该配置动态渲染。
