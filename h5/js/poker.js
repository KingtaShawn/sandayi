"use strict";
window.createPokerUI = function ({ navigate }) {
  const E = window.Poker,
    $ = (id) => document.getElementById("poker-" + id);
  let s = E.create(),
    timer = null,
    visible = false,
    dealing = false;
  let dealtHand = 0;
  let boardSeen = [];
  function cards(node, cs, animateFrom) {
    node.replaceChildren(...cs.map((c, i) => {
      const span = document.createElement("span");
      span.className = "poker-card" + (Math.floor(c / 13) % 2 ? " red" : "") + (i >= animateFrom ? " dealing" : "");
      span.style.animationDelay = Math.max(0, i - animateFrom) * 230 + "ms";
      const value = E.card(c);
      span.innerHTML = '<span class="card-corner"></span><span class="card-suit"></span>';
      span.firstChild.textContent = value.slice(1);
      span.lastChild.textContent = value.slice(0, 1);
      span.setAttribute('aria-label', value);
      return span;
    }));
  }
  function render() {
    const newHand = s.hand !== dealtHand;
    const board = s.board || [];
    const newBoardFrom = newHand ? 0 : boardSeen.length <= board.length && boardSeen.every((c, i) => board[i] === c) ? boardSeen.length : board.length;
    $("seats").replaceChildren(
      ...s.players.map((p, i) => {
        const node = document.createElement("div");
        node.className = "poker-seat seat-" + i + (s.turn === i ? " active" : "") + (p.folded ? " folded" : "");
        const angle = 2 * Math.PI * i / s.players.length;
        node.style.setProperty('--seat-x', (50 - 48 * Math.sin(angle)) + '%');
        node.style.setProperty('--seat-y', (50 + 47 * Math.cos(angle)) + '%');
        const avatar = document.createElement('div');
        avatar.className = 'seat-avatar';
        avatar.textContent = i === 0 ? '你' : ['','♠','♦','♣','♥','♠','♦','♣','♥'][i];
        const info = document.createElement('div'); info.className = 'seat-info';
        const name = document.createElement('strong'); name.textContent = p.name;
        const chips = document.createElement('span'); chips.textContent = '◈ ' + p.chips;
        const action = document.createElement('small'); action.textContent = p.folded ? '弃牌' : p.action || (s.turn === i ? '思考中' : '等待');
        info.append(name, chips, action); node.append(avatar, info);
        if (i === s.dealer) { const d = document.createElement('b'); d.className = 'dealer-button'; d.textContent = 'D'; node.append(d); }
        if (p.hole && i !== 0 && !p.folded) {
          const h = document.createElement('div'); h.className = 'seat-cards' + (newHand ? ' dealing' : '');
          if (newHand) h.style.animationDelay = (i - 1) * 120 + 'ms';
          if (s.done && s.board.length === 5) {
            p.hole.forEach(c => {const v=document.createElement('span');v.className = Math.floor(c/13)%2 ? 'red' : '';v.textContent=E.card(c);h.append(v);});
          } else h.innerHTML = '<span class="card-back"></span><span class="card-back"></span>';
          node.appendChild(h);
        }
        if (p.bet) {const bet=document.createElement('div');bet.className='seat-bet';bet.textContent='◉ '+p.bet;node.append(bet);}
        return node;
      }),
    );
    cards($("board"), board, newBoardFrom);
    cards($("hand"), s.players[0].hole || [], newHand ? 0 : Infinity);
    $("dealer").classList.toggle('is-dealing', newHand || newBoardFrom < board.length);
    dealtHand = s.hand; boardSeen = board.slice();
    $("pot").textContent = s.done
      ? "第 " + s.hand + " 手 · 结算"
      : "第 " +
        s.hand +
        " 手 · " +
        ["翻牌前", "翻牌", "转牌", "河牌"][s.street] +
        " · 底池 " +
        s.players.reduce((n, p) => n + p.total, 0);
    $("status").textContent = dealing ? "荷官正在发牌…" : s.done
      ? s.result || "选择 AI 人数后，点击下一手入座"
      : s.turn === 0
        ? "轮到你行动" + (s.log.length ? " · " + s.log[s.log.length - 1] : "")
        : (s.log.length ? s.log[s.log.length - 1] + " · " : "") + s.players[s.turn].name + " 正在思考…";
    const l = E.legal(s),
      human = !dealing && !s.done && s.turn === 0;
    ["fold", "call"].forEach((k) => ($(k).disabled = !human));
    ["raise", "allin", "amount"].forEach(
      (k) => ($(k).disabled = !human || !l.raise),
    );
    $("call").textContent = l.call ? "跟注 " + l.call : "过牌";
    $("amount").min = l.min || 20;
    $("amount").max = l.max || 2000;
    if (document.activeElement !== $("amount"))
      $("amount").value = Math.min(l.min || 20, l.max || 2000);
    $("next").disabled =
      dealing || !s.done ||
      s.players[0].chips === 0 ||
      s.players.filter((p) => p.chips > 0).length < 2;
    $("log").replaceChildren(
      ...(s.log || []).slice(-12).map((v) => {
        const li = document.createElement("li");
        li.textContent = v;
        return li;
      }),
    );
  }
  function loop() {
    clearTimeout(timer);
    const newHand = s.hand !== dealtHand;
    const newCards = !newHand && (s.board || []).length > boardSeen.length;
    if (newHand || newCards) dealing = true;
    render();
    if (!visible) return;
    if (dealing) {
      timer = setTimeout(() => { dealing = false; loop(); }, newHand ? 2000 : 1900);
    } else if (!s.done && s.turn !== 0) {
      timer = setTimeout(() => {
        try {
          const move = E.decide(E.observation(s, s.turn));
          E.action(s, move.type, move.target);
          loop();
        } catch (e) { $("error").textContent = e.message; }
      }, 1200);
    }
  }
  function act(type, target) {
    try {
      if (dealing) return;
      $("error").textContent = "";
      E.action(s, type, target);
      loop();
    } catch (e) {
      $("error").textContent = e.message;
    }
  }
  $("fold").onclick = () => act("fold");
  $("call").onclick = () => act("call");
  $("raise").onclick = () => act("raise", Number($("amount").value));
  $("allin").onclick = () => act("raise", E.legal(s).max);
  $("next").onclick = () => {
    try {
      E.start(s);
      loop();
    } catch (e) {
      $("error").textContent = e.message;
    }
  };
  $("reset").onclick = () => {
    if (s.hand && !confirm("重新开桌会清空本桌筹码，继续？")) return;
    s = E.create(Number($("count").value));
    dealtHand = 0; boardSeen = []; dealing = false;
    $("error").textContent = "";
    loop();
  };
  $("count").onchange = () => {
    $("error").textContent = "人数在重新开桌后生效";
  };
  $("home").onclick = () => navigate("lobby");
  document.getElementById("btn-enter-poker").onclick = () => navigate("poker");
  return {
    open() {
      visible = true;
      loop();
    },
    close() {
      visible = false,
    dealing = false;
      clearTimeout(timer);
    },
  };
};
