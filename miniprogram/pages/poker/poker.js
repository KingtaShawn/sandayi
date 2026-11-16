"use strict";
const E = require("../../poker/engine");
Page({
  data: {
    counts: [2, 3, 4, 5, 6, 7, 8],
    count: 4,
    amount: "",
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
    this.render();
  },
  onShow() {
    this.visible = true;
    if (this.s) this.loop();
  },
  onHide() {
    this.visible = false;
    clearTimeout(this.timer);
  },
  onUnload() {
    this.visible = false;
    clearTimeout(this.timer);
  },
  render() {
    const s = this.s,
      l = E.legal(s);
    this.setData({
      players: s.players.map((p, i) => ({
        name: p.name,
        dealer: s.dealer === i,
        me: i === 0,
        style: 'left:' + (50 - 47 * Math.sin(2 * Math.PI * i / s.players.length)) + '%;top:' + (50 + 47 * Math.cos(2 * Math.PI * i / s.players.length)) + '%;',
        avatar: i === 0 ? '你' : ['','♠','♦','♣','♥','♠','♦','♣','♥'][i],
        chips: p.chips,
        bet: p.bet || 0,
        active: s.turn === i,
        action: p.folded ? "弃牌" : p.action || "",
        cards:
          i !== 0 && p.hole && !p.folded
            ? s.done && s.board.length === 5
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
      amount: String(Math.min(l.min || 20, l.max || 2000)),
      pot: s.done ? 0 : s.players.reduce((n, p) => n + p.total, 0),
      status: this.dealing ? "荷官正在发牌…" : s.done
        ? s.result || "点击下一手开始"
        : s.turn === 0
          ? "轮到你行动" + (s.log.length ? " · " + s.log[s.log.length - 1] : "")
          : (s.log.length ? s.log[s.log.length - 1] + " · " : "") + s.players[s.turn].name + " 正在思考",
      canNext:
        !this.dealing && s.done &&
        s.players[0].chips > 0 &&
        s.players.filter((p) => p.chips > 0).length > 1,
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
        target = Number(this.data.amount);
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
  input(e) {
    this.setData({ amount: e.detail.value });
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
          this.loop();
        }
      },
    });
  },
});
