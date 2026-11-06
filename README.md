# A/Bテスト実装ガイド（HTML/CSS/JS ＋ GTM → GA4）

判定側（AB_TESTS の設定でGA4 Data APIから集計する仕組み）に合わせた計測仕様です。

## 構成

| 役割 | 担当 | 置き場所 |
|---|---|---|
| 振り分け・固定化（Cookie）・表示の切り替え | `ab-test.js` | HTMLの `<head>` に直接（GTMより前、同期読み込み） |
| 母数・CVを dataLayer に積む | `ab-test.js` | 同上 |
| dataLayer → GA4 へ送信 | GTM | 変数3・トリガー1・タグ1（全テスト共通・使い回し） |
| 集計 | GA4 ＋ 判定側コード | カスタムディメンション（`method`、`ab_test_experiments_N`） |

振り分けはGTMではなくHTMLで行います。GTMは非同期で読み込まれるため、GTMで書き換えると一瞬元の表示が見えてしまうからです（ちらつき）。

## GA4に送るもの（判定側の設定との対応）

| 判定側の設定 | GA4に送るもの | いつ |
|---|---|---|
| `denominator_filter` | イベント `population`（パラメータ `method` = テスト名） | 対象要素の50%以上が画面に入った時（テストごと・1ページ表示につき1回） |
| `cv_filter` | イベント `cv` または `tcv`（パラメータ `method` = テスト名） | `data-ab-cv` 付き要素のクリック、または `abTest.convert()` の呼び出し |
| `ab_param` | ユーザープロパティ `ab_test_experiments_{slot}` = グループ値 | 上の2つのイベントに付けて送る |
| `groups` | グループ値（例：`original` / `group_a` / `group_b`） | — |

判定側のテスト定義は、例えば次のようになります。

```python
{
    "test_id": "ヒーローボタン改善",
    "model_type": "beta_binomial",
    "property_id": "properties/XXXXXXXXX",
    "start_date": "2026-11-06",
    "groups": {"original": "original", "A": "group_a"},
    "cv_filter": [{"event_name": "cv", "params": {"customEvent:method": "ヒーローボタン改善"}}],
    "denominator_filter": {"event_name": "population", "params": {"method": "ヒーローボタン改善"}},
    "ab_param": "customUser:ab_test_experiments_2",
}
```

## HTML側の実装

### 1. `<head>` に設置（GTMスニペットより前）

```html
<style>
  /* JSが動かなかった時はオリジナルだけを見せる */
  html:not(.ab-js) [data-ab-variant]:not([data-ab-variant="original"]) { display: none; }
</style>
<script>
  window.AB_CONFIG = { cookieDomain: '.lifecard.co.jp' }; // サブドメイン間で振り分けを共有
  window.AB_TESTS = [
    {
      id: 'hero_app_btn_2611',          // サイト内の識別子（英小文字・数字・_・-）
      method: 'ヒーローボタン改善',       // = 判定側 test_id / method
      slot: 2,                          // = ab_test_experiments_2
      groups: ['original', 'group_a'],  // = 判定側 groups の値。先頭がオリジナル
      weights: [50, 50],
      cvEvent: 'cv',                    // 'cv' または 'tcv'
      start: '2026-11-06',
      end: '2026-12-31'
    }
  ];
</script>
<script src="/js/ab-test.js"></script>   <!-- async / defer は付けない -->
<!-- ここにGTMスニペット -->
```

- **slot**：並行して実施するテスト同士で重ならない番号にします。本番では `ab_test_experiments_1` が「ログイン成功率改善」で使用中です。
- **groups**：判定側の `groups` の値と完全に一致させます。

### 2. パターンの作り方（2通り）

**(a) マークアップを複数置く**：文言や構成が大きく違う場合

```html
<div data-ab-test="hero_app_btn_2611">
  <a href="..." data-ab-variant="original" data-ab-cv>アカウント開設はこちら</a>
  <a href="..." data-ab-variant="group_a"  data-ab-cv>今すぐ無料で発行する！</a>
</div>
```

**(b) CSSだけで変える**：色・サイズなどの違いだけの場合

