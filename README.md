# 拖拉机（升级 / 80 分）微信小程序

单机版：1 真人（南）+ 3 AI，4 人 2v2，双副牌 108 张传统拖拉机规则。全部规则参数化（`miniprogram/engine/config.js` 唯一来源，R1~R24）。

当前 `rule-config.js` 默认启用三打一（1 庄家 vs 3 闲家）。默认不打拖拉机，连对也按多副对子甩牌逐对检查；同大不压先出。甩牌失败只出所选牌中被压住的最小单元，其余收回。

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
tests/                Node 内置 node:test 单测（零依赖）
docs/                 PRD 与架构设计文档
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

## 规则配置

所有规则数值（80 分上台、40 分一级、8 张底牌、抠底 ×2 等）只从
`miniprogram/engine/config.js` 读取；`createConfig(overrides)` 合并自定义参数，
规则速查页文案由该配置动态渲染。
