"use strict";
window.createPokerUI = function ({ navigate }) {
  const E = window.Poker,
    $ = (id) => document.getElementById("poker-" + id);
  let s = E.create(),
    timer = null,
    visible = false;
  function cards(node, cs) {
    node.replaceChildren(
      ...cs.map((c) => {
        const span = document.createElement("span");
        span.className = "poker-card" + (Math.floor(c / 13) % 2 ? " red" : "");
        span.textContent = E.card(c);
        return span;
      }),
    );
  }
  function render() {
    $("seats").replaceChildren(
      ...s.players.map((p, i) => {
        const node = document.createElement("div");
        node.className = "poker-seat" + (s.turn === i ? " active" : "");
        node.textContent =
          (i === s.dealer ? "Ⓓ " : "") +
          p.name +
          " · " +
          p.chips +
          " 筹码 · " +
          (p.folded ? "已弃牌" : p.action || "等待") +
          " · 投入 " +
          (p.bet || 0);
        if (p.hole && i !== 0 && !p.folded) {
          const h = document.createElement("small");
          h.textContent =
            s.done && s.board.length === 5
              ? p.hole.map(E.card).join(" ")
              : "▧ ▧";
          node.appendChild(h);
        }
        return node;
      }),
    );
    cards($("board"), s.board || []);
    cards($("hand"), s.players[0].hole || []);
    $("pot").textContent = s.done
      ? "第 " + s.hand + " 手 · 结算"
      : "第 " +
        s.hand +
        " 手 · " +
        ["翻牌前", "翻牌", "转牌", "河牌"][s.street] +
        " · 底池 " +
        s.players.reduce((n, p) => n + p.total, 0);
    $("status").textContent = s.done
      ? s.result || "选择 AI 人数后，点击下一手入座"
      : s.turn === 0
        ? "轮到你行动"
        : s.players[s.turn].name + " 正在思考…";
    const l = E.legal(s),
      human = !s.done && s.turn === 0;
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
      !s.done ||
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
    render();
    if (visible && !s.done && s.turn !== 0)
      timer = setTimeout(() => {
        try {
          const move = E.decide(E.observation(s, s.turn));
          E.action(s, move.type, move.target);
          loop();
        } catch (e) {
          $("error").textContent = e.message;
        }
      }, 450);
  }
  function act(type, target) {
    try {
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
      visible = false;
      clearTimeout(timer);
    },
  };
};
