"use strict";
// Shared no-limit hold'em engine. Chips are integers; bots receive only public information.
(function (root) {
  const names = ["你", "小扁豆", "儿颠颠", "三老蛤", "滴滴佬", "马老五", "小腊顺", "霜刃", "逐浪"];
  const labels = [
    "高牌",
    "一对",
    "两对",
    "三条",
    "顺子",
    "同花",
    "葫芦",
    "四条",
    "同花顺",
  ];
  function deck(rng = Math.random) {
    const d = Array.from({ length: 52 }, (_, i) => i);
    for (let i = 51; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }
  const rank = (c) => (c % 13) + 2;
  function five(cards) {
    const rs = cards.map(rank).sort((a, b) => b - a),
      counts = {};
    rs.forEach((r) => (counts[r] = (counts[r] || 0) + 1));
    const groups = Object.keys(counts)
      .map(Number)
      .sort((a, b) => counts[b] - counts[a] || b - a);
    const flush = cards.every(
      (c) => Math.floor(c / 13) === Math.floor(cards[0] / 13),
    );
    let u = [...new Set(rs)];
    if (u.includes(14)) u.push(1);
    let straight = 0;
    for (let i = 0; i <= u.length - 5; i++)
      if (u[i] - u[i + 4] === 4) {
        straight = u[i];
        break;
      }
    let v;
    if (flush && straight) v = [8, straight];
    else if (counts[groups[0]] === 4) v = [7, ...groups];
    else if (counts[groups[0]] === 3 && counts[groups[1]] === 2)
      v = [6, ...groups];
    else if (flush) v = [5, ...rs];
    else if (straight) v = [4, straight];
    else if (counts[groups[0]] === 3) v = [3, ...groups];
    else if (counts[groups[0]] === 2 && counts[groups[1]] === 2)
      v = [2, ...groups];
    else if (counts[groups[0]] === 2) v = [1, ...groups];
    else v = [0, ...rs];
    while (v.length < 6) v.push(0);
    return v.reduce((a, b) => a * 15 + b, 0);
  }
  function evaluate(cards) {
    let best = 0;
    for (let a = 0; a < cards.length - 4; a++)
      for (let b = a + 1; b < cards.length - 3; b++)
        for (let c = b + 1; c < cards.length - 2; c++)
          for (let d = c + 1; d < cards.length - 1; d++)
            for (let e = d + 1; e < cards.length; e++)
              best = Math.max(
                best,
                five([cards[a], cards[b], cards[c], cards[d], cards[e]]),
              );
    return best;
  }
  function card(c) {
    return (
      ["♠", "♥", "♣", "♦"][Math.floor(c / 13)] +
      ({ 11: "J", 12: "Q", 13: "K", 14: "A" }[rank(c)] || rank(c))
    );
  }
  function create(n = 6) {
    if (!Number.isInteger(n) || n < 2 || n > 8) throw Error("AI 数量需为 2～8");
    return {
      players: names.slice(0, n + 1).map((name) => ({ name, chips: 2000 })),
      dealer: -1,
      hand: 0,
      done: true,
      log: [],
    };
  }
  function next(s, i, predicate) {
    for (let k = 1; k <= s.players.length; k++) {
      let j = (i + k) % s.players.length;
      if (predicate(s.players[j], j)) return j;
    }
    return -1;
  }
  function pay(s, i, amount) {
    const p = s.players[i],
      v = Math.min(p.chips, amount);
    p.chips -= v;
    p.bet += v;
    p.total += v;
  }
  function start(s, rng = Math.random) {
    if (!s.done) throw Error("本手尚未结束");
    // Rebuy only between hands, after settlement and before posting blinds.
    const rebuys = s.players.map((p, i) => p.chips === 0 ? i : -1).filter(i => i >= 0);
    rebuys.forEach(i => { s.players[i].chips += 2000; });
    s.rebuys = rebuys;
    s.winners = [];
    s.hand++;
    s.done = false;
    s.board = [];
    s.deck = deck(rng);
    s.street = 0;
    s.current = 20;
    s.minRaise = 20;
    s.log = rebuys.map(i => s.players[i].name + "：补码 2000");
    s.players.forEach((p, i) =>
      Object.assign(p, {
        hole: [],
        bet: 0,
        total: 0,
        folded: p.chips === 0,
        action: rebuys.includes(i) ? "补码 2000" : "",
        position: "",
      }),
    );
    s.dealer = next(s, s.dealer, (p) => p.chips > 0);
    s.players
      .filter((p) => !p.folded)
      .forEach((p) => (p.hole = [s.deck.pop(), s.deck.pop()]));
    let sb =
        s.players.filter((p) => !p.folded).length === 2
          ? s.dealer
          : next(s, s.dealer, (p) => !p.folded),
      bb = next(s, sb, (p) => !p.folded);
    // Position belongs to a hand, so retain it after folding or going all-in.
    s.players[s.dealer].position = sb === s.dealer ? "庄家/小盲" : "庄家";
    if (sb !== s.dealer) s.players[sb].position = "小盲";
    s.players[bb].position = "大盲";
    const earlyPositions = {
      2: [], 3: [], 4: ["枪口"], 5: ["枪口", "关煞"],
      6: ["枪口", "劫位", "关煞"],
      7: ["枪口", "中位", "劫位", "关煞"],
      8: ["枪口", "枪口+1", "中位", "劫位", "关煞"],
      9: ["枪口", "枪口+1", "枪口+2", "中位", "劫位", "关煞"],
    };
    let seat = bb;
    const count = s.players.filter(p => !p.folded).length;
    earlyPositions[count].forEach(position => {
      seat = next(s, seat, p => !p.folded);
      s.players[seat].position = position;
    });
    pay(s, sb, 10);
    pay(s, bb, 20);
    s.pending = s.players
      .map((p, i) => (p.chips && !p.folded ? i : -1))
      .filter((i) => i >= 0);
    s.rights = s.pending.slice();
    s.turn = next(s, bb, (p, i) => s.pending.includes(i));
    advance(s);
    return s;
  }
  function legal(s) {
    if (s.done || s.turn < 0) return {};
    const p = s.players[s.turn],
      call = Math.min(p.chips, s.current - p.bet);
    return {
      call,
      min: s.current + s.minRaise,
      max: p.bet + p.chips,
      raise:
        s.rights.includes(s.turn) &&
        p.bet + p.chips > s.current &&
        s.players.some((q, i) => i !== s.turn && !q.folded && q.chips > 0),
    };
  }
  // Presets return the player's total contribution on this betting round.
  // All displayed sizes use the pot after calling; result is the round total.
  function raiseTarget(s, preset) {
    const l = legal(s);
    if (!l.raise) return null;
    const pot = s.players.reduce((sum, p) => sum + (p.total || 0), 0);
    let desired;
    const fractions = {quarter: 1 / 4, third: 1 / 3, half: 1 / 2, twoThirds: 2 / 3, threeQuarters: 3 / 4, pot: 1, double: 2, triple: 3};
    if (Object.prototype.hasOwnProperty.call(fractions, preset)) {
      desired = s.current + Math.round((pot + l.call) * fractions[preset]);
    } else if (preset === "quad") {
      desired = s.current * 4;
    } else { throw Error("未知下注选项"); }
    return Math.min(l.max, Math.max(l.min, desired));
  }
  function action(s, type, target) {
    const i = s.turn,
      p = s.players[i],
      l = legal(s);
    if (s.done || !p || !s.pending.includes(i)) throw Error("尚未轮到行动");
    if (!["fold", "call", "raise"].includes(type)) throw Error("非法行动");
    if (
      type === "raise" &&
      (!l.raise ||
        !Number.isInteger(target) ||
        target <= s.current ||
        target > l.max ||
        (target < l.min && target !== l.max))
    )
      throw Error("加注金额无效");
    s.pending = s.pending.filter((j) => j !== i);
    s.rights = s.rights.filter((j) => j !== i);
    if (type === "fold") {
      p.folded = true;
      p.action = "弃牌";
    } else if (type === "call") {
      pay(s, i, l.call);
      p.action = l.call ? "跟注 " + l.call : "过牌";
    } else {
      const increase = target - s.current;
      pay(s, i, target - p.bet);
      s.current = target;
      p.action = "加注至 " + target;
      if (increase >= s.minRaise) {
        s.minRaise = increase;
        s.pending = s.players
          .map((q, j) => (j !== i && !q.folded && q.chips > 0 ? j : -1))
          .filter((j) => j >= 0);
        s.rights = s.pending.slice();
      } else
        s.players.forEach((q, j) => {
          if (
            j !== i &&
            !q.folded &&
            q.chips > 0 &&
            q.bet < s.current &&
            !s.pending.includes(j)
          )
            s.pending.push(j);
        });
    }
    s.log.push(p.name + "：" + p.action);
    s.turn = next(
      s,
      i,
      (q, j) => s.pending.includes(j) && !q.folded && q.chips > 0,
    );
    advance(s);
    return s;
  }
  function settle(s) {
    const ps = s.players,
      live = ps.filter((p) => !p.folded);
    s.awards = ps.map(() => 0);
    s.winners = [];
    const levels = [...new Set(ps.map((p) => p.total).filter(Boolean))].sort(
      (a, b) => a - b,
    );
    let prev = 0;
    levels.forEach((level) => {
      const contributors = ps.filter((p) => p.total >= level),
        pot = (level - prev) * contributors.length;
      prev = level;
      let eligible = ps
        .map((p, i) => (!p.folded && p.total >= level ? i : -1))
        .filter((i) => i >= 0);
      if (!eligible.length) {
        contributors.forEach((p) => {
          const i = ps.indexOf(p);
          s.awards[i] += level - (levels[levels.indexOf(level) - 1] || 0);
        });
        return;
      }
      let winners = eligible;
      if (live.length > 1) {
        let best = Math.max(
          ...eligible.map((i) => evaluate(ps[i].hole.concat(s.board))),
        );
        winners = eligible.filter(
          (i) => evaluate(ps[i].hole.concat(s.board)) === best,
        );
      }
      winners.sort(
        (a, b) =>
          ((a - s.dealer + ps.length - 1) % ps.length) -
          ((b - s.dealer + ps.length - 1) % ps.length),
      );
      winners.forEach((i, k) => {
        const amount = Math.floor(pot / winners.length) + (k < pot % winners.length ? 1 : 0);
        s.awards[i] += amount;
        // A one-contributor layer is an uncalled bet returned, not a won pot.
        if (contributors.length > 1 && amount > 0 && !s.winners.includes(i)) s.winners.push(i);
      });
    });
    ps.forEach((p, i) => (p.chips += s.awards[i]));
    s.done = true;
    s.turn = -1;
    s.result = s.awards
      .map((v, i) => (v ? ps[i].name + " 收获 " + v : ""))
      .filter(Boolean)
      .join(" · ");
  }
  function advance(s) {
    if (s.players.filter((p) => !p.folded).length === 1) {
      settle(s);
      return;
    }
    s.pending = s.pending.filter(
      (i) => !s.players[i].folded && s.players[i].chips > 0,
    );
    const active = s.players.filter((p) => !p.folded && p.chips > 0);
    if (active.length === 1 && active[0].bet >= s.current) s.pending = [];
    if (s.pending.length) return;
    if (s.street === 3) {
      settle(s);
      return;
    }
    s.street++;
    s.deck.pop();
    const count = s.street === 1 ? 3 : 1;
    for (let k = 0; k < count; k++) s.board.push(s.deck.pop());
    s.players.forEach((p) => {
      p.bet = 0;
      p.action = "";
    });
    s.current = 0;
    s.minRaise = 20;
    s.pending = s.players
      .map((p, i) => (!p.folded && p.chips > 0 ? i : -1))
      .filter((i) => i >= 0);
    s.rights = s.pending.slice();
    s.turn = next(s, s.dealer, (p, i) => s.pending.includes(i));
    if (s.pending.length <= 1) {
      s.pending = [];
      advance(s);
    }
  }
  // A zero stack during a hand may be an all-in, which remains eligible to win.
  function seatStatus(s, i) {
    const p = s.players[i];
    if (p.chips === 0 && (s.done || !p.hole || p.hole.length === 0)) return "eliminated";
    if (!s.hand) return "ready";
    if (s.done) return "survived";
    if (p.folded) return "folded";
    if (p.chips === 0) return "all-in";
    return "in-hand";
  }
  function observation(s, i) {
    return {
      hole: s.players[i].hole.slice(),
      board: s.board.slice(),
      street: s.street,
      dealer: s.dealer,
      seat: i,
      current: s.current,
      minRaise: s.minRaise,
      players: s.players.map((p) => ({
        chips: p.chips,
        bet: p.bet,
        total: p.total,
        folded: p.folded,
      })),
      canRaise: s.rights.includes(i),
    };
  }
  function decide(o, rng = Math.random, trials = 160) {
    const p = o.players[o.seat],
      opponents = o.players.filter((q, i) => i !== o.seat && !q.folded).length;
    const known = new Set(o.hole.concat(o.board)),
      unknown = Array.from({ length: 52 }, (_, i) => i).filter(
        (c) => !known.has(c),
      );
    // Opening ranges avoid limping almost every hand at a full table. The
    // threshold tightens in early position and when facing a raise.
    if (o.street === 0) {
      const r = o.hole.map(rank).sort((a, b) => b - a);
      const suited = Math.floor(o.hole[0] / 13) === Math.floor(o.hole[1] / 13);
      const pair = r[0] === r[1];
      let strength = pair ? 45 + r[0] * 3 : r[0] * 2 + r[1];
      if (!pair && suited) strength += 5;
      if (!pair && r[0] - r[1] <= 2) strength += 3;
      const pos = (o.seat - o.dealer + o.players.length) % o.players.length;
      const late = pos === 0 || pos >= o.players.length - 2;
      const cost = Math.max(0, o.current - p.bet);
      const unopened = o.current <= 20;
      // A few opponents play a wider range, without bypassing price or stack limits.
      const looseness = [0, 4, 0, 0, 5, 0, 4, 0, 0][o.seat] || 0;
      const threshold = (unopened ? (late ? 43 : 48) : 58 + Math.min(10, Math.max(0, o.current / 20 - 3))) - looseness;
      const canRaise = o.canRaise && p.bet + p.chips > o.current && o.players.some((q,i)=>i!==o.seat&&!q.folded&&q.chips>0);
      if (canRaise && strength >= threshold) {
        const desired = unopened ? (late ? 50 : 60) : Math.round(o.current * 3 / 10) * 10;
        const target = Math.min(p.bet + p.chips, Math.max(o.current + o.minRaise, desired));
        return {type: "raise", target};
      }
      // Defend blinds and speculative hands only at a tolerable price.
      if (cost === 0) return {type: "call"};
      const callThreshold = (unopened ? (late ? 38 : 42) : 48 + Math.min(12, Math.max(0, o.current / 20 - 3))) - looseness;
      if (strength < callThreshold || cost > p.chips * (pair && r[0]>=11 ? 0.65 : 0.18)) return {type: "fold"};
      return {type: "call"};
    }
    let equity = 0;
    for (let t = 0; t < trials; t++) {
      let pool = unknown.slice();
      const draw = () => pool.splice(Math.floor(rng() * pool.length), 1)[0];
      let board = o.board.slice();
      while (board.length < 5) board.push(draw());
      const hero = evaluate(o.hole.concat(board));
      let wins = true,
        ties = 1;
      for (let j = 0; j < opponents; j++) {
        const score = evaluate([draw(), draw()].concat(board));
        if (score > hero) wins = false;
        else if (score === hero) ties++;
      }
      if (wins) equity += 1 / ties;
    }
    equity /= trials;
    const pot = o.players.reduce((v, q) => v + q.total, 0),
      cost = o.current - p.bet,
      odds = cost / (pot + cost || 1),
      max = p.bet + p.chips;
    const position = (o.seat - o.dealer + o.players.length) % o.players.length;
    const aggression = [0, 0.12, 0.09, 0.06, 0.1, 0.15, 0.08, 0.11, 0.14][o.seat] || 0.1;
    const suited = Math.floor(o.hole[0] / 13) === Math.floor(o.hole[1] / 13),
      ranks = o.hole.map(rank);
    const draw =
      o.board.length > 0 &&
      o.board.length < 5 &&
      ((suited &&
        o.board.filter((c) => Math.floor(c / 13) === Math.floor(o.hole[0] / 13))
          .length >= 2) ||
        Math.abs(ranks[0] - ranks[1]) <= 2);
    const bluff =
      rng() <
      aggression * (opponents === 1 ? 1.5 : 0.45) * (position === 0 ? 1.4 : 1);
    const value = equity > Math.max(0.56, 1 / (opponents + 1) + 0.22);
    if (
      o.canRaise &&
      max > o.current &&
      o.players.some((q, i) => i !== o.seat && !q.folded && q.chips > 0) &&
      (value || (bluff && (cost === 0 || draw)))
    ) {
      let target =
        o.current +
        Math.max(
          o.minRaise,
          Math.round(((pot + cost) * (value ? 0.65 : 0.75)) / 10) * 10,
        );
      target = Math.min(max, target);
      if (target >= o.current + o.minRaise || target === max)
        return { type: "raise", target };
    }
    if (
      cost === 0 ||
      (equity >= odds + 0.035 && cost <= p.chips) ||
      (cost >= p.chips && equity > odds + 0.06)
    )
      return { type: "call" };
    return { type: "fold" };
  }
  const api = {
    create,
    start,
    action,
    legal,
    evaluate,
    card,
    observation,
    seatStatus,
    raiseTarget,
    decide,
    labels,
  };
  if (typeof module !== "undefined") module.exports = api;
  else root.Poker = api;
})(typeof window !== "undefined" ? window : globalThis);
