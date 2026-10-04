# 共同編集 8a-2（画面・一覧・題名・アカウント）

2026-10-04 / branch `codex/ipad-release-20261002` / 作業開始 HEAD `180e8af`。
consult13 と 8a-1 の入口を使用。単独編集。commit/push、依存追加、本番接続、公開ゲスト有効化なし。

## 実装と判断

- 題名：Edge が schema 2 を検証した同じ Y.Doc の `settings.title` を読み、制御文字を空白へ置換し Unicode 120文字に制限。本文の題名は変更しない。独立した hint は拒否。schema 1 は互換用の「隊列表」。SQL の create/append と同じ transaction で `list_title` / `title_seq` を更新し、重複要求で古い題名へ戻さない。
- 一覧：`collab_v2_list_my_documents` は現在の `auth.uid()` の membership と RLS を使う。削除済み除外、作成日時＋UUID の降順 keyset paging。返すのは文書ID・表示題名・作成日時・作成者判定・人数・documentSchema。本文、他人のメール、topic、招待 token を返さない。
- 再開：`openExisting` は招待を使わず、同じ文書・本人・参加世代・文書世代の端末レコードを再開。pending をサーバー本文で置き換えない。新端末は新しい alias と固定 CommitRequest を作る。prepareJoin と取得・CRDT検証・要求生成を共通化し、取得完了時にも本人、参加世代、文書世代を再確認。
- バッジ：summary に任意の `sharing:{documentId,accountId?,membershipGeneration?}` を追加。人数は軽量なクラウド一覧から取得。全カードの CRDT を読む方式は採用しない。共有は未公開なので起動・upgrade時の補完は不要と再判断し、IndexedDBは既存version 3のまま。Swiftも起動時の全件補完を除去。通常の保存・開いた日時更新のtransactionでsummaryを付ける。旧試験用summaryは変更せず、通常更新まではバッジなし。原本・previous・revision・receiptを起動時に変更しない。ネイティブの列・DBバージョン・ブリッジを増やさない。旧バックアップのsummaryも検証可能。
- 画面：lazy の `CollaborationSurface` と UI service/hook に集約。App は入口と保存・開くの接続だけ。「共有と書き出し」先頭の「みんなで編集」から専用画面へ。状態は既存ツールバーの題名の右に置き、共有だけの行を増やさない。管理画面は固定見出し＋スクロール本文。状態storeの購読はProject/Canvasと分離。
- 日本語：共有の開始、招待（1人に1リンク・24時間・1回）、コピー、iPad共有シート、期限/取り消し、表示名/ゲスト/作成者、メンバー解除、退出、クラウド削除、端末コピー削除を区別。removed/ended/auth-required/membership-changed は別の帯。Undo は初回の説明と partial/blocked の都度の短い説明。V2 の共有文書の保存は「この端末に保存」。
- 救出：live の未送信編集を含む独立コピーを保存してから開く。保存待ちに追加編集が入った場合は元の画面を維持し、もう一度最新内容で保存できる。原本の attachment/outbox は残す。
- 招待：起動時、React/診断より先に `takeInvitationLink` で fragment を除去し、元リンクはメモリだけに保持。参加ボタンまで消費しない。StrictMode で二重参加しない。保存失敗は同じ要求で再試行。Web未ログインは表示名付きゲスト、iPad未ログインはログイン後に同じ参加画面へ戻る。再起動後は再貼り付け。Web にアプリへのコピー案内を表示。
- URL：正式 Web `https://tairetsu-maker.vercel.app` を既定。`VITE_COLLABORATION_INVITATION_URL` で試験URL/許可originを差し替える。招待 origin と Edge CORS origin は別設定。
- アカウント：共通 Auth のログイン/登録/ログアウト。削除は直前のパスワード再確認と `createCollaborationAccountApi` から共通 `delete_current_account` RPC へ。旧文書クライアントの遮断を通らない共通 account モジュールを設け、旧 API 側も同じ処理へ委譲。確認文は「自分が作った共有隊列表はクラウドから削除されます。他の人の端末のコピーは残ります」。ゲストのメールを前提にしない。メール再送/メールでの再設定を案内しない。

## 未適用 foundation / Edge の変更

foundation SQL に表示題名列と一覧順 index、一覧/open_existing/list_invites RPCを追加（公開 V2 関数20→23）。create/append の service専用引数に検証済み表示題名を追加。古い service署名を削除し、既存の ACL 制限を再適用する。旧テーブル・旧RPC定義/権限・共通削除RPCを改訂しない。Edge は検証結果の題名を service RPC に渡す。未適用前提なので、別の後付け migration は作らない。

## Claudeレビューへの修正

