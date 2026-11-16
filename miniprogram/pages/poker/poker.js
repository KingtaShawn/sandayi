"use strict";
const E = require("../../poker/engine");
Page({
  data: {
    counts: [2, 3, 4, 5, 6, 7, 8],
    count: 4,
    sizingLabels: ["⅓ 底池", "½ 底池", "3倍当前注", "4倍当前注"],
    sizingValues: ["third", "half", "triple", "quad"],
    sizingIndex: 0,
    sizingOpen: false,
    players: [],
    board: [],
    hole: [],
    log: [],
    done: true,
  },
  back() { wx.navigateBack(); },
  onLoad() {
    this.s = E.create();
    this.visible = true;
    this.lastHand = 0; this.boardCount = 0; this.dealing = false;
    this.settling = false; this.payoutHand = 0; this.totalsHand = 0; this.totalsSeen = []; this.payoutFlights = []; this.betFlights = [];
    this.render();
  },
  onShow() {
    this.visible = true;
    if (this.s) this.loop();
  },
  onHide() {
    this.visible = false;
    this.setData({ sizingOpen: false });
    clearTimeout(this.timer);
    this.settling = false; this.payoutFlights = [];
  },
  onUnload() {
    this.visible = false;
    clearTimeout(this.timer);
    this.settling = false; this.payoutFlights = [];
  },
  render() {
    const s = this.s,
      l = E.legal(s);
    const pot = s.players.reduce((n, p) => n + (p.total || 0), 0);
    const displayPot = s.done && this.payoutHand === s.hand && !this.settling ? 0 : pot;
    const stackCount = displayPot <= 0 ? 0 : Math.min(7, Math.max(1, Math.ceil(Math.log2(displayPot / 20 + 1))));
    const newHand = this.totalsHand !== s.hand;
    const increases = s.players.map((p,i) => Math.max(0, (p.total || 0) - (newHand ? 0 : (this.totalsSeen[i] || 0))));
    const flightStyle = (i) => {
      const angle = 2 * Math.PI * i / s.players.length;
      return '--dx:' + (-31.58 * Math.sin(angle)) + 'vw;--dy:' + (6.46 + 30.36 * Math.cos(angle)) + 'vh;';
    };
    const freshBets = increases.map((amount,i) => amount ? {id:i, style:flightStyle(i)} : null).filter(Boolean);
    this.recentBet = freshBets.length > 0;
    this.betFlights = freshBets.length ? freshBets : (s.done && this.settling && this.payoutHand !== s.hand ? this.betFlights : []);
    this.totalsHand = s.hand; this.totalsSeen = s.players.map(p => p.total || 0);
    this.setData({
      potStacks: Array.from({length:stackCount},(_,i)=>({id:i,colour:['ivory','red','blue','gold','green','red','gold'][i]})),
      betFlights: this.betFlights,
      payoutFlights: this.payoutFlights,
      settling: this.settling,
      players: s.players.map((p, i) => ({
        name: p.name,
        status: E.seatStatus(s, i),
        award: s.done && !this.dealing && this.payoutHand === s.hand && s.awards ? s.awards[i] || 0 : 0,
        position: p.position || "",
        dealer: s.dealer === i,
        me: i === 0,
        style: 'left:' + (50 - 47 * Math.sin(2 * Math.PI * i / s.players.length)) + '%;top:' + (50 + 47 * Math.cos(2 * Math.PI * i / s.players.length)) + '%;',
        avatar: i === 0 ? '你' : ['','♠','♦','♣','♥','♠','♦','♣','♥'][i],
        chips: s.done && s.awards && (this.payoutHand !== s.hand || this.settling) ? p.chips - (s.awards[i] || 0) : p.chips,
        bet: p.bet || 0,
        active: s.turn === i,
        action: (() => {
          const status = E.seatStatus(s, i);
          const label = {ready:'待发牌', survived:'在座', 'in-hand':'在局', 'all-in':'全押', folded:'弃牌', eliminated:'待补码'}[status];
          return status === 'in-hand' ? label + ' · ' + (p.action || (s.turn === i ? '行动中' : '等待')) : label;
        })(),
        revealed: !!(i !== 0 && p.hole && p.hole.length && s.done && !this.dealing && this.payoutHand === s.hand && s.awards),
        cards:
          i !== 0 && p.hole && p.hole.length && (!p.folded || (s.done && !this.dealing && this.payoutHand === s.hand && s.awards))
            ? s.done && !this.dealing && this.payoutHand === s.hand && s.awards
              ? p.hole.map(E.card).join(" ")
              : "▧ ▧"
            : "",
      })),
      board: (s.board || []).map(E.card),
      hole: (s.players[0].hole || []).map(E.card),
      log: (s.log || []).slice(-8),
      done: s.done,
      human: !this.dealing && !s.done && s.turn === 0,
      canRaise: l.raise,
      call: l.call || 0,
      raiseTo: !this.dealing && !s.done && s.turn === 0 && l.raise ? E.raiseTarget(s, this.data.sizingValues[this.data.sizingIndex]) : null,
      sizingOpen: !this.dealing && !s.done && s.turn === 0 && l.raise ? this.data.sizingOpen : false,
      sizingOptions: this.data.sizingLabels.map((label, i) => ({label, target: !this.dealing && !s.done && s.turn === 0 && l.raise ? E.raiseTarget(s, this.data.sizingValues[i]) : null, selected: i === this.data.sizingIndex})),
      pot: displayPot,
      status: this.dealing ? "荷官正在发牌…" : s.done
        ? (s.awards && this.payoutHand !== s.hand ? "正在结算…" : s.result || "点击下一手开始")
        : s.turn === 0
          ? "轮到你行动" + (s.log.length ? " · " + s.log[s.log.length - 1] : "")
          : (s.log.length ? s.log[s.log.length - 1] + " · " : "") + s.players[s.turn].name + " 正在思考",
      canNext: !this.dealing && !this.settling && s.done,
    });
  },
  loop() {
    clearTimeout(this.timer);
    const newHand = this.s.hand !== this.lastHand;
    const boardCount = (this.s.board || []).length;
    if (newHand || boardCount > this.boardCount) this.dealing = true;
    this.lastHand = this.s.hand; this.boardCount = boardCount;
    this.render();
    if (!this.visible) return;
    if (this.dealing) {
      this.timer = setTimeout(() => { this.dealing = false; this.loop(); }, 2000);
    } else if (this.s.done && this.s.hand && this.s.awards && this.payoutHand !== this.s.hand) {
      const waitForBet = this.recentBet;
      this.settling = true; this.render();
      const distribute = () => {
        this.payoutHand = this.s.hand;
        this.payoutFlights = this.s.awards.map((amount, i) => {
          if (!amount) return null;
          const angle = 2 * Math.PI * i / this.s.players.length;
          return {id:i, style:'--dx:' + (-31.58 * Math.sin(angle)) + 'vw;--dy:' + (6.46 + 30.36 * Math.cos(angle)) + 'vh;animation-delay:' + (i * 80) + 'ms;'};
        }).filter(Boolean);
        this.render();
        this.timer = setTimeout(() => { this.settling = false; this.payoutFlights = []; this.render(); }, 1700);
      };
      if (waitForBet) this.timer = setTimeout(distribute, 900); else distribute();
    } else if (!this.s.done && this.s.turn !== 0) {
      this.timer = setTimeout(() => {
        const m = E.decide(E.observation(this.s, this.s.turn));
        E.action(this.s, m.type, m.target);
        this.loop();
      }, 1200);
    }
  },
  act(e) {
    try {
      if (this.dealing) return;
      let type = e.currentTarget.dataset.type,
        target = type === "raise" ? E.raiseTarget(this.s, this.data.sizingValues[this.data.sizingIndex]) : null;
      if (type === "allin") {
        type = "raise";
        target = E.legal(this.s).max;
      }
      E.action(this.s, type, target);
      this.loop();
    } catch (err) {
      wx.showToast({ title: err.message, icon: "none" });
    }
  },
  next() {
    try {
      E.start(this.s);
      this.loop();
    } catch (err) {
      wx.showToast({ title: err.message, icon: "none" });
    }
  },
  noop() {},
  openSizing() {
    if (this.data.human && this.data.canRaise) this.setData({ sizingOpen: true });
  },
  closeSizing() { this.setData({ sizingOpen: false }); },
  selectSizing(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (!this.data.sizingOpen || !Number.isInteger(index) || index < 0 || index >= this.data.sizingValues.length) return;
    this.setData({ sizingIndex: index, sizingOpen: false });
    this.render();
  },
  count(e) {
    this.setData({ count: Number(e.detail.value) });
  },
  reset() {
    wx.showModal({
      title: "重新开桌",
      content: "清空本桌筹码，按所选人数重新开始？",
      success: (r) => {
        if (r.confirm) {
          this.s = E.create(this.data.count + 2);
          this.dealing = false; this.lastHand = 0; this.boardCount = 0;
          this.settling = false; this.payoutHand = 0; this.totalsHand = 0; this.totalsSeen = []; this.payoutFlights = []; this.betFlights = [];
          this.loop();
        }
      },
    });
  },
});
