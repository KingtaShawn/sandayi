/**
 * rule-config.js —— 【三打一规则后台配置】
 *
 * 使用方法：改完保存 → 开发者工具点「编译」→ 开新一局生效。
 * 改错的值会自动回退默认，不会崩。
 * 每个参数上方的中文注释就是说明，直接改注释不影响程序。
 */

module.exports = {

  /* ══════════ 玩法模式 ══════════ */

  // shengji=升级（2v2，打2到A） | san_da_yi=三打一（1v3，报分定庄，恒打2，主牌=王+2）
  gameMode: 'san_da_yi',

  /* ══════════ 三打一参数（gameMode='san_da_yi' 时生效） ══════════ */

  // 默认不打拖拉机：连对也按多副对子甩牌；必须每个对子都不被更大的同门对子压住
  sanDaYiAllowTractor: false,

  // 起叫分（90 起）
  sanDaYiBidStart: 90,

  // 叫分最小步长（90→100→110…→160；加价可跳档，如 90→130）
  sanDaYiBidStep: 10,

  // 叫分上限（160，报满即成交坐庄）
  sanDaYiBidCap: 160,

  // 全员不叫时：redeal=重新发牌（首报者轮到原首报者下家） | force_lowest=首位强制打最低分
  sanDaYiNoBidAction: 'redeal',

  // 成交分 ≤ 此值时闲家可看底牌（-1=不公开看底）
  sanDaYiPeekBottomMaxBid: -1,

  /* ══════════ 牌与发牌 ══════════ */

  // R1 牌副数（1/2/3）：2=双副牌108张（传统80分玩法）
  deckCount: 2,

  // R2 底牌张数（4~12）：埋底阶段庄家扣下的牌数，传统为 8
  bottomCards: 8,

  // 分牌面值：哪个点数算几分（可自定义，如把 J 也算 10 分就加 J: 10）
  pointValues: { '5': 5, '10': 10, 'K': 10 },

  /* ══════════ 级数（升级模式） ══════════ */

  // R3 起始级牌：两队最初打几（2~A 任选）
  rankStart: '2',

  // R4 终局级牌：打到这张牌且满足过A条件就获胜（默认 A）
  rankEnd: 'A',

  /* ══════════ 计分与升级（升级模式） ══════════ */

  // R5 上台分：攻方拿到这个分数就上台（默认 80）
  pointsToTake: 80,

  // R6 每级分数：上台后每多拿这么多分多升 1 级（默认 40）
  pointsPerLevel: 40,

  // R7 大光奖励：守方 0 分时额外升几级（默认 1）
  cleanSweepBonusLevels: 1,

  // R18 升级幅度表：standard=标准公式（0分升3/小光升2/40-79升1/80起每40分+1级）
  levelUpTable: 'standard',

  // R15 过A条件：small_light=小光(对方<40分)才过A | win=赢局即过 | big_light=大光(对方0分)才过
  passACondition: 'small_light',

  // R24 整轮目标：first_pass_A=先过A者胜 | loop=打过A后循环继续
  roundGoal: 'first_pass_A',

  /* ══════════ 主牌 ══════════ */

  // R8 是否允许无主局：true=对王可反成无主（主牌只剩王和级牌共12张）
  allowNoTrump: true,

  // R13 副级牌同为大时：true=先出为大（传统）| false=按花色固定序
  offSuitRankTieFirstWin: true,

  /* ══════════ 抠底 ══════════ */

  // R9 抠底倍数（×1/×2/×4/×8）：最后一墩赢家收底牌分×此倍数。注意：R10 开启后本项失效
  bottomMultiplier: 2,

  // R10 抠底按牌型加倍：false=统一用上面的倍数 | true=单张×2、对子×4、拖拉机×8（用下面明细）
  bottomMultiplierByType: false,

  // R10 明细：抠底所用最后牌型对应的倍数（甩牌取其中最大单元）
  bottomMultiplierTable: { single: 2, pair: 4, tractor: 8, throw: 8 },

  /* ══════════ 跟牌 ══════════ */

  // R11 有对必跟对：true=手上有领出花色的对子时必须跟对子（严格）| false=可拆对垫牌
  mustFollowPairAsPair: true,

  // R12 有拖必跟拖：true=手上有拖拉机时必须跟拖拉机 | false=可拆
  mustFollowTractorAsTractor: true,

  /* ══════════ 甩牌 ══════════ */

  // R14 甩牌不成立时：reject=禁止出 | smallest=只出被压住的最小单元 | penalty_smallest=再罚10分/原甩牌张
  // 失败只出本次甩牌中被压住的最小单张/对子，其余收回；不会抽取未选手牌或拆散对子。
  // 混花色（跨域）不属于甩牌范畴，仍走 E112「出牌必须同域」直接禁止
  throwPenalty: 'penalty_smallest',

  /* ══════════ 流程 ══════════ */

  // R16 下局谁坐庄（升级模式）：winner_stays=胜方定主者坐庄 | rotate=轮流 | bidder_always=本局定主者优先
  dealerPassRule: 'winner_stays',

  // R17 亮主截止：before_bottom_flip=埋底前都可亮反 | after_deal=发牌结束即截止
  bidDeadLine: 'before_bottom_flip',

  // R19 出牌方向：counterclockwise=逆时针（传统）| clockwise=顺时针
  playDirection: 'counterclockwise',

  // R20 无人亮主时（升级模式）：flip_bottom=翻底牌定主 | redeal=重新发牌
  noBidFallback: 'flip_bottom',

  /* ══════════ 反主 ══════════ */

  // R21 单王反无主：true=亮一张王即可反成无主（激进地方玩法）
  allowSingleJokerOverride: false,

  /* ══════════ 牌型 ══════════ */

  // R22 不同花色的两张副级牌对是否构成拖拉机：true=算（地方玩法）| false=不算（严格）
  offSuitRankPairAsTractor: false,

  /* ══════════ 体验 ══════════ */

  // R23 AI 出牌节奏（秒）：[最短, 最长] 区间随机。想更快改 [0.4, 0.8]
  aiPaceSeconds: [0.8, 1.5]
};
