# A/Bテスト 実装ガイド

GTMとGA4の共通設定が済んでいる前提で、ページにA/Bテストを入れる手順です。


## 1. `<head>` に追加する
- A/Bテストの振り分けが終わるまで、オリジナル以外の案を一時的に隠すCSS
- abテストのロジックを書いたjs
- GTMのスニペットより**前に**書く
```html
<style>
  html:not(.ab-ready) [data-ab-only]:not([data-ab-only="original"]) { display: none; }
</style>
<script src="/js/ab-test.js"></script>
```

## 2. 設定ファイルにテストを追記する

`window.AB_TESTS` に、テストを1つ追記します。

```js
window.AB_TESTS = [
  {
    method: '追跡型CTA追加',
    slot: 3,
    groups: ['original', 'group_a'],
    population: 'pageview',
    start: '2026-11-10',
    end: '2026-12-10',
    pages: ['/']
  }
];
```

| 項目 | 内容 |
|---|---|
| `method` | テスト名。判定側の `test_id` と同じ文字列にする（スペース・記号 `"` `:` は使わない） |
| `slot` | `ab_test_experiments_{slot}` の番号。スロット台帳で空きを確認する |
| `groups[]` | グループ名。判定側の `groups` の値と同じにする。先頭は必ず `'original'`。振り分けは均等 |
| `start` / `end` | 実施期間（日本時間、両日を含む）。期間外はオリジナルが表示され、計測もされない |
| `population` | 片方にしか要素がないテスト（パターン2）のときだけ `'pageview'` を書く |
| `pages[]` | テストを動かすページのパス。CVの到達ページも入れる |

### `pages[]` の書き方

| 書き方 | 当てはまるページ |
|---|---|
| `'/'` | トップページ（`/index.html` も同じ） |
| `'/campaign/'` | `/campaign/` と `/campaign/index.html` |
| `'/campaign/*'` | `/campaign/` 配下のすべてのページ |

- `pages` に当てはまらないページでは、振り分けも計測もしません。
- `pages` を書き忘れたテストは動きません（ブラウザのコンソールに警告が出ます）。

### 注意

- 設定ファイルは全ページで共通です。追記するときは、他のテストの行を消さないでください。

## 3. 表示を作る

テストの範囲を `data-ab-test="テスト名"` で囲み、変更内容に合わせて次のどれかで書きます。

### パターン1：共通の要素の色・文言を変える

```html
<div class="home-hero-button" data-ab-test="ヒーローボタン改善">
  <a href="…" class="home-hero-button__type" data-ab-cv>
    <span data-ab-only="original">Ｖプリカアプリをダウンロード</span>
    <span data-ab-only="group_a">無料でアプリを始める</span>
  </a>
</div>
```
```css
html[data-ab-groups~="ヒーローボタン改善:group_a"] .home-hero-button__type { background-color: #E8453C; }
```

- HTML：グループごとに `data-ab-only` を付けて並べます。
- CSS：`html[data-ab-groups~="テスト名:グループ名"]` で書き分けます。


### パターン2：片方にだけ要素を表示する（追跡型CTAなど）

```html
<div data-ab-test="追跡型CTA追加">
  <a href="…" class="sticky-cta" data-ab-only="group_a" data-ab-cv>今すぐ申し込む</a>
</div>

<!-- 両グループにある元のボタンにも、テスト名を指定してCVを付ける -->
<a href="…" class="btn" data-ab-cv="追跡型CTA追加">アカウント開設はこちら</a>
```

- 設定に `population: 'pageview'` を書きます（original には要素がないため）。
- CVは、両グループにある操作にします。追跡型CTAのクリックだけをCVにすると、比較できません。
- JSで処理を分けたいときは、`abTest.group('テスト名')` でグループ名を取得できます。テストが動いていないときは `null` が返ります。

### パターン3：ブロックごと差し替える

```html
<div data-ab-test="キャンペーン訴求ブロック">
  <div data-ab-only="original"> … <a href="…" data-ab-cv>参加する</a></div>
  <div data-ab-only="group_a">  … <a href="…" data-ab-cv>今すぐ参加</a></div>
</div>
```

### 共通のルール

- `data-ab-only` は、必ず `data-ab-test` の中（またはその要素自身）に付けます。
- テストが動いていないとき（期間外・対象ページ外・設定から消したとき）は、`data-ab-only="original"` の要素だけが表示されます。

## 4. CVを付ける

- **クリック**：要素に `data-ab-cv` を付けます。`data-ab-test` の外にある要素は、`data-ab-cv="テスト名"` と書きます。
- **ページ到達**（完了ページなど）：
  1. 到達ページにも、1と同じコードを入れます。
  2. 設定の `pages` に到達ページのパスを追加します。
  3. `<script>abTest.convert('テスト名');</script>` を呼びます。
  - 到達ページは `*.lifecard.co.jp` 配下である必要があります。

## 5. 確認する

### グループを切り替えて表示を確認する

ブラウザの開発者ツールのコンソールで次のコードを実行すると、指定したグループに切り替わります。スロット番号・テスト名・グループ名は、確認するテストに合わせて書き換えてください。

```js
document.cookie = 'ab_test_experiments_3=' + encodeURIComponent('追跡型CTA追加:group_a') + '; path=/; domain=.lifecard.co.jp';
location.reload();
```

- original を確認するときは、`group_a` を `original` に変えて実行します。
- `lifecard.co.jp` 以外の検証環境では、`; domain=.lifecard.co.jp` を消して実行します。
- 今のグループは、コンソールで `abTest.group('追跡型CTA追加')` を実行すると確認できます。

### 計測を確認する

1. GTMのプレビューで、`population` と、CVの操作をしたときの `cv` が出ることを確認します。どちらにも `method` とユーザープロパティ `ab_test_experiments_{slot}` が付いていればOKです。
2. 対象ページ以外のページを開き、このテストの `population` と `cv` が出ないことを確認します。
3. 既存の計測（tap など）が従来どおり出ることを確認します。

確認のときの操作もGA4に記録されます。

## 6. 期間を変える・終了する

- **期間の変更**：`window.AB_TESTS` の `start` / `end` を直します。HTMLを直す必要はありません。
- **終了**：
  1. 勝ったパターンを本実装します。
  2. `window.AB_TESTS` からそのテストの行を消します。
  3. HTMLの `data-ab-*` 属性と、テスト用のCSSを削除します。
- 終了作業が `end` より遅れても、期間を過ぎた時点でオリジナルが表示され、計測も止まります。
