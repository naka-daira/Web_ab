# A/Bテスト 実装用一式

## ファイル

| ファイル | 役割 | 直すタイミング |
|---|---|---|
| `ab-tests.config.js` | テストの設定（テスト名・スロット・グループ・期間・対象ページ） | テストの追加・期間の変更・終了のたび |
| `ab-test.js` | 振り分け・表示の切り替え・計測の本体 | 基本的に直さない |
| `index.html` / `sticky.html` | 検証用ページ（出し分けの要素とCSSはページ側に書く） | テストの内容を作るとき |
| `debug.js` | 検証用の確認パネル | 本番には入れない |

## ページの `<head>` に入れるもの（GTMスニペットより前）

```html
<style>
  html:not(.ab-ready) [data-ab-only]:not([data-ab-only="original"]) { display: none; }
</style>
<script src="/js/ab-tests.config.js"></script>
<script src="/js/ab-test.js"></script>
```

- 設定ファイルは、必ず `ab-test.js` より前に読み込みます。
- `async` や `defer` は付けません（理由は「表示切り替えの仕組み」の「ちらつきを防ぐしくみ」を参照）。

---

## 表示切り替えの仕組み

### 全体の流れ

ページを開くと、次の順に処理されます。①〜⑥は `<head>` の中で終わり、`<body>` が表示される前に完了します。

| 順番 | どこで | 何をするか |
|---|---|---|
| ① | `<head>` の `<style>` | `ab-ready` が付くまで、`original` 以外の要素を隠す |
| ② | `ab-tests.config.js` | `window.AB_TESTS` にテストの設定を入れる |
| ③ | `ab-test.js` | テストごとに「このページで動かすか」を判定する（期間と `pages`） |
| ④ | `ab-test.js` | 動かすテストについて、Cookieを見てグループを決める |
| ⑤ | `ab-test.js` | 選ばれなかったグループの要素を隠すCSSを作り、`<head>` に追加する |
| ⑥ | `ab-test.js` | `<html>` に `data-ab-groups` 属性と `ab-ready` クラスを付ける |
| ⑦ | ブラウザ | `<body>` を読み込み、⑤のCSSが効いた状態で表示する |

### HTMLの属性

| 属性 | 付ける場所 | 意味 |
|---|---|---|
| `data-ab-test="テスト名"` | テストの範囲を囲む要素 | この中がテストの対象 |
| `data-ab-only="グループ名"` | `data-ab-test` の中の要素（または `data-ab-test` の要素自身） | このグループのときだけ表示する |
| `data-ab-cv` / `data-ab-cv="テスト名"` | CVにする要素 | クリックで `cv` を送る（表示の切り替えには関係しない） |

`data-ab-only` が付いていない要素は、どのグループでも表示されます。

### ③ このページで動かすかの判定

設定のテストごとに、次の2つを両方満たすかを判定します。

1. **期間内か**（`isInPeriod`）
   - 今の時刻が、`start` の 00:00:00 から `end` の 23:59:59 まで（日本時間）の間にあるか
2. **対象ページか**（`isTargetPage`）
   - 今のURLのパスが、`pages` のどれかと一致するか
   - `*` は任意の文字列として扱う
   - 末尾の `index.html` は取って比べる（`/` と `/index.html` は同じ）
   - `pages` がないテストは動かさない（コンソールに警告を出す）

両方を満たすテストを「動いているテスト」、それ以外を「動いていないテスト」と呼びます。

### ④ グループの決め方（`assignGroup`）

Cookie `ab_test_experiments_{slot}` に `テスト名:グループ名` の形で保存します（例：`ab_test_experiments_3=追跡型CTA追加:group_a`）。

| Cookieの状態 | 結果 |
|---|---|
| 同じテスト名で、`groups` にあるグループが保存されている | そのグループを使う（再訪問しても同じ表示になる） |
| ない／別のテスト名／`groups` にないグループ | `groups` からランダムに1つ選び、Cookieに保存する |
| Cookieを保存できない端末 | `groups` の先頭（`original`）を表示し、計測もしない |

- Cookieの有効期限は90日です。
- `lifecard.co.jp` では `.lifecard.co.jp` に保存するので、サブドメインをまたいでも同じグループになります。
- 同じスロットで別のテストを始めると、テスト名が変わるのでグループを振り分け直します。

### ⑤ 要素を隠すCSSの作り方

`ab-test.js` は、次の2種類のルールを作り、`<style>` として `<head>` に追加します。どちらも `{display:none!important}` です。

**A. 動いているテスト：選ばれたグループ以外を隠す**

```css
[data-ab-test="テスト名"] [data-ab-only]:not([data-ab-only="選ばれたグループ"]),
[data-ab-test="テスト名"][data-ab-only]:not([data-ab-only="選ばれたグループ"])
```

**B. 動いていないテスト：`original` 以外を隠す**

