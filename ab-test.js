/*
 * A/Bテストの追加・期間の変更・終了の設定
 *
 * method     : テスト名。判定側の test_id と同じ文字列（スペース・" ・: は使わない）
 * slot       : ab_test_experiments_{slot} の番号（1〜5）。期間が重なるテスト同士は別の番号にする
 * groups     : グループ名。先頭は 'original'。振り分けは均等
 * start / end: 実施期間（日本時間、両日を含む）。期間外はオリジナルが表示され、計測もされない
 * population : 片方にしか要素がないテスト（追跡型CTAなど）のときだけ 'pageview' と書く
 * pages      : テストを動かすページのパス。CVの到達ページ（完了ページなど）も入れる
 *              '*' は「任意の文字列」。末尾の index.html は省略して書く（'/' と '/index.html' は同じ扱い）
 *              例: ['/', '/apply/complete/']
 *
 * テストを終了するときは、勝ったパターンを本実装し、このファイルからその行を消す。
 * end を過ぎた場合はオリジナルが表示される。
 */
window.AB_TESTS = [
  {
    method: 'ヒーローボタン改善',
    slot: 2,
    groups: ['original', 'group_a'],
    start: '2026-11-06',
    end: '2026-12-31',
    pages: ['*/']
  },
  {
    method: '追跡型CTA追加',
    slot: 3,
    groups: ['original', 'group_a'],
    population: 'pageview',
    start: '2026-11-09',
    end: '2026-12-31',
    pages: ['*/sticky.html']
  }
];

/*
 * A/Bテストの実装コード
 */
(function () {
  'use strict';

  // Cookieの有効ドメインの設定、有効期限の設定、画面内表示とみなす割合の設定
  const COOKIE_DOMAIN = location.hostname.endsWith('lifecard.co.jp') ? '.lifecard.co.jp' : '';
  const COOKIE_MAX_AGE = 90 * 24 * 60 * 60;
  const VISIBLE_RATIO = 0.5;
  // テストが動いていないときに表示するグループ名
  const ORIGINAL_GROUP = 'original';

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

  // 末尾の index.html を取り、'/' と '/index.html' を同じパスとして扱う
  function normalizePath(path) {
    return path.replace(/\/index\.html?$/, '/');
  }

  // 今のページが、テストの pages のどれかに当てはまるかを判定する関数（'*' は任意の文字列）
  function isTargetPage(test) {
    const currentPath = normalizePath(location.pathname);
    return test.pages.some((page) => {
      const pattern = normalizePath(page).split('*').map((part) => {
        return part.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
      }).join('.*');
      return new RegExp('^' + pattern + '$').test(currentPath);
    });
  }

  // ユーザーをランダムにグループへ振り分け、Cookieに保存する関数
  // Cookie: ab_test_experiments_{slot} = "{method}:{group}"
  function assignGroup(test) {
    const groupProperty = 'ab_test_experiments_' + test.slot; 

    // すでにCookieがあり、テスト名とグループが一致する場合はそのまま返す 
    const savedCookie = (readCookie(groupProperty) || '').split(':');
    if (savedCookie[0] === test.method && test.groups.indexOf(savedCookie[1]) >= 0) {
      return { group: savedCookie[1], groupProperty: groupProperty, tracked: true };
    }
    // グループの数に合わせてランダムに振り分け
    const group = test.groups[Math.floor(Math.random() * test.groups.length)];

    // Cookieに保存できた場合はそのグループを返す
    if (writeCookie(groupProperty, test.method + ':' + group)) {
      return { group: group, groupProperty: groupProperty, tracked: true };
    }
    // Cookieを保存できない端末は、毎回グループが変わってしまうため対象外にする
    return { group: test.groups[0], groupProperty: groupProperty, tracked: false };
  }

  // テスト設定を読み込み、選ばれなかったグループの要素を非表示にするCSS生成・適用する処理
  // 期間内で、かつ pages に当てはまるテストだけを動かす
  const hideRules = [];
  const groupTokens = [];
  const activeMethods = [];
  (window.AB_TESTS || []).forEach((test) => {
    // 期間外・対象ページ外のテストは除外
    if (!isInPeriod(test) || !isTargetPage(test)) return;
    const result = assignGroup(test);
    result.population = test.population || 'visible';
    assignments[test.method] = result;
    activeMethods.push(test.method);

    const scope = '[data-ab-test="' + test.method + '"]';
    const others = '[data-ab-only]:not([data-ab-only="' + result.group + '"])';
    hideRules.push(scope + ' ' + others, scope + others);
    groupTokens.push(test.method + ':' + result.group);
  });

  // 動いていないテスト（期間外・対象ページ外・設定から消したもの）は、オリジナル以外を隠す
  const inactiveScope = '[data-ab-test]' + activeMethods.map((method) => {
    return ':not([data-ab-test="' + method + '"])';
  }).join('');
  const notOriginal = '[data-ab-only]:not([data-ab-only="' + ORIGINAL_GROUP + '"])';
  hideRules.push(inactiveScope + ' ' + notOriginal, inactiveScope + notOriginal);

  const style = document.createElement('style');
  style.textContent = hideRules.join(',') + '{display:none!important}';
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
    const observer = new IntersectionObserver((entries)=> {
      if (entries.some(isVisible)) {
        observer.disconnect();
        send('population', method);
      }
    }, { threshold: thresholds });
    elements.forEach((el) => { observer.observe(el); });
  }

  // 対象テストの要素を探し、設定に応じた方法で表示イベント（population）の計測を開始する関数
  function trackPopulation() {
    Object.keys(assignments).forEach((method) => {
      const a = assignments[method];
      const targets = Array.prototype.filter.call(
        document.querySelectorAll('[data-ab-test="' + method + '"]'),
        (el) => { return !el.hasAttribute('data-ab-only') || el.getAttribute('data-ab-only') === a.group; }
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
    list.forEach((method) => { send('cv', method); });
  }

  // CV対象（data-ab-cv）がクリックされたら自動でCV計測を行うイベントリスナー
  // ボタンなどにテスト名が書いてない場合は、一個上の要素にないか確認する。
  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('[data-ab-cv]');
    if (!el) return;
    const owner = el.closest('[data-ab-test]');
    convert(el.getAttribute('data-ab-cv') || (owner && owner.getAttribute('data-ab-test')) || '');
  }, true);

  window.abTest = {
    group: (method) => { return assignments[method] ? assignments[method].group : null; },
    convert: convert
  };
})();
