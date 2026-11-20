'use strict';

(() => {
  function lockWeChatFontSize() {
    const bridge = window.WeixinJSBridge;
    if (!bridge || typeof bridge.invoke !== 'function') return false;

    // WeChat's default font tier is 2. Keep it when the web font menu changes.
    const reset = () => bridge.invoke('setFontSizeCallback', { fontSize: '2' });
    reset();
    if (typeof bridge.on === 'function') bridge.on('menu:setfont', reset);
    return true;
  }

  if (!lockWeChatFontSize()) {
    document.addEventListener('WeixinJSBridgeReady', lockWeChatFontSize, { once: true });
  }
})();
