"use strict";
window.createPokerUI = function ({ navigate }) {
  const E = window.Poker, M = window.PokerMotion,
    $ = (id) => document.getElementById("poker-" + id);
  let s = E.create(),
    timer = null,
    visible = false,
    dealing = false,
    settling = false;
  let dealtHand = 0;
  let boardSeen = [];
  let totalsSeen = [];
  let payoutHand = 0;
  let recentBet = false;
  let selectedSizing = 'half';
  let sizingOpen = false;
  const sizingLabels = {half:'½ 底池', pot:'全池', double:'2倍底池', triple:'3倍底池'};
  function cards(node, cs, animateFrom, dealDelays) {
    node.replaceChildren(...cs.map((c, i) => {
      const span = document.createElement("span");
      span.className = "poker-card" + (Math.floor(c / 13) % 2 ? " red" : "") + (i >= animateFrom ? " dealing" : "");
      span.style.animationDelay = (dealDelays ? dealDelays[i] : Math.max(0, i - animateFrom) * 230) + "ms";
      const value = E.card(c);
      span.innerHTML = '<span class="card-corner"></span><span class="card-suit"></span>';
      span.firstChild.textContent = value.slice(1);
      span.lastChild.textContent = value.slice(0, 1);
      span.setAttribute('aria-label', value);
      return span;
    }));
  }
  function drawPot(amount) {
    const stacks = amount <= 0 ? 0 : Math.min(7, Math.max(1, Math.ceil(Math.log2(amount / 20 + 1))));
    const colours = ['ivory', 'red', 'blue', 'gold', 'green', 'red', 'gold'];
    $("chips").replaceChildren(...Array.from({length: stacks}, (_, i) => {
      const stack = document.createElement('span'); stack.className = 'chip-stack ' + colours[i];
      const height = Math.min(4, 1 + Math.floor(Math.log10(amount + 1)));
      for (let j = 0; j < height; j++) { const chip = document.createElement('i'); chip.style.setProperty('--level', j); stack.append(chip); }
      return stack;
    }));
  }
  function pointInTable(element) {
    const layer = $("flights"), box = layer.getBoundingClientRect();
    const view = document.getElementById('view-poker');
    const matrix = M.matrixFromCss(window.getComputedStyle(view).transform);
    if (!matrix) return null;
    return M.toLocal(M.center(element.getBoundingClientRect()), box, layer.offsetWidth, layer.offsetHeight, matrix);
  }
  function placeDealOrigins() {
    const dealer = document.querySelector('.dealer-portrait');
    const layer = $("flights");
    if (!dealer || !layer.offsetWidth || !layer.offsetHeight) return;
    const origin = pointInTable(dealer);
    if (!origin) return;
    document.querySelectorAll('#view-poker .poker-card.dealing, #view-poker .card-back.dealing').forEach(card => {
      const target = pointInTable(card);
      if (!target) return;
      const offset = M.between(target, origin);
      card.style.setProperty('--deal-x', offset.x + 'px');
      card.style.setProperty('--deal-y', offset.y + 'px');
    });
  }
  function flyChips(from, to, delay = 0, type = 'payout') {
    if (!from || !to || !visible) return;
    const layer = $("flights");
    if (!layer.offsetWidth || !layer.offsetHeight) return;
    const a = pointInTable(from), b = pointInTable(to);
    if (!a || !b) return;
    const delta = M.between(a, b);
    const chip = document.createElement('span'); chip.className = 'flying-chips ' + type;
    chip.style.left = a.x + 'px';
    chip.style.top = a.y + 'px';
    chip.style.setProperty('--dx', delta.x + 'px');
    chip.style.setProperty('--dy', delta.y + 'px');
    chip.style.animationDelay = delay + 'ms';
    chip.innerHTML = '<i></i><i></i><i></i>';
    chip.addEventListener('animationend', () => chip.remove(), {once:true});
    layer.append(chip);
  }
  function render() {
    const view = document.getElementById('view-poker');
    view.classList.remove('motion-ready');
    const newHand = s.hand !== dealtHand;
    const board = s.board || [];
    const order = M.dealOrder(s.players, s.dealer);
    const dealDelays = (i) => [order.indexOf(i) * 110, (order.indexOf(i) + order.length) * 110];
    const increases = s.players.map((p,i) => Math.max(0, (p.total || 0) - (newHand ? 0 : (totalsSeen[i] || 0))));
    recentBet = increases.some(Boolean);
    const newBoardFrom = newHand ? 0 : boardSeen.length <= board.length && boardSeen.every((c, i) => board[i] === c) ? boardSeen.length : board.length;
    $("seats").dataset.count = String(s.players.length);
    $("seats").replaceChildren(
      ...s.players.map((p, i) => {
        const node = document.createElement("div");
        const status = E.seatStatus(s, i);
        const amountDue = s.done && s.awards ? s.awards[i] || 0 : 0;
        const award = !dealing && payoutHand === s.hand ? amountDue : 0;
        const shownStack = s.done && (payoutHand !== s.hand || settling) ? p.chips - amountDue : p.chips;
        const won = !!(award && s.winners && s.winners.includes(i));
        node.className = "poker-seat seat-" + i + " " + status + (s.turn === i ? " active" : "") + (won ? " winner" : "");
        const angle = 2 * Math.PI * i / s.players.length;
        node.style.setProperty('--seat-x', (50 - 48 * Math.sin(angle)) + '%');
        node.style.setProperty('--seat-y', (50 + 47 * Math.cos(angle)) + '%');
        const avatar = document.createElement('div');
        avatar.className = 'seat-avatar';
        avatar.textContent = i === 0 ? '你' : ['','♠','♦','♣','♥','♠','♦','♣','♥'][i];
        const info = document.createElement('div'); info.className = 'seat-info';
        const name = document.createElement('strong'); name.textContent = p.name;
        const heading = document.createElement('div'); heading.className = 'seat-heading'; heading.append(name);
        if (p.position) { const position = document.createElement('span'); position.className = 'seat-position'; position.textContent = p.position; heading.append(position); }
        const chips = document.createElement('span'); chips.textContent = '◈ ' + shownStack;
        const action = document.createElement('small');
        const label = {ready:'待发牌', survived:'在座', 'in-hand':'在局', 'all-in':'全押', folded:'弃牌', eliminated:'待补码'}[status];
        action.textContent = won ? '胜出' : status === 'in-hand' ? label + ' · ' + (p.action || (s.turn === i ? '行动中' : '等待')) : label;
        info.append(heading, chips, action); node.append(avatar, info);
        if (i === s.dealer) { const d = document.createElement('b'); d.className = 'dealer-button'; d.textContent = 'D'; node.append(d); }
        const reveal = s.done && !dealing && payoutHand === s.hand && !!s.awards;
        if (reveal && p.hole && p.hole.length) node.classList.add('showdown');
        if (p.hole && p.hole.length && i !== 0 && (!p.folded || reveal)) {
          const h = document.createElement('div'); h.className = 'seat-cards' + (reveal ? ' revealed' : '');
          if (reveal) {
            p.hole.forEach(c => {const v=document.createElement('span');v.className = Math.floor(c/13)%2 ? 'red' : '';v.textContent=E.card(c);h.append(v);});
          } else {
            for (let k = 0; k < 2; k++) {
              const back = document.createElement('span'); back.className = 'card-back' + (newHand ? ' dealing' : '');
              if (newHand) back.style.animationDelay = dealDelays(i)[k] + 'ms';
              h.append(back);
            }
          }
          node.appendChild(h);
        }
        if (p.bet && !s.done) {const bet=document.createElement('div');bet.className='seat-bet' + (increases[i] ? ' bet-pulse' : '');bet.textContent='◉ '+p.bet;node.append(bet);}
        if (award) {const win=document.createElement('div');win.className='seat-award' + (settling ? ' award-animate' : '');win.textContent='+'+award;node.append(win);}
        return node;
      }),
    );
    cards($("board"), board, newBoardFrom);
    cards($("hand"), s.players[0].hole || [], newHand ? 0 : Infinity, newHand ? dealDelays(0) : null);
    placeDealOrigins();
    view.classList.add('motion-ready');
    $("dealer").classList.toggle('is-dealing', newHand || newBoardFrom < board.length);
    dealtHand = s.hand; boardSeen = board.slice();
    totalsSeen = s.players.map(p => p.total || 0);
    const pot = s.players.reduce((n, p) => n + (p.total || 0), 0);
    const displayPot = s.done && payoutHand === s.hand && !settling ? 0 : pot;
    drawPot(displayPot);
    increases.forEach((amount, i) => {
      if (amount) flyChips(document.querySelector('.poker-seat.seat-' + i), $("chips"), newHand ? 650 + i * 100 : 0, 'bet-flight');
    });
    $("pot").textContent = s.done
      ? "第 " + s.hand + " 手 · " + (displayPot ? "底池 " + displayPot : "底池已分配")
      : "第 " +
        s.hand +
        " 手 · " +
        ["翻牌前", "翻牌", "转牌", "河牌"][s.street] +
        " · 底池 " +
        s.players.reduce((n, p) => n + p.total, 0);
    $("status").textContent = dealing ? "荷官正在发牌…" : s.done
      ? (s.awards && payoutHand !== s.hand ? "正在结算…" : s.result || "选择 AI 人数后，点击下一手入座")
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
    if (!human || !l.raise) sizingOpen = false;
    $("sizing-panel").hidden = !sizingOpen;
    $("amount").setAttribute('aria-expanded', String(sizingOpen));
    $("amount").textContent = sizingLabels[selectedSizing] + ' ▾';
    const options = Array.from(document.querySelectorAll('.poker-size-options button'));
    options.forEach(option => {
      const preset = option.dataset.preset;
      const target = human && l.raise ? E.raiseTarget(s, preset) : null;
      option.querySelector('small').textContent = target == null ? '' : '加至 ' + target;
      option.classList.toggle('selected', preset === selectedSizing);
      option.setAttribute('aria-pressed', String(preset === selectedSizing));
    });
    // Order by the legal total after minimum-raise and stack limits.
    if (human && l.raise) {
      options.sort((a, b) => E.raiseTarget(s, a.dataset.preset) - E.raiseTarget(s, b.dataset.preset));
      const list = document.querySelector('.poker-size-options');
      if (options.some((option, i) => list.children[i] !== option)) options.forEach(option => list.append(option));
    }
    const raiseTo = human && l.raise ? E.raiseTarget(s, selectedSizing) : null;
    $("raise").textContent = raiseTo == null ? '加注' : '加注至 ' + raiseTo;
    $("next").disabled = dealing || settling || !s.done;
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
      timer = setTimeout(() => { dealing = false; loop(); }, newHand ? 2800 : 1900);
    } else if (s.done && s.hand && s.awards && payoutHand !== s.hand) {
      const waitForBet = recentBet;
      settling = true; render();
      const distribute = () => {
        payoutHand = s.hand; render();
        s.awards.forEach((amount, i) => {
          if (amount) flyChips($("chips"), document.querySelector('.poker-seat.seat-' + i), i * 80);
        });
        timer = setTimeout(() => { settling = false; render(); }, 1700);
      };
      if (waitForBet) timer = setTimeout(distribute, 900); else distribute();
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
  function closeSizing(restoreFocus = true) {
    sizingOpen = false; render();
    if (restoreFocus && visible && !$("amount").disabled) $("amount").focus();
  }
  $("amount").onclick = () => {
    if ($("amount").disabled) return;
    sizingOpen = true; render();
    $('size-' + selectedSizing).focus();
  };
  $("size-close").onclick = () => closeSizing();
  $("sizing-panel").onclick = e => { if (e.target === $("sizing-panel")) closeSizing(); };
  document.querySelectorAll('.poker-size-options button').forEach(option => {
    option.onclick = () => { selectedSizing = option.dataset.preset; closeSizing(); };
  });
  document.addEventListener('keydown', e => {
    if (!visible || !sizingOpen) return;
    if (e.key === 'Escape') { e.preventDefault(); closeSizing(); return; }
    if (e.key !== 'Tab') return;
    const items = [$("size-close"), ...document.querySelectorAll('.poker-size-options button')];
    const i = items.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
    else if (!e.shiftKey && (i === items.length - 1 || i < 0)) { e.preventDefault(); items[0].focus(); }
  });
  $("raise").onclick = () => act("raise", E.raiseTarget(s, selectedSizing));
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
    dealtHand = 0; boardSeen = []; totalsSeen = []; payoutHand = 0; dealing = false; settling = false; sizingOpen = false; selectedSizing = 'half'; $("flights").replaceChildren();
    $("error").textContent = "";
    loop();
  };
  $("count").onchange = () => {
    $("error").textContent = "人数在重新开桌后生效";
  };
  window.addEventListener('resize', () => {
    if (!visible) return;
    // Cancel in-flight visuals if the viewport rotates; the game state is unchanged.
    $("flights").replaceChildren();
    document.querySelectorAll('#view-poker .dealing').forEach(element => element.classList.remove('dealing'));
  });
  $("home").onclick = () => navigate("lobby");
  document.getElementById("btn-enter-poker").onclick = () => navigate("poker");
  return {
    open() {
      visible = true;
      loop();
    },
    close() {
      visible = false; settling = false; sizingOpen = false;
      clearTimeout(timer); $("flights").replaceChildren();
    },
  };
};
