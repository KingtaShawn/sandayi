"use strict";
const E = require("../../poker/engine");
const M = require("../../poker/motion");
Page({
  data: {
    counts: [2, 3, 4, 5, 6, 7, 8],
    count: 4,
    sizingLabels: ["½ 底池", "全池", "2倍底池", "3倍底池"],
    sizingValues: ["half", "pot", "double", "triple"],
    sizingIndex: 0,
    sizingOpen: false,
    players: [],
    seatMotion: [], boardMotion: [], handMotion: [],
    motionPending: false, motionReady: false, motionHand: false, motionBoardFrom: -1,
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
    this.geometry = null; this.motionSeq = 0; this.pendingDeal = null;
    this.render();
  },
  onShow() {
    this.visible = true;
    if (this.s) this.loop();
  },
  onHide() {
    this.visible = false; this.motionSeq++; this.geometry = null;
    this.setData({ sizingOpen: false });
    clearTimeout(this.timer);
    this.settling = false; this.payoutFlights = [];
  },
  onUnload() {
    this.visible = false; this.motionSeq++; this.geometry = null;
    clearTimeout(this.timer);
    this.settling = false; this.payoutFlights = [];
  },
  // Use the rendered rectangles, not a guessed direction. If geometry is unavailable,
  // omit the transient effect instead of animating toward an arbitrary seat.
  flightStyle(i, delay = 0) {
    const g = this.geometry;
    if (!g || !g.table || !g.pot || !g.seats[i]) return '';
    const start = M.center(g.pot), end = M.center(g.seats[i]), delta = M.between(start, end);
    return 'left:' + (start.x - g.table.left) + 'px;top:' + (start.y - g.table.top) + 'px;--dx:' + delta.x + 'px;--dy:' + delta.y + 'px;animation-delay:' + delay + 'ms;';
  },
  measureMotion(deal, sequence, pendingBets = []) {
    if (!this.visible) return;
    if (!wx.createSelectorQuery) {
      if (deal) this.setData({motionPending:false});
      return;
    }
    const q = wx.createSelectorQuery().in(this);
    q.select('.chip-flights').boundingClientRect();
    q.select('.dealer-avatar').boundingClientRect();
    q.select('.chips').boundingClientRect();
    q.selectAll('.seat').boundingClientRect();
    q.selectAll('.seat-card-back').fields({rect:true,size:true,dataset:true});
    q.selectAll('.board text').boundingClientRect();
    q.selectAll('.hand text').boundingClientRect();
    q.exec(rects => {
      if (!this.visible || sequence !== this.motionSeq) return;
      if (!rects || !rects[0] || !rects[1] || !rects[2] || !rects[3]) {
        if (deal) this.setData({motionPending:false});
        return;
      }
      const g = {table:rects[0], dealer:rects[1], pot:rects[2], seats:rects[3]};
      this.geometry = g;
      if (pendingBets.length) {
        const betFlights = pendingBets.map(i => ({id:i, style:this.flightStyle(i)})).filter(f => f.style);
        this.betFlights = betFlights;
        this.setData({betFlights});
      }
      if (!deal) return;
      const origin = M.center(g.dealer), order = M.dealOrder(this.s.players, this.s.dealer);
      const styleFor = (rect, delay) => {
        if (!rect) return '';
        const d = M.between(M.center(rect), origin);
        return '--deal-x:' + d.x + 'px;--deal-y:' + d.y + 'px;animation-delay:' + delay + 'ms;';
      };
      const seatMotion = [];
      (rects[4] || []).forEach(rect => {
        const i = Number(rect.dataset && rect.dataset.seatIndex);
        const cardIndex = Number(rect.dataset && rect.dataset.cardIndex);
        if (Number.isInteger(i) && i >= 0 && Number.isInteger(cardIndex) && cardIndex >= 0 && cardIndex < 2) {
          if (!seatMotion[i]) seatMotion[i] = [];
          seatMotion[i][cardIndex] = styleFor(rect, (Math.max(0, order.indexOf(i)) + cardIndex * order.length) * 110);
        }
      });
      const boardMotion = (rects[5] || []).map((rect,i) => styleFor(rect, Math.max(0,i-deal.boardFrom)*230));
      const handMotion = (rects[6] || []).map((rect,i) => styleFor(rect, (Math.max(0,order.indexOf(0))+i*order.length)*110));
      this.setData({seatMotion,boardMotion,handMotion,motionPending:false,motionReady:true,motionHand:deal.hand,motionBoardFrom:deal.boardFrom});
    });
  },
  onResize() {
    this.geometry = null; this.motionSeq++; this.pendingDeal = null;
    this.betFlights = []; this.payoutFlights = [];
    this.setData({motionPending:false,motionReady:false,motionHand:false,motionBoardFrom:-1,betFlights:[],payoutFlights:[]});
    this.measureMotion(null,this.motionSeq);
  },
  render() {
    const s = this.s,
      l = E.legal(s);
    const pot = s.players.reduce((n, p) => n + (p.total || 0), 0);
    const displayPot = s.done && this.payoutHand === s.hand && !this.settling ? 0 : pot;
    const stackCount = displayPot <= 0 ? 0 : Math.min(7, Math.max(1, Math.ceil(Math.log2(displayPot / 20 + 1))));
    const newHand = this.totalsHand !== s.hand;
    const increases = s.players.map((p,i) => Math.max(0, (p.total || 0) - (newHand ? 0 : (this.totalsSeen[i] || 0))));
    const pendingBets = !this.geometry ? increases.map((amount,i) => amount ? i : -1).filter(i => i >= 0) : [];
    const freshBets = increases.map((amount,i) => {
      const style = amount ? this.flightStyle(i) : '';
      return style ? {id:i, style} : null;
    }).filter(Boolean);
    this.recentBet = increases.some(Boolean);
    this.betFlights = freshBets.length ? freshBets : (s.done && this.settling && this.payoutHand !== s.hand ? this.betFlights : []);
    this.totalsHand = s.hand; this.totalsSeen = s.players.map(p => p.total || 0);
    const deal = this.pendingDeal; this.pendingDeal = null;
    const sequence = ++this.motionSeq;
    this.setData({
      motionPending:!!deal, motionReady:false, motionHand:!!(deal && deal.hand), motionBoardFrom:deal ? deal.boardFrom : -1,
      potStacks: Array.from({length:stackCount},(_,i)=>({id:i,colour:['ivory','red','blue','gold','green','red','gold'][i]})),
      betFlights: this.betFlights,
      payoutFlights: this.payoutFlights,
      settling: this.settling,
      players: s.players.map((p, i) => ({
        name: p.name,
        status: E.seatStatus(s, i),
        award: s.done && !this.dealing && this.payoutHand === s.hand && s.awards ? s.awards[i] || 0 : 0,
        winner: !!(s.done && !this.dealing && this.payoutHand === s.hand && s.winners && s.winners.includes(i)),
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
          return s.done && !this.dealing && this.payoutHand === s.hand && s.winners && s.winners.includes(i) ? '胜出' : status === 'in-hand' ? label + ' · ' + (p.action || (s.turn === i ? '行动中' : '等待')) : label;
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
      sizingOptions: this.data.sizingLabels.map((label, i) => ({index:i, label, target: !this.dealing && !s.done && s.turn === 0 && l.raise ? E.raiseTarget(s, this.data.sizingValues[i]) : null, selected: i === this.data.sizingIndex})).sort((a,b) => (a.target - b.target) || (a.index - b.index)),
      pot: displayPot,
      status: this.dealing ? "荷官正在发牌…" : s.done
        ? (s.awards && this.payoutHand !== s.hand ? "正在结算…" : s.result || "点击下一手开始")
        : s.turn === 0
          ? "轮到你行动" + (s.log.length ? " · " + s.log[s.log.length - 1] : "")
          : (s.log.length ? s.log[s.log.length - 1] + " · " : "") + s.players[s.turn].name + " 正在思考",
      canNext: !this.dealing && !this.settling && s.done,
    }, () => this.measureMotion(deal, sequence, pendingBets));
  },
  loop() {
    clearTimeout(this.timer);
    const newHand = this.s.hand !== this.lastHand;
    const boardCount = (this.s.board || []).length;
    const newBoard = !newHand && boardCount > this.boardCount;
    if (newHand || newBoard) {
      this.dealing = true;
      this.pendingDeal = {hand:newHand, boardFrom:newBoard ? this.boardCount : -1};
    }
    this.lastHand = this.s.hand; this.boardCount = boardCount;
    this.render();
    if (!this.visible) return;
    if (this.dealing) {
      this.timer = setTimeout(() => { this.dealing = false; this.loop(); }, 2800);
    } else if (this.s.done && this.s.hand && this.s.awards && this.payoutHand !== this.s.hand) {
      const waitForBet = this.recentBet;
      this.settling = true; this.render();
      const distribute = () => {
        this.payoutHand = this.s.hand;
        this.payoutFlights = this.s.awards.map((amount, i) => {
          if (!amount) return null;
          const style = this.flightStyle(i, i * 80);
          return style ? {id:i, style} : null;
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
          this.settling = false; this.payoutHand = 0; this.totalsHand = 0; this.totalsSeen = []; this.payoutFlights = []; this.betFlights = []; this.pendingDeal = null;
          this.geometry = null; this.motionSeq++;
          this.loop();
        }
      },
    });
  },
});