```css
[data-ab-test]:not([data-ab-test="動いているテスト1"]):not(...) [data-ab-only]:not([data-ab-only="original"]),
[data-ab-test]:not([data-ab-test="動いているテスト1"]):not(...)[data-ab-only]:not([data-ab-only="original"])
```

- Bは「動いているテスト以外のすべての `data-ab-test`」に当てはまります。そのため、期間外のテスト、対象ページ外のテスト、設定ファイルから消したテストは、どれも `original` の表示になります。
- 動いているテストが1つもないときは、`:not(...)` がなくなり、すべての `data-ab-test` が対象になります。

**セレクタを2つ書いている理由**

| セレクタ | 当てはまる書き方 |
|---|---|
| `[data-ab-test="…"] [data-ab-only]`（間にスペースあり） | `data-ab-test` の**中**にある `data-ab-only` |
| `[data-ab-test="…"][data-ab-only]`（スペースなし） | `data-ab-test` と `data-ab-only` が**同じ要素**に付いている |

**`!important` を付けている理由**

ページ側のCSSで `display: flex` などを指定していても、確実に隠すためです。

### ⑥ `<html>` に付ける属性とクラス

| 付けるもの | 例 | 使い道 |
|---|---|---|
| `data-ab-groups` 属性 | `data-ab-groups="ヒーローボタン改善:group_a"` | 色やサイズをCSSで書き分ける（パターン1） |
| `ab-ready` クラス | `class="ab-ready"` | ①の初期CSSを止める |

`data-ab-groups` には、動いているテストだけが `テスト名:グループ名` の形でスペース区切りで入ります。CSSでは `~=`（スペース区切りの中に一致するものがある）で判定します。

```css
html[data-ab-groups~="ヒーローボタン改善:group_a"] .home-hero-button__type { background-color: #E8453C; }
```

動いていないテストは `data-ab-groups` に入らないので、このCSSは効かず、元の色のままになります。

### ちらつきを防ぐしくみ

- `ab-test.js` は `<head>` の中で同期で読み込むので、`<body>` が表示される前に⑤のCSSが入ります。最初から選ばれたグループの表示になり、元の画面が一瞬見えることはありません。
- `async` / `defer` を付けたり、GTMから読み込んだりすると、`<body>` が表示された後に切り替わるため、ちらつきます。
- ①の初期CSSは、`ab-test.js` が動くまでの間と、読み込みに失敗したときの保険です。失敗した場合も `ab-ready` が付かないので、`original` 以外は隠れたままになります。

### 状態ごとの表示

| 状態 | 表示されるもの | `population` / `cv` |
|---|---|---|
| 動いている（期間内・対象ページ） | 選ばれたグループ | 送る |
| 期間外 | `original` | 送らない |
| 対象ページ外 | `original` | 送らない |
| 設定ファイルからテストを消した | `original` | 送らない |
| Cookieを保存できない端末 | `original` | 送らない |
| 設定ファイルの読み込みに失敗 | `original` | 送らない |
| `ab-test.js` の読み込みに失敗 | `original`（①の初期CSS） | 送らない |

### 例：sticky.html で group_a に振り分けられたとき

`<head>` に追加されるCSS：

```css
[data-ab-test="追跡型CTA追加"] [data-ab-only]:not([data-ab-only="group_a"]),
[data-ab-test="追跡型CTA追加"][data-ab-only]:not([data-ab-only="group_a"]),
[data-ab-test]:not([data-ab-test="追跡型CTA追加"]) [data-ab-only]:not([data-ab-only="original"]),
[data-ab-test]:not([data-ab-test="追跡型CTA追加"])[data-ab-only]:not([data-ab-only="original"])
{display:none!important}
```

`<html>` の状態：

```html
<html lang="ja" data-ab-groups="追跡型CTA追加:group_a" class="ab-ready">
```

- 追跡型CTA（`data-ab-only="group_a"`）は、選ばれたグループなので隠されず、表示されます。
- original に振り分けられた場合は、1行目のルールに当てはまるので隠されます。

### JSで処理を分けるとき

追跡型CTAをスクロールで出し入れするような、CSSだけではできない動きは `abTest.group('テスト名')` で分けます。テストが動いていないときは `null` が返ります。

```js
if (abTest.group('追跡型CTA追加') !== 'group_a') return;   // group_a 以外では何もしない
```

---

## 注意

- オリジナルのグループ名は `original` にしてください。動いていないテストでは、この名前の要素を表示します。
- `data-ab-only` は、必ず `data-ab-test` の中（またはその要素自身）に付けてください。外に付けると、どのグループでも表示されます。
- CVの到達ページ（完了ページなど）も `pages` に入れてください。入れないとCVが送られません。
- `ab-tests.config.js` がブラウザやCDNに長くキャッシュされると、期間の変更がすぐに反映されません。このファイルだけキャッシュ時間を短くするか、`ab-tests.config.js?v=20261110` のようにバージョンを付けてください。
- 検証用ページの `pages` は、置き場所に関係なく動くように `'*/'` と書いています。本番では `'/'` や `'/apply/complete/'` のように正確なパスで書いてください。
