/*
 * ab-tests.config.js
 * A/Bテストの設定ファイル。テストの追加・期間の変更・終了は、このファイルだけを直す。
 * <head> 内で ab-test.js より前に読み込む。
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
 * 行を消し忘れても、end を過ぎればオリジナルが表示される。
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
