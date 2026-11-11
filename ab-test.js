/*
 * ab-test.js
 * <head> 内、GTMスニペットより前に同期で読み込む。
 */
(function () {
  'use strict';

  // Cookieの有効ドメインの設定、有効期限の設定、画面内表示とみなす割合の設定
  const COOKIE_DOMAIN = location.hostname.endsWith('lifecard.co.jp') ? '.lifecard.co.jp' : '';
  const COOKIE_MAX_AGE = 90 * 24 * 60 * 60;
  const VISIBLE_RATIO = 0.5;

  const dataLayer = window.dataLayer = window.dataLayer || [];
  const assignments = {};   // { method: { group, groupProperty, population } }

  // 指定した名前のCookieの値を読み取る関数
  function readCookie(name) {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  // Cookieに値を書き込む
  function writeCookie(name, value) {
    let cookie = name + '=' + encodeURIComponent(value) + '; max-age=' + COOKIE_MAX_AGE + '; path=/; SameSite=Lax';
    if (COOKIE_DOMAIN) cookie += '; domain=' + COOKIE_DOMAIN;
    if (location.protocol === 'https:') cookie += '; Secure';
    document.cookie = cookie;
    return readCookie(name) === value;
  }

  // テストの設定された実施期間内かどうかを判定する関数
  function isInPeriod(test) {
    const now = Date.now();
    if (test.start && now < new Date(test.start + 'T00:00:00+09:00').getTime()) return false;
    if (test.end && now > new Date(test.end + 'T23:59:59+09:00').getTime()) return false;
    return true;
  }

  // ユーザーをランダムにグループへ振り分け、Cookieに保存する関数
  // Cookie: ab_test_experiments_{slot} = "{method}:{group}"
  function assignGroup(test) {
    const groupProperty = 'ab_test_experiments_' + test.slot;

    const saved = (readCookie(groupProperty) || '').split(':');
    if (saved[0] === test.method && test.groups.indexOf(saved[1]) >= 0) {
      return { group: saved[1], groupProperty: groupProperty, tracked: true };
    }
    // グループの数に合わせてランダムに振り分け
    const group = test.groups[Math.floor(Math.random() * test.groups.length)];
    if (writeCookie(groupProperty, test.method + ':' + group)) {
      return { group: group, groupProperty: groupProperty, tracked: true };
    }
    // Cookieを保存できない端末は、毎回グループが変わってしまうため対象外にする
    return { group: test.groups[0], groupProperty: groupProperty, tracked: false };
  }

  // テスト設定を読み込み、選ばれなかったグループの要素を非表示にするCSS生成・適用する処理
  const hideRules = [];
  const groupTokens = [];
  (window.AB_TESTS || []).forEach(function (test) {
    if (!isInPeriod(test)) return;
    const result = assignGroup(test);
    result.population = test.population || 'visible';
    assignments[test.method] = result;

    const scope = '[data-ab-test="' + test.method + '"]';
    const others = '[data-ab-only]:not([data-ab-only="' + result.group + '"])';
    hideRules.push(scope + ' ' + others, scope + others);
    groupTokens.push(test.method + ':' + result.group);
  });

  const style = document.createElement('style');
  style.textContent = hideRules.length ? hideRules.join(',') + '{display:none!important}' : '';
  document.head.appendChild(style);
  document.documentElement.setAttribute('data-ab-groups', groupTokens.join(' '));
  document.documentElement.classList.add('ab-ready');
  // ここまで：CSS適用処理

  // GTMに対して、表示（population）やコンバージョン（cv）のイベントデータを送信する関数
  function send(eventName, method) {
    const a = assignments[method];
    if (!a || !a.tracked) return;
    const data = { event: eventName, method: method };
    data[a.groupProperty] = a.group;   // 例: ab_test_experiments_3: 'group_a'
    dataLayer.push(data);
  }

  // 要素が画面内に50%以上表示されたかを判定する関数
  function isVisible(entry) {
    if (!entry.isIntersecting) return false;
    if (entry.intersectionRatio >= VISIBLE_RATIO) return true;
    const viewportHeight = (entry.rootBounds && entry.rootBounds.height) || window.innerHeight;
    return entry.intersectionRect.height >= viewportHeight * VISIBLE_RATIO;
  }

  // 要素のスクロール表示を監視し、画面に入ったタイミングで表示イベント（population）を1度だけ送る関数
  function sendPopulationWhenVisible(method, elements) {
    const thresholds = [];
    for (let i = 0; i <= 20; i++) thresholds.push(i / 20);
    const observer = new IntersectionObserver(function (entries) {
      if (entries.some(isVisible)) {
        observer.disconnect();
        send('population', method);
      }
    }, { threshold: thresholds });
    elements.forEach(function (el) { observer.observe(el); });
  }

  // 対象テストの要素を探し、設定に応じた方法で表示イベント（population）の計測を開始する関数
  function trackPopulation() {
    Object.keys(assignments).forEach(function (method) {
      const a = assignments[method];
      const targets = Array.prototype.filter.call(
        document.querySelectorAll('[data-ab-test="' + method + '"]'),
        function (el) { return !el.hasAttribute('data-ab-only') || el.getAttribute('data-ab-only') === a.group; }
      );
      if (!targets.length) return;
      if (a.population === 'pageview') send('population', method);
      else sendPopulationWhenVisible(method, targets);
    });
  }

  // DOMの読み込みが完了したタイミングで表示計測を開始する
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', trackPopulation);
  else trackPopulation();

  // 指定されたテストのコンバージョン（cv）イベントを送信する関数
  function convert(methods) {
    const list = methods ? methods.split(' ') : Object.keys(assignments);
    list.forEach(function (method) { send('cv', method); });
  }

  // CV対象（data-ab-cv）がクリックされたら自動でCV計測を行うイベントリスナー
  // ボタンなどにテスト名が書いてない場合は、一個上の要素にないか確認する。
  document.addEventListener('click', function (e) {
    const el = e.target.closest && e.target.closest('[data-ab-cv]');
    if (!el) return;
    const owner = el.closest('[data-ab-test]');
    convert(el.getAttribute('data-ab-cv') || (owner && owner.getAttribute('data-ab-test')) || '');
  }, true);

  window.abTest = {
    group: function (method) { return assignments[method] ? assignments[method].group : null; },
    convert: convert
  };
})();