```html
<div class="home-hero-button" data-ab-test="hero_app_btn_2611">…</div>
```
```css
html[data-ab-hero_app_btn_2611="group_a"] .home-hero-button__type { background-color: #E8453C; }
```

### 3. CVの付け方

- **クリック型**：要素に `data-ab-cv` を付けるだけです。
  - どのテストのCVとして数えるかは、次の順で決まります。
    1. 値に書いたテストID（例：`data-ab-cv="id1 id2"`）
    2. 一番近い祖先要素の `data-ab-test`
    3. そのページで有効な全テスト
- **ページ到達型**（完了ページなど）：完了ページにも同じ `AB_TESTS` と `ab-test.js` を入れ、`<script>abTest.convert();</script>` を呼びます。引数なしなら有効な全テスト、`abTest.convert('hero_app_btn_2611')` なら指定したテストだけにCVが付きます。

### 4. テストの追加・終了

- **追加**：`AB_TESTS` に1行足し、HTMLに `data-ab-test` を付けます。`id` と `method` は毎回新しいものにしてください。
- **終了**：`end` を過ぎると自動で無効になり、オリジナル表示に戻ります。勝った案を本実装したら、該当する行を削除します。終了したテストの `slot` は、次のテストで再利用できます。

### 5. QA

`?ab_force=hero_app_btn_2611:group_a` を付けると、そのページ表示だけグループを強制できます（Cookieには保存されません）。

## GTM設定（初回のみ・全テスト共通）

**変数**（種類：データレイヤーの変数、バージョン2）

| 変数名 | データレイヤーの変数名 | 用途 |
|---|---|---|
| `method` | `method` | イベントパラメータ |
| `ab_up_name` | `ab_up_name` | ユーザープロパティ名（`ab_test_experiments_N`） |
| `ab_up_value` | `ab_up_value` | ユーザープロパティの値（グループ値） |

**トリガー**：`ab イベントトリガー`
- 種類：カスタムイベント
- イベント名：`^(population|cv|tcv)$`（「正規表現一致を使用」にチェック）

**タグ**：`ab イベント`
- 種類：Google アナリティクス：GA4 イベント
- 測定ID：GA4の測定ID
- イベント名：`{{Event}}`
- イベントパラメータ：`method` = `{{method}}`
- ユーザープロパティ：名前 `{{ab_up_name}}`、値 `{{ab_up_value}}`（名前の欄にも変数を使えます）
- 配信トリガー：`ab イベントトリガー`

ユーザープロパティ名を変数にしているので、`slot` が何番でもタグは1つで済みます。

## GA4設定（初回のみ）

管理 → カスタム定義 → カスタムディメンションを作成します。

| ディメンション名 | 範囲 | パラメータ / ユーザープロパティ |
|---|---|---|
| `method` | イベント | `method` |
| `ab_test_experiments_1` 〜 `_N` | **ユーザー** | `ab_test_experiments_1` 〜 `_N` |

- 判定側の `customUser:ab_test_experiments_N` を使うには、ユーザー範囲での登録が必要です。並行して実施する数だけ（例：5つ）作っておくと、テストのたびに追加しなくて済みます。
- カスタムディメンションは登録した時点からしか集計されません。テスト開始前に登録してください。

## 注意点・制約

- **振り分けの保存はCookieのみです**（localStorageは使わない方針で、該当コードはコメントアウトしています）。Cookieを保存できない端末は、毎回振り分けが変わってしまうので**テスト対象外**にします。オリジナルを表示し、`population` も `cv` も送りません。
- **ドメインをまたぐと振り分けを引き継げません。** Cookieは `cookieDomain` で指定したドメイン配下だけで共有されます。kintone や support.aiful.co.jp など別ドメインの完了ページでは引き継げません。
- **Safari（ITP）はJSで書いたCookieを最大7日で消します。** 7日以上空けて再訪したSafariユーザーは再抽選されます。
- **GA4のユーザープロパティは上書き型です。** 再抽選などで値が変わると、それ以降のイベントには新しいグループが付きます。
- **GA4の入力値には制限があります。** ユーザープロパティの値は36文字まで、`method` の値は100文字までです。
