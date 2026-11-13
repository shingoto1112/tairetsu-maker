# アプリ内のお知らせ（1.2.0）

原稿は `src/announcements/announcements.v1.json` の1ファイルだけ。アプリ同梱と公開用 `/announcements.v1.json` は同じ原稿を使う。Vite が build 時に固定名で出力し、dev / preview でも同じパスで配信する。版番号変更とは独立している。

## 配信契約 v1

```json
{
  "schemaVersion": 1,
  "revision": 1,
  "items": [{
    "id": "2026-11-v1-2-0",
    "publishedAt": "2026-11-14T09:00:00+09:00",
    "kind": "update",
    "locales": { "ja": { "title": "タイトル", "body": "本文", "links": [{ "label": "詳細", "url": "https://apps.apple.com/" }] } }
  }]
}
```

- schemaVersion は 1 のみ。revision は0以上の安全な整数で単調増加。id は空でない不変の文字列で、削除後も再利用禁止。
- publishedAt はオフセット付き ISO8601（Z 可）。表示は Asia/Tokyo の年月日で新しい順。
- kind は update=アップデート、feature=新機能、info=お知らせ、maintenance=不具合・メンテナンス。未知の文字列は info。未知フィールドは無視する。
- locales[現在の言語] → ja で選択。現在の言語は今は ja 固定。使える言語がなければその項目を表示しない。
- 必須項目欠落・型違反・重複ID・上限超過は一覧全体を不採用。不正リンクだけは除外する。
- 上限は100件、受信全体256KiB（実バイト数）、title 120字、body 10000字、links 3件、label 40字。文字数はUnicodeコードポイントで数える。
- links は省略可能。本文はプレーンテキスト。空行で段落、行頭「・」「- 」は箇条書き。HTMLは実行しない。
- リンクは new URL で解析し、https、ユーザー情報なし、既定ポート、アプリの publicSiteUrl の origin または https://apps.apple.com との完全一致だけを許す。表示時とクリック時に検証し、target="_blank" rel="noopener noreferrer" で開く。配信原稿で許可originを増やせない。

## 取得・採用・既読

Webは同一オリジンの `/announcements.v1.json`、Capacitor iOSは publicSiteUrl の同パス。credentials omit、cache no-cache、独自ヘッダー・識別情報なし。5秒で本文受信ごと中断し、Content-Length に依存せず受信量を制限する。

ホームでは正常キャッシュまたは同梱分を即時表示し、前回成功から6時間以上なら非同期取得。鈴で開く際も取得するが前回試行から1分未満は省略。同時取得は1本化し、失敗後も1分間抑制。常時ポーリングしない。失敗は黙って既存一覧を維持する。

同梱・検証済みキャッシュ・取得分の最大revisionを一覧全体として採用する。同値は取得 > キャッシュ > 同梱。有効な空一覧も採用し、削除記事を同梱から補充しない。新しいrevisionを見た端末へ古いrevisionを配信しても戻せない。

localStorage キーは `stageflow.announcements.cache.v1`、`.read.v1`、`.meta.v1`。キャッシュも読み込み時に検証する。既読は一覧が描画された後、その時表示対象のIDを保存する（スクロール到達は条件にしない）。開いている間に取得して表示された記事も既読になる。新着の印は開いた時点の未読記事に残す。既読IDは500件までで古い登録から削る。同じIDの訂正は再度未読にしない。アカウント同期なし。保存不可でも画面は落ちず、次回起動では未読に戻る場合がある。

## 発信手順

1. 原稿に1件足す。新しい不変ID、公開日時（オフセット必須）、日本語タイトル・本文を記入する。
2. revision を1増やす。
3. `npm run build` で原稿の妥当性と `dist/announcements.v1.json` の生成を確認する。不正原稿はビルドを失敗させる。
4. main に push して通常の公開サイト配信へ反映する。公開後はWeb・iPadが次の取得時に読む。CDNキャッシュは最大300秒。

訂正は同じidで内容を変更しrevisionを上げる。取り下げは項目を削除しrevisionを上げる。全件取り下げは items: []。公開URL `/announcements.v1.json` は旧アプリの取得先なので永久に維持する。

このJSONは誰でも取得できる公開情報。非公開情報・個人情報を載せない。審査時は本文とリンク先がアプリ内のお知らせの用途に沿うことを確認する。審査後も実行コードや審査対象機能の追加・変更には使わない。プッシュ通知、自動ポップアップ、強制表示、最小バージョン制限は実装しない。TestFlight前のアプリ版番号と初回記事の公開日時は別途リリース担当が更新する。