初版の補完が1件のattachment/summary破損で保存領域全体のopen/upgradeを失敗させる後退を直した。「行ごとにCORRUPTを飛ばす補完」は可能だが、未公開V2のためにDBバージョンと全件走査を残す利点が薄い。補完自体を外し、通常更新と同じ原子的transactionで表示用summaryを生成する方式を採用。毎回・初回とも起動時のbody走査は0回。破損は既存の個別復旧へ渡す。

Swift XCTestと実IndexedDBで、壊れた共有attachmentを含んでもopen/upgrade・再open・一覧・別文書・previousからの独立コピー復旧が動く試験を追加。起動時にsummary/原本/revision/receiptが不変で、健全な通常保存でバッジが付くことを確認する。

表示は「共有から外れました」「共有は終了しました」「ログインが必要です」「参加し直しが必要です」に変更。内部のsync分類「資格保留」は画面に出さない。同期済みだけ緑、確認中/送信待ち/オフラインは中立、資格問題/保存失敗は注意色。「参加状態を更新」は「最新の状態を確認」。カードの人数未取得は「共有中」、一人は「クラウド保存」。ホームのクラウド欄は端末にない文書だけを並べ、既存分は件数1行にまとめる。

今回の修正ファイル：`src/App.tsx`、`src/components/{Toolbar.tsx,CollaborationSurface.tsx,collaboration.css}`、`src/storage/{sharedSessionState.ts,sharedSessionState.test.ts}`、`src/repositories/{indexedDbFormat.ts,indexedDbRepository.ts,contract/testing/indexedDbBrowserSuite.ts}`、Swiftの`ProjectRepository.swift`/`CollaborationTests.swift`、`scripts/{check-native-repository.mjs,test-collaboration-ui-browser.mjs}`、この文書。

## 検証

Windows / Chromium 149 / 全ネットワーク試験は隔離ブラウザー、loopback Vite＋モック。環境ファイルは読み込まない。

| 試験 | 結果 |
| --- | --- |
| `npm test -- --maxWorkers 2` | 86 files / 726 tests、レビュー修正後2回 PASS |
| typecheck / diff --check | PASS |
| 一時 Vite build / check-collaboration-bundle | PASS、出力は削除。main 470,691 B（gzip 140,068 B）、基準466,239 Bから +4,452 B。静的起動 graph に Yjs/runtime なし |
| provider / collaboration-app / lifecycle ブラウザー | PASS。直接 provider を使う試験にも committedPending の保存完了接続を追加 |
| shared-session-app ブラウザー | PASS。即時同期、Undo、音源、資格変更、背景保存、iPad、旧API呼出0 |
| repository ブラウザー | PASS。共有attachment破損を隔離し、v2→v3/reopen/list/別文書/個別復旧が動く。旧summaryは補完せず不変。通常保存でバッジ生成。原本/previous/receipt維持、実blocked eventも確認 |
| app-storage / build22 ブラウザー | PASS。ZIP・音源・保存失敗保持・復旧・stage/parade各12寸法・タッチ・長いルート |
| check-collab-v2 / check-native-repository | PASS（Swiftコンパイルの代替ではない） |
| Node `--expose-gc` bench-collab-v2 | PASS。146人×18シーン、履歴0/128、p95 82.70/214.97ms、観測heap増加32.60/49.64MiB。Viteなしで読込可能 |
| 追加 UI E2E | 2回 PASS。ログイン/共有開始/明示ゲスト参加/保存失敗の同一要求再試行/同時編集/メンバー/解除/未送信編集救出/救出待ちの追加編集保持/終了/別端末openExisting/招待取消・期限切れ・使用済み/アカウント削除。旧文書API呼出0 |

`scripts/test-local-regression-browser.mjs` は既存試験を専用 V2 OFF サーバーへ向ける補助。本文を変更しない一時スクリプトは実行後に削除する。既存ユーザーの5179サーバーは操作しない。

## 画像

