/*!
 * ab-test.js — HTML/CSS/JSのみで動くA/Bテスト共通スクリプト
 *
 * 【設置ルール】
 *   <head> 内、CSSの直後・GTMスニペットより前に「同期」で読み込む（async/defer を付けない）。
 *   直前に window.AB_TESTS（テスト定義）を書いておく。
 *
 * 【GA4に送るイベント（全テスト共通）】
 *   ab_impression : 対象要素が画面に表示された（テストごと・1ページ表示につき1回）
 *   ab_conversion : CV（data-ab-cv 付き要素のクリック or abTest.convert() 呼び出し）
 *   共通パラメータ : ab_test_id / ab_variant / ab_cv_name
 */
(function (w, d) {
  'use strict';

  var CONF = w.AB_CONFIG || {};
  var COOKIE_DOMAIN = CONF.cookieDomain || '';   // 例: '.lifecard.co.jp'（サブドメイン間で振り分けを共有）
  var COOKIE_DAYS = CONF.cookieDays || 90;
  var KEY_PREFIX = 'ab_';
  var ID_RE = /^[a-z0-9_-]+$/;                    // CSSセレクタ・属性名に使うため制限

  var dataLayer = w.dataLayer = w.dataLayer || [];
  var root = d.documentElement;
  var assigned = {};                              // { testId: 'A' | 'B' ... } このページで有効なテスト

  /* ---------- 保存（Cookie を主、localStorage を予備） ---------- */
  function readCookie(k) {
    var m = d.cookie.match(new RegExp('(?:^|; )' + k + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function read(k) {
    var v = readCookie(k);
    if (v !== null) return v;
    try { return w.localStorage.getItem(k); } catch (e) { return null; }
  }
  function write(k, v) {
    var c = k + '=' + encodeURIComponent(v) + '; max-age=' + COOKIE_DAYS * 86400 + '; path=/; SameSite=Lax';
    if (COOKIE_DOMAIN) c += '; domain=' + COOKIE_DOMAIN;
    if (location.protocol === 'https:') c += '; Secure';
    d.cookie = c;
    try { w.localStorage.setItem(k, v); } catch (e) { /* Safariプライベート等は無視 */ }
  }

  /* ---------- 振り分け ---------- */
  function pick(t) {
    var ws = t.weights || t.variants.map(function () { return 1; });
    var sum = 0, i;
    for (i = 0; i < ws.length; i++) sum += ws[i];
    var r = Math.random() * sum;
    for (i = 0; i < ws.length; i++) { if ((r -= ws[i]) < 0) return t.variants[i]; }
    return t.variants[0];
  }
  function forced() {                             // QA用: ?ab_force=testId:B,testId2:A
    var m = location.search.match(/[?&]ab_force=([^&]*)/), o = {};
    if (m) decodeURIComponent(m[1]).split(',').forEach(function (p) {
      var kv = p.split(':'); if (kv[1]) o[kv[0]] = kv[1];
    });
    return o;
  }
  function isActive(t) {
    var now = Date.now();
    if (t.start && now < new Date(t.start + 'T00:00:00+09:00').getTime()) return false;
    if (t.end && now > new Date(t.end + 'T23:59:59+09:00').getTime()) return false;
    return true;
  }

  var force = forced();
  var css = '';
  (w.AB_TESTS || []).forEach(function (t) {
    if (!t || !ID_RE.test(t.id) || !t.variants || !isActive(t)) return;
    var v = force[t.id];
    if (t.variants.indexOf(v) < 0) {
      v = read(KEY_PREFIX + t.id);
      if (t.variants.indexOf(v) < 0) { v = pick(t); write(KEY_PREFIX + t.id, v); }
    }
    assigned[t.id] = v;
    // CSSだけで差分を作る用: <html data-ab-{id}="B">
    root.setAttribute('data-ab-' + t.id, v);
    // マークアップを2つ用意する用: 割り当て以外のパターンを隠す
    //   <div data-ab-test="id"><a data-ab-variant="A">… の形（子要素）と、同じ要素に両方付ける形の両方に対応
    var not = '[data-ab-variant]:not([data-ab-variant="' + v + '"])';
    css += '[data-ab-test="' + t.id + '"] ' + not + ',[data-ab-test="' + t.id + '"]' + not + '{display:none!important}';
  });

  // 同期実行なので、bodyが描画される前に効く → ちらつき無し
  var style = d.createElement('style');
  style.id = 'ab-test-style';
  style.appendChild(d.createTextNode(css));
  (d.head || root).appendChild(style);
  root.className += (root.className ? ' ' : '') + 'ab-js';   // JS失敗時のフォールバックCSS用

  /* ---------- 送信 ---------- */
  function push(ev, id, cv) {
    dataLayer.push({
      event: ev,
      ab_test_id: id,
      ab_variant: assigned[id],
      ab_cv_name: cv || undefined                 // dataLayerは値が残るので必ず上書きする
    });
  }

  /* ---------- インプレッション ---------- */
  function trackImpressions() {
    Object.keys(assigned).forEach(function (id) {
      var v = assigned[id];
      var sel = '[data-ab-test="' + id + '"][data-ab-variant="' + v + '"],' +
                '[data-ab-test="' + id + '"]:not([data-ab-variant])';
      var els = d.querySelectorAll(sel);
      if (!els.length) return;                    // このページに対象が無いテストは送らない
      var sent = false;
      var fire = function () { if (!sent) { sent = true; push('ab_impression', id); } };
      if (!('IntersectionObserver' in w)) { fire(); return; }
      var io = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) { fire(); io.disconnect(); return; }
        }
      }, { threshold: 0.5 });
      for (var i = 0; i < els.length; i++) io.observe(els[i]);
    });
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', trackImpressions);
  else trackImpressions();

  /* ---------- コンバージョン ---------- */
  // ids省略時: このページで有効な全テストにCVを付ける（完了ページなど）
  function convert(cvName, ids) {
    if (typeof ids === 'string') ids = ids.split(/\s+/);
    (ids || Object.keys(assigned)).forEach(function (id) {
      if (assigned[id]) push('ab_conversion', id, cvName);
    });
  }
  // <a data-ab-cv="apply_click"> のクリック。対象テストは
  //   data-ab-cv-test="id1 id2" → 祖先の data-ab-test → このページの全テスト の順で決まる
  d.addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest('[data-ab-cv]');
    if (!el) return;
    var ids = el.getAttribute('data-ab-cv-test');
    if (!ids) {
      var owner = el.closest('[data-ab-test]');
      ids = owner ? owner.getAttribute('data-ab-test') : null;
    }
    convert(el.getAttribute('data-ab-cv'), ids || undefined);
  }, true);

  w.abTest = {
    get: function (id) { return assigned[id] || null; },
    all: function () { var o = {}; for (var k in assigned) o[k] = assigned[k]; return o; },
    convert: convert
  };
})(window, document);
