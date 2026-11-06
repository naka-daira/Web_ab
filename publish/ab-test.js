/*!
 * ab-test.js — HTML/CSS/JSのみで動くA/Bテスト共通スクリプト
 *
 * 【設置ルール】
 *   <head> 内、CSSの直後・GTMスニペットより前に「同期」で読み込む（async/defer を付けない）。
 *   直前に window.AB_TESTS（テスト定義）を書いておく。
 *
 * 【GA4に送るもの（判定側 AB_TESTS の設定に合わせた形）】
 *   population イベント : 対象要素が画面に表示された（母数 / denominator_filter）
 *   cv（または tcv）イベント : CV（cv_filter）
 *     共通イベントパラメータ  : method = テスト名（例: 'ログイン成功率改善'）
 *   ユーザープロパティ       : ab_test_experiments_{slot} = グループ値（例: 'original' / 'group_a'）（ab_param）
 *
 * 【dataLayer に積む値】
 *   { event: 'population' | 'cv' | 'tcv', method, ab_up_name, ab_up_value }
 *     ab_up_name  = 'ab_test_experiments_' + slot（GTMでユーザープロパティ名に使う）
 *     ab_up_value = グループ値
 */
(function (w, d) {
  'use strict';

  var CONF = w.AB_CONFIG || {};
  var COOKIE_DOMAIN = CONF.cookieDomain || '';   // 例: '.lifecard.co.jp'（サブドメイン間で振り分けを共有）
  var COOKIE_DAYS = CONF.cookieDays || 90;
  var KEY_PREFIX = 'ab_';
  var UP_PREFIX = 'ab_test_experiments_';
  var ID_RE = /^[a-z0-9_-]+$/;                    // CSSセレクタ・属性名に使うため制限

  var dataLayer = w.dataLayer = w.dataLayer || [];
  var root = d.documentElement;
  var tests = {};                                 // { id: { group, method, slot, cvEvent, enrolled } }

  /* ---------- 保存（Cookieのみ） ---------- */
  function read(k) {
    var m = d.cookie.match(new RegExp('(?:^|; )' + k + '=([^;]*)'));
    if (m) return decodeURIComponent(m[1]);
    // localStorage は使わない方針のため無効化
    // try { return w.localStorage.getItem(k); } catch (e) { return null; }
    return null;
  }
  function write(k, v) {
    var c = k + '=' + encodeURIComponent(v) + '; max-age=' + COOKIE_DAYS * 86400 + '; path=/; SameSite=Lax';
    if (COOKIE_DOMAIN) c += '; domain=' + COOKIE_DOMAIN;
    if (location.protocol === 'https:') c += '; Secure';
    d.cookie = c;
    // localStorage は使わない方針のため無効化
    // try { w.localStorage.setItem(k, v); } catch (e) { /* Safariプライベート等は無視 */ }
    return read(k) === v;                         // 書けたかどうか（Cookie拒否の検出）
  }

  /* ---------- 振り分け ---------- */
  function pick(t) {
    var ws = t.weights || t.groups.map(function () { return 1; });
    var sum = 0, i;
    for (i = 0; i < ws.length; i++) sum += ws[i];
    var r = Math.random() * sum;
    for (i = 0; i < ws.length; i++) { if ((r -= ws[i]) < 0) return t.groups[i]; }
    return t.groups[0];
  }
  function forced() {                             // QA用: ?ab_force=testId:group_a,testId2:original
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
    if (!t || !ID_RE.test(t.id) || !t.groups || !t.method || !t.slot || !isActive(t)) return;
    var g = force[t.id], enrolled = true;
    if (t.groups.indexOf(g) < 0) {
      g = read(KEY_PREFIX + t.id);
      if (t.groups.indexOf(g) < 0) {
        g = pick(t);
        // Cookieが保存できない端末は、毎回振り分けが変わってしまうため
        // テスト対象外（元の表示・計測なし）にする
        if (!write(KEY_PREFIX + t.id, g)) { g = t.groups[0]; enrolled = false; }
      }
    }
    tests[t.id] = { group: g, method: t.method, slot: t.slot, cvEvent: t.cvEvent || 'cv', enrolled: enrolled };
    // CSSだけで差分を作る用: <html data-ab-{id}="group_a">
    root.setAttribute('data-ab-' + t.id, g);
    // マークアップを複数用意する用: 割り当て以外のグループを隠す
    //   <div data-ab-test="id"><a data-ab-variant="original">… の形（子要素）と、同じ要素に両方付ける形の両方に対応
    var not = '[data-ab-variant]:not([data-ab-variant="' + g + '"])';
    css += '[data-ab-test="' + t.id + '"] ' + not + ',[data-ab-test="' + t.id + '"]' + not + '{display:none!important}';
  });

  // 同期実行なので、bodyが描画される前に効く → ちらつき無し
  var style = d.createElement('style');
  style.id = 'ab-test-style';
  style.appendChild(d.createTextNode(css));
  (d.head || root).appendChild(style);
  root.className += (root.className ? ' ' : '') + 'ab-js';   // JS失敗時のフォールバックCSS用

  /* ---------- 送信 ---------- */
  function push(ev, id) {
    var t = tests[id];
    if (!t || !t.enrolled) return;
    dataLayer.push({
      event: ev,
      method: t.method,
      ab_up_name: UP_PREFIX + t.slot,
      ab_up_value: t.group
    });
  }

  /* ---------- 母数（population） ---------- */
  function trackPopulation() {
    Object.keys(tests).forEach(function (id) {
      var g = tests[id].group;
      var sel = '[data-ab-test="' + id + '"][data-ab-variant="' + g + '"],' +
                '[data-ab-test="' + id + '"]:not([data-ab-variant])';
      var els = d.querySelectorAll(sel);
      if (!els.length) return;                    // このページに対象が無いテストは送らない
      var sent = false;
      var fire = function () { if (!sent) { sent = true; push('population', id); } };
      if (!('IntersectionObserver' in w)) { fire(); return; }
      var io = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) { fire(); io.disconnect(); return; }
        }
      }, { threshold: 0.5 });
      for (var i = 0; i < els.length; i++) io.observe(els[i]);
    });
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', trackPopulation);
  else trackPopulation();

  /* ---------- コンバージョン（cv / tcv） ---------- */
  // ids省略時: このページで有効な全テストにCVを付ける（完了ページなど）
  function convert(ids) {
    if (typeof ids === 'string') ids = ids.split(/\s+/);
    (ids || Object.keys(tests)).forEach(function (id) {
      if (tests[id]) push(tests[id].cvEvent, id);
    });
  }
  // <a data-ab-cv> のクリック。対象テストは
  //   data-ab-cv="id1 id2"（値あり）→ 祖先の data-ab-test → このページの全テスト の順で決まる
  d.addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest('[data-ab-cv]');
    if (!el) return;
    var ids = el.getAttribute('data-ab-cv');
    if (!ids) {
      var owner = el.closest('[data-ab-test]');
      ids = owner ? owner.getAttribute('data-ab-test') : null;
    }
    convert(ids || undefined);
  }, true);

  w.abTest = {
    get: function (id) { return tests[id] ? tests[id].group : null; },
    all: function () { var o = {}; for (var k in tests) o[k] = tests[k].group; return o; },
    convert: convert
  };
})(window, document);
