/*
 * ab-test.js
 * <head> 内、GTMスニペットより前に同期で読み込む。直前に window.AB_TESTS を定義しておく。
 */
(function () {
  'use strict';

  var COOKIE_DOMAIN = location.hostname.endsWith('lifecard.co.jp') ? '.lifecard.co.jp' : '';
  var COOKIE_MAX_AGE = 90 * 24 * 60 * 60;
  var VISIBLE_RATIO = 0.5;

  var dataLayer = window.dataLayer = window.dataLayer || [];
  var assignments = {};   // { method: { group, groupProperty, population } }

  function readCookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function writeCookie(name, value) {
    var cookie = name + '=' + encodeURIComponent(value) + '; max-age=' + COOKIE_MAX_AGE + '; path=/; SameSite=Lax';
    if (COOKIE_DOMAIN) cookie += '; domain=' + COOKIE_DOMAIN;
    if (location.protocol === 'https:') cookie += '; Secure';
    document.cookie = cookie;
    return readCookie(name) === value;
  }

  function isInPeriod(test) {
    var now = Date.now();
    if (test.start && now < new Date(test.start + 'T00:00:00+09:00').getTime()) return false;
    if (test.end && now > new Date(test.end + 'T23:59:59+09:00').getTime()) return false;
    return true;
  }

  function forcedGroup() {
    var match = location.search.match(/[?&]ab_group=([^&]*)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  // Cookie: ab_test_experiments_{slot} = "{method}:{group}"
  // method が変わったら（同じスロットで別のテストが始まったら）振り分け直す
  function assignGroup(test) {
    var groupProperty = 'ab_test_experiments_' + test.slot;
    var forced = forcedGroup();
    if (test.groups.indexOf(forced) >= 0) return { group: forced, groupProperty: groupProperty, tracked: true };

    var saved = (readCookie(groupProperty) || '').split(':');
    if (saved[0] === test.method && test.groups.indexOf(saved[1]) >= 0) {
      return { group: saved[1], groupProperty: groupProperty, tracked: true };
    }

    var group = test.groups[Math.floor(Math.random() * test.groups.length)];
    if (writeCookie(groupProperty, test.method + ':' + group)) {
      return { group: group, groupProperty: groupProperty, tracked: true };
    }
    // Cookieを保存できない端末は、毎回グループが変わってしまうため対象外にする
    return { group: test.groups[0], groupProperty: groupProperty, tracked: false };
  }

  var hideRules = [];
  var groupTokens = [];
  (window.AB_TESTS || []).forEach(function (test) {
    if (!isInPeriod(test)) return;
    var result = assignGroup(test);
    result.population = test.population || 'visible';
    assignments[test.method] = result;

    var scope = '[data-ab-test="' + test.method + '"]';
    var others = '[data-ab-only]:not([data-ab-only="' + result.group + '"])';
    hideRules.push(scope + ' ' + others, scope + others);
    groupTokens.push(test.method + ':' + result.group);
  });

  var style = document.createElement('style');
  style.textContent = hideRules.length ? hideRules.join(',') + '{display:none!important}' : '';
  document.head.appendChild(style);
  document.documentElement.setAttribute('data-ab-groups', groupTokens.join(' '));
  document.documentElement.classList.add('ab-ready');

  function send(eventName, method) {
    var a = assignments[method];
    if (!a || !a.tracked) return;
    var data = { event: eventName, method: method };
    data[a.groupProperty] = a.group;   // 例: ab_test_experiments_3: 'group_a'
    dataLayer.push(data);
  }

  function isVisible(entry) {
    if (!entry.isIntersecting) return false;
    if (entry.intersectionRatio >= VISIBLE_RATIO) return true;
    var viewportHeight = (entry.rootBounds && entry.rootBounds.height) || window.innerHeight;
    return entry.intersectionRect.height >= viewportHeight * VISIBLE_RATIO;
  }

  function sendPopulationWhenVisible(method, elements) {
    var thresholds = [];
    for (var i = 0; i <= 20; i++) thresholds.push(i / 20);
    var observer = new IntersectionObserver(function (entries) {
      if (entries.some(isVisible)) {
        observer.disconnect();
        send('population', method);
      }
    }, { threshold: thresholds });
    elements.forEach(function (el) { observer.observe(el); });
  }

  function trackPopulation() {
    Object.keys(assignments).forEach(function (method) {
      var a = assignments[method];
      var targets = Array.prototype.filter.call(
        document.querySelectorAll('[data-ab-test="' + method + '"]'),
        function (el) { return !el.hasAttribute('data-ab-only') || el.getAttribute('data-ab-only') === a.group; }
      );
      if (!targets.length) return;
      if (a.population === 'pageview') send('population', method);
      else sendPopulationWhenVisible(method, targets);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', trackPopulation);
  else trackPopulation();

  function convert(methods) {
    var list = methods ? methods.split(' ') : Object.keys(assignments);
    list.forEach(function (method) { send('cv', method); });
  }

  // data-ab-cv の値（テスト名）→ 囲んでいる data-ab-test → ページ内の全テスト の順にCVの対象を決める
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-ab-cv]');
    if (!el) return;
    var owner = el.closest('[data-ab-test]');
    convert(el.getAttribute('data-ab-cv') || (owner && owner.getAttribute('data-ab-test')) || '');
  }, true);

  window.abTest = {
    group: function (method) { return assignments[method] ? assignments[method].group : null; },
    convert: convert
  };
})();
