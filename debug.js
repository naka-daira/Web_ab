// 検証用の確認パネル（本番には入れない）。?debug=0 で非表示
(function () {
  if (/[?&]debug=0/.test(location.search)) return;
  var panel = document.createElement('pre');
  panel.style.cssText = 'position:fixed;right:8px;top:40px;z-index:99999;width:380px;max-width:calc(100vw - 16px);' +
    'max-height:40vh;overflow:auto;margin:0;font:11px/1.4 monospace;background:rgba(0,0,0,.85);color:#0f0;' +
    'padding:8px;border-radius:6px;white-space:pre-wrap;pointer-events:none';
  document.body.appendChild(panel);
  function render() {
    var events = (window.dataLayer || []).filter(function (e) { return /^(population|cv|tap)$/.test(e.event); });
    panel.textContent =
      'グループ: ' + document.documentElement.getAttribute('data-ab-groups') +
      '\nsendTapEvent: ' + (typeof window.sendTapEvent === 'function' ? 'OK' : '未定義') +
      '\n\n' + events.map(function (e) { return JSON.stringify(e); }).join('\n');
  }
  render();
  setInterval(render, 500);
})();