保存先：`C:\Users\shing\AppData\Local\Temp\claude\c--Users-shing-OneDrive--------ChatGPT-------\e5aa9c38-eb07-490c-ac06-62f047c4c161\scratchpad\shots-8a2\`

| 画面 | mini縦 | mini横 | 13インチ縦 | 13インチ横 |
| --- | --- | --- | --- | --- |
| ホーム | home-v2-744x1133.png | home-v2-1133x744.png | home-v2-1032x1376.png | home-v2-1376x1032.png |
| 状態 | status-v2-744x1133.png | status-v2-1133x744.png | status-v2-1032x1376.png | status-v2-1376x1032.png |
| 管理 | manage-v2-744x1133.png | manage-v2-1133x744.png | manage-v2-1032x1376.png | manage-v2-1376x1032.png |
| 解除 | removed-v2-744x1133.png | removed-v2-1133x744.png | removed-v2-1032x1376.png | removed-v2-1376x1032.png |
| 終了 | ended-v2-744x1133.png | ended-v2-1133x744.png | ended-v2-1032x1376.png | ended-v2-1376x1032.png |

`bounds.json` には16画面でのホーム/共有/状態の矩形とtoolbar高さを記録。縦のホーム `(58,6,65.83,44)`、共有 `(249.81,6,63,44)`。横のホーム `(70,17.5,65.83,30)`、共有 `(269.81,17.5,63,30)`。すべてviewport内。状態も既存toolbarの内側（縦56px、横66px）。E2Eで共有前後の上部高さが同じことを確認。home-v2は読み込み完了と重複なしを待って撮影。20枚とboundsをレビュー修正後に上書き。個人情報は試験用架空値。

## Claudeへの確認と8bへの申し送り

8bは [COLLABORATION_AUDIO.md](./COLLABORATION_AUDIO.md) に実装・判断・検証・画像を記録。音源操作の分離、バックアップ範囲表示、V2旧UI入口の非表示、状態文言の切れ対策を実装した。以下は8a-2時点の申し送り。

- Linux：push後、Postgres 17 の `test-cloud-sql.mjs` と Edge/負荷CIを確認。anon・ゲスト・通常・作成者・外された人・部外者の実ロール、安定ページング、題名/seqの原子更新、重複の題名維持、旧ACLの維持を追加済み。WindowsではSQLの実行を行っていない。
- macOS：`ios/ProjectRepositoryCore` の `swift test`。現在45件。新しい2件は通常保存時だけのsummary生成/旧summaryとバックアップの互換性、破損共有attachmentがopen/list/別文書/個別復旧を妨げず再openでも原本・summary・receiptが不変であること。変数の重複、typed辞書、throwing callをXCTUnwrapの外へ出すこと、raw helperのforeign_keys=ON、/var系の比較追加なし、共通fixture不変を自己レビュー済み。コンパイル・iPad実機Keychain・共有シートは未確認。
- 公開ゲスト参加は有効化していない。モック成功だけで公開条件を満たさない。第11回の旧API停止後に本番の匿名認証/保護を確認する。
- 利用者の追加移行操作は不要。未公開の共有summaryには起動時補完を行わず、通常保存で生成。iPadの参加画面を再起動した場合はリンクの再貼り付けが必要。
- 合意からの機能省略なし。badgeは人数を端末に複製する方式ではなく軽量一覧との組み合わせを採用。ブラウザー回帰は独立Viteへ向けた。
- 8b：共通曲descriptorと端末音源の対応付けの分離、ZIP/バックアップ統合、旧クラウドUIの撤去は未着手。Project/ZIP形式、音源本体、PrintPreview、distは変更していない。

## 変更ファイル

- サーバー：`supabase/migrations/20261004000000_collab_v2_foundation.sql`、`supabase/functions/collab-ingest/{handler.ts,handler.test.ts}`。
- lifecycle/状態：`src/collaboration/{lifecycle.ts,managementTransport.ts,serverValidation.ts,account.ts,sharedSessionController.ts,uiService.ts,uiTypes.ts}`、`src/collaboration/testing/providerHarness.ts`、`src/storage/{sharedSessionState.ts,invitationMemory.ts}`。
- UI接続：`src/App.tsx`、`src/main.tsx`、`src/components/{CollaborationSurface.tsx,collaboration.css,FormationLibrary.tsx,ShareExportModal.tsx,Toolbar.tsx}`、`src/hooks/{useCollaborationUi.ts,useSharedSession.ts}`、`src/config/{publicLinks.ts,collaborationLinks.ts}`、`src/cloud/{account.ts,api.ts}`。
- summary：`src/project/codec.ts`、`src/repositories/{types.ts,sharingSummary.ts,indexedDbFormat.ts,indexedDbFormat.test.ts,indexedDbRepository.ts,nativeSqliteRepository.ts}`、`src/repositories/contract/testing/{MemoryProjectRepository.ts,indexedDbBrowserSuite.ts}`、Swift `ProjectRepository.swift` / `CollaborationTests.swift`。
- 試験：`scripts/{check-collab-v2.mjs,check-native-repository.mjs,collaboration-lifecycle.test.ts,collaboration-provider.test.ts,test-cloud-sql.mjs,test-indexeddb-browser.mjs,test-shared-session-app-browser.mjs,test-collaboration-ui-browser.mjs,test-local-regression-browser.mjs}`、`scripts/testing/mock-collab-server.mjs`。
- 引継ぎ：この文書と `docs/COLLABORATION_SESSION.md`。
