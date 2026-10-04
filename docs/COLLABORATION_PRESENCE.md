# 共同編集 第10回: 10-local / 10-transport

2026-10-05 のユーザー決定で、一時情報はクライアントから private topic へ直接 Broadcast する。高頻度の DB 配信は採用しない。未適用 foundation の RLS と ACL 通知を改訂した。Swift、Project 型、ZIP 形式、PrintPreview、Edge は変更していない。本番接続・適用は今回行わない。

## 所有と接続

- `SharedSessionController.ephemeral` が文書単位で所有する。V2 OFF では作成も購読も送信もしない。
- `EphemeralTransport` を注入できる。本番は `supabaseEphemeralTransport.ts`。`collab_v2_ephemeral_state` の一つの snapshot で topic・文書/ACL/参加世代・現在のメンバー表を取得する。通常30秒 poll、前面復帰、認証更新、接続失敗時の再試行で更新する。
- DEV の明示的な `__sharedSessionMock` のときだけ、127.0.0.1 の HTTP/SSE モックを動的に読み込む。テストの actor は匿名の仮識別子で、本番の認証方式ではない。
- App は安定した session 参照、シーン／選択の通知、lazy 表示だけを接続する。旧クラウドの `canvasSnapshot` 合成へ一時情報は渡さない。
- close は保存を待つ前に一時 session を停止する。保存失敗時も編集・確定送信のデータは残す。dispose、認証 epoch の変化、参加資格変更も一時通信を停止する。

## プロトコル v1

UTF-8 JSON。すべてに `v:1, sessionId, seq`。seq は送信 session 単位の単調増加整数。payload に actor、表示名、自由文、任意属性を許可しない。`EphemeralEnvelope.actorId` は本人だけが発行できる topic から導く。名前と色は RPC が返すメンバー表を使用する。色は userId からサーバーの固定パレットで決め、packet では指定できない。

本番の外側 envelope は `generation, aclGeneration, membershipGeneration, payload` の4項目のみ。payload は下表のJSON文字列。受信は発行 topic のメンバー・参加世代と現在の文書/ACL世代を照合し、未知の項目、世代違い、型・サイズ・有限数違反を破棄する。送信サイズは外側 envelope を含め start/presence 等16KiB、move 512B。受信は内側も同じ上限で検査する。

| type | 内容 | 制限 |
|---|---|---|
| presence | sceneId、selected `[kind,id][]` | 256 対象以内、16KiB 以内 |
| start | dragId、sceneId、mode、bounds、開始 targets、累積 dx/dy | 256 対象以内、16KiB 以内 |
| move | dragId、累積 dx/dy | 512B 以内 |
| stop | dragId、確定 updateId（変更ありの場合） | 保存成功との対応付け |
| cancel | dragId | すぐ消去 |

targets は member `["member",id,x,y]`、object `["object",id,x,y,width,height,rotation]`。146 UUID の一括移動を上限内に収めるためのタプル形式で、内部座標はそのままメートルを使う。回転・サイズ変更は送らず、選択表示のみの B の挙動になる。

start は約 1 秒間隔を目安に通信枠が空いたとき、新しい seq と現在の累積差分を付けて再送する。start、move、stop/cancel、presence/heartbeat は一つの最大 3Hz ゲートを共有し、ドラッグの move は最新値だけ保持する。終了通知の遅延／欠落時は preview TTL で消去する。start の再送は別枠の通信ではない。

受信は actor/session ごとの seq と actor/session/drag の終了記録で逆順、重複、終了後 move/start を無視する。start 欠落時の move は捨て、次の自己完結 start で復帰する。途中参加も同じ再送で復帰する。期限は受信側の時計を使い、payload の時刻を信用しない。

- preview: 最後の start/move から 3 秒。
- heartbeat: 15 秒。drag の自己完結 start も参加期限を更新する。
- 参加表示／終了記録: 45 秒。
- シーン切替、文書終了、資格変更、切断は受信表示を即消去する。対象／シーンの削除は現在の Project と照合して描画しない。
- 受信側も現在の Stage/Parade の寸法で対象ごとに clamp する。wire の bounds は開始条件の記録であり、境界を広げる権限にはしない。
- stop(updateId) は該当 preview だけ保存成功まで保留する。SaveCoordinator の成功 commit が通知する固定 snapshot の updateId と照合する。先に commit が届く場合も一時的な ID キャッシュで対応する。保存失敗では消去を保存成功扱いにせず、3 秒の失効で消える。

## 状態機械と予算

初期 B（接続・予算確認）→ オンラインで有効なクライアント予算があれば A（上限3Hz）。未取得／失敗／期限切れ／許可なしでは送信しない。確定編集はこの判定に依存しない。接続回復後の45秒安定待ちも維持する。

正常な送信経路で preview 到達 p95 > 500ms（20 サンプル以上）、ローカル処理 p95 > 通常処理の 110%（20 サンプル以上）、または送信失敗が連続すると 3→2→1Hz→B。悪化判定の段階変更は最短 2 秒間隔。B では drag を送受信表示せず、小さい参加・選択更新のみ最大 1Hz（予算許可がある場合）。切断からの復帰も B で待つ。

45 秒安定してから A を最大1Hzで再開し、各45秒の安定期間で2、3Hzへ戻す（常に予算以下）。古い性能サンプルは30秒で判定から外す。月間理由の停止は最低5分保持する共通interfaceを残すが、今回の実 transport は月間使用量を自動取得しない。開始情報／move の上限超過は B。予算値は15秒おきに更新し expiresAt を守る。配分が0.5Hz未満なら3秒の preview TTLに対して疎すぎるため B。

描画 rAF p95 > 8ms では受信レイヤーを最大 10fps に間引く。送信頻度を下げる判断とは分離する。ローカル Canvas の同期処理と通知の所要時間、payload bytes、送信数、rAF 時間を bounded な測定配列で保持する。ローカル同期処理の比較は同じ操作内で通知前後を測る補助計測であり、実機の指追従遅延や総合的な負荷比較の代用にはしない。

直接 Broadcast の `budget()` はクライアントの見積もり。サーバー発行の許可ではなく、改変クライアントの頻度・月間消費を強制できない。実 transport 自身も全packet共通の上限・bytes・接続状態を検査する。10-localのHTTPモックの予算拒否はinterface試験であり、本番のサーバー強制を意味しない。

## 表示・性能・出力

参加アイコンは最大 3 人＋「+n」。同一 actor の複数 session はアイコンではまとめ、preview は別々に保持する。シーンの「見ています」は小さな外部 store を `useSyncExternalStore` で購読する。小窓右下の「● 人数」、ツールチップ、読み上げで伝え、小窓の高さを変えない。move はその store を更新せず、App／小窓 SVG を再描画しない。

`RemoteInteractionLayer` は操作を受け取らない色枠を既存 surface の子として重ねる。確定位置、Project、hit test、自分の DOM ドラッグは変えない。同じ対象への複数人の枠も保持する。Stage の観客／演者表示変換を適用し、Parade は既存ズーム・内部 y 軸・scroll に合わせる。巨大な bitmap や SVG は作らず、viewport の外には DOM 枠も作らない。

`data-ephemeral` を表示に付け、`exportImage.ts` は clone から除去し、直接 PNG 経路では html-to-image の filter で除外する。lazy CSS は印刷時も表示を隠す。PrintPreview は Project から独立して描画する既存方式のため変更不要。

## 10-transport 採用決定と認可

採用 topic は `現在のprivate_topic + ':ephemeral:' + userId`。ランダムな確定通知topicの回転を共有し、参加世代変更も回転triggerの対象。topicのランダム性は認可の代用ではない。

- private helper `ephemeral_allowed` は現在topicへの完全一致、現在の発行者行、受信メンバー資格、未削除を検査。INSERTにはさらに `publisher.user_id = auth.uid()`。匿名sign-inゲストはauthenticatedの現在メンバーとして扱う。
- permissive SELECT/INSERTとrestrictive fenceに同じ限定条件を使う。旧broad policyがあっても確定通知へのclient INSERT、他人の発行topic、旧topic、未知suffix、probeとrowの不一致を拒否。prefixで例外を広く許可しない。realtime schemaに独自helper/tableは作らない。
- 1端末につき一時用最大9 channels（server-only制御1＋最大8人分）、確定providerは別1。複数端末でもactorなりすましをRLSで防ぐ。payloadを認証済みpublisher metadataと取り違えない。
- 一時用と確定用は別SDKクライアントなので通常2 WebSocket/端末。予算のNは一時配信の受信接続数、DashboardのConnected Clientsには確定用も含む。チャンネル数とWebSocket数も区別する。
- `acl_changed` は旧**確定通知topicだけ**へ `{}` を送る。追加、解除、退出、参加世代変更、文書世代変更、soft/physical deleteでtransaction commit後に通知。rollbackでは通知しない。全員が制御topicを購読するため旧派生topicへの通知は不要。書込可能topicから制御通知を受け付けない。
- 通知時は同期的に送信gateを閉じ、全channelsを閉じ、pending drag/endと相手表示を消す。その後資格・topic・メンバー表を取り直す。残るメンバーは新topicへ参加、外された人・参加世代違い・文書世代違いは停止。再接続後Aは既存の45秒安定待ちを通る。
- token更新は既存認証所有者から渡し `realtime.setAuth` 後に再参加。offlineでは送らず、未join/切断socketではSDKのREST fallbackへ進まない。一時情報にoutboxはなく再接続で古いdrag/endを再送しない。V2 OFFは作成・購読・送信なし。

**ユーザーが受け入れた解除後露出（2026-10-05）**：解除commit後、残るメンバーが通知/poll/復帰で新topicへ移るまで旧接続の外された人に開始座標・対象ID・累積差分・シーン/選択が届く可能性がある。数秒〜で厳密な30秒上限は保証しない。悪意の旧接続の強制停止も保証しない。一時情報はProject/Repository/Undo/ZIP/履歴へ保存されない。確定更新は従来のサーバー資格・世代検査を維持する。

[Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization) は接続/JWT更新時に認可をキャッシュし、各messageではDBへ問い合わせない。RLSでevent単位の認可・毎回の頻度制限はできない。[Broadcast](https://supabase.com/docs/guides/realtime/broadcast) のclient WebSocket経路を使い、高頻度previewのDB保持を避ける。低頻度のACL通知と既存確定通知にはtransactional `realtime.send` のDB内保持がある。

## 配信予算と運用

`src/config/collaborationLimits.ts` の `EPHEMERAL_BUDGET` が設定元。初期値：maxHz=3、messagesPerSecond=60、reservePerSecond=12、minimumConnections=8、maxConnections=32。観測actor/sessionは45秒で失効。人数と接続数は別で、複数tab/deviceも数える。未観測接続を完全には数えられないため最低8接続で保守的に計算する。

`各端末Hz = min(3, 設定maxHz, (60 - 12) / N²)`、`N = max(最低接続数, メンバー数, 観測remote session数 + 自分1)`。

各送信は送信1＋受信N-1件。N接続が同時に配分頻度で送る場合の目安48件/秒、余裕12件/秒。N=8で0.75Hz、N=16で0.1875HzのためB（参加表示だけ）。全packetは共通gateでtransport側にもgateがある。32を超えるsessionを検出したら一時送信を止める。受信漏れ・休止・複数文書・改変送信を含む**project全体60件/秒の保証ではない**。短いdrag反復・ACL通知・確定更新も使用量へ加える。

1. DashboardのProject Settings → Product Reports → RealtimeでConnected Clients、Broadcast Events、Rate of Channel Joins、Message Payload Size、Response Errorsを確認。[Realtime Reports](https://supabase.com/docs/guides/realtime/reports)。本実装のpresenceもBroadcast Eventsへ計数される。OrganizationのUsage → Realtime Messages / Peak Connections / Egressで月間累計・契約上限を確認。[メッセージ計数](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages)。画面名・契約上限は現行Dashboardを正とする。
2. 導入時に5/8接続＋複数tabで15分以上測定しdrag duty cycle・開始bytes・送信＋受信件数を記録。projectの他利用分も含め月末予測に余裕がなくなる前にBへ。クライアントmetricsは補助でDashboardの使用量を正とする。
3. `maxHz: 0.25` へ下げてリリースするとdragはB、参加表示だけ残る（最大0.25Hz）。月間予算超過の恐れがある場合は `enabled: false` で一時送信を全停止。確定編集は継続。`VITE_COLLABORATION_V2=0` は共同編集全体の停止なのでBの調整には使わない。
4. 設定はビルド時。稼働中の旧版へ即時強制できない。最新版の再読込/端末更新を依頼し旧接続と使用量の減少を確認。必要なら招待・運用を制限する。改変クライアントの抑制が必須なら別の受付経路を検討する。

## 本番適用後の確認（Claudeと利用者）

- 最新未適用foundationを適用し新RPCとpolicyを検査。anon/guest/通常/作成者/解除/部外者、他人topicへの発行、確定topicへの発行、旧topic再joinを実サービスで確認。
- 旧JWT・旧socketを意図的に残した解除試験：commit時刻、ACL通知受信、旧topic最終受信、新topic初回受信、UI消去を記録。通知欠落・offline・休止tab・JWT更新失敗・foreground復帰でも露出時間を実測。30秒保証として報告しない。
- 再参加で新membershipを使うこと、旧接続から新topicへ入れないことを確認。削除/退出/Auth cascadeの通知も確認。
- 人物別topicsのRLSを実Realtime probeで確認。SDKがpayloadに本人metadataを付ける仮定を置かない。匿名guestでも本人topicのみ送信可。
- 5/8接続、複数tab/device、同時drag、短いdrag反復でDashboard messages/egress/peak connectionsを実測。B/全停止設定の最新版で改善を確認。
- preview到達p95は未実測。ackはサーバー受付であり相手描画への到達ではない。時計ずれを避けた測定が必要。iPad/Safari/WKWebViewの前面復帰・JWT・指/Pencil追従も実機確認。

## ローカル検証

再実行: `npm test -- --maxWorkers 2`、`node scripts/test-collaboration-presence-browser.mjs`。
ブラウザー試験は V2 ON・5 個の独立した Chromium context、匿名 146 人、127.0.0.1 のみ。時刻を進める状態機械試験はモック session の時計に限定する。通常の通信測定と区別する。
指定スクリーンショットは `scratchpad/shots-10/` の Stage/Parade 各 13 寸法。JSON に送信数、payload bytes、fps、rAF p95、App／小窓 SVG の commit render 数、画像除外結果を保存する。実データ・個人名を使わない。

変更ファイル:

- session／接続: `src/collaboration/ephemeralSession.ts`, `ephemeralTransport.ts`, `testing/mockEphemeralTransport.ts`, `sharedSessionController.ts`, `editorSession.ts`。
- 表示／通知: `src/components/RemoteInteractionLayer.tsx`, `remoteInteraction.css`, `StageCanvas.tsx`, `ParadeCanvas.tsx`, `ResizableRotatableObject.tsx`, `SceneThumbnailRail.tsx`, `src/App.tsx`。
- 保存成功通知／出力除外: `src/storage/saveCoordinator.ts`, `src/utils/exportImage.ts`。保存成功イベントに updateId を加えるだけで、保存形式は変更しない。
- 試験／資料: `src/collaboration/ephemeralSession.test.ts`, `scripts/test-collaboration-presence-browser.mjs`, `scripts/testing/mock-ephemeral-relay.mjs`, `scripts/testing/mock-collab-server.mjs`, `scripts/check-collaboration-bundle.mjs`, 本文書。

最終測定結果と回帰結果は以下に記録する。

### 測定結果（Windows headless Chromium、匿名・loopback）

最終実装の追加ブラウザー試験は 2 回成功。`shots-10/results-run1.json` と `results.json` に記録。

| 項目 | 最終 2 回の結果 |
|---|---|
| preview 受信による App／小窓 SVG の commit render | いずれも 0／0 |
| 146 UUID の start／move 最大 | 9,731 B／149 B |
| 通信中の rAF | 約 60.00 fps、183／186 frames |
| 約 3.04／3.10 秒の送信数 | 5 session 合計で各 17。送信者ごとの間隔も検証 |
| 通常 Stage 受信描画 rAF p95 | 各 peer 0.4〜2.8ms／0.5〜2.4ms |
| Stage 実ドラッグ同期処理 p95／通知前基準 | 0.8／0.8ms、0.9／0.9ms |
| Parade 実ドラッグ同期処理 p95／通知前基準 | 0.2／0.1ms、0.1／0.1ms |
| 寸法切替を含む Parade 受信描画 rAF p95 | 25.3／23.9ms。描画側の 10fps 間引き条件に該当 |
| PNG の一時表示あり／非表示比較 | 1,078×538、両回とも画素差 0。clone も一時 node 0、JPEG 成功 |
| JS error／外部通信 | 両回とも 0／0 |

Parade の 0.1ms 付近はタイマーの分解能が支配し、1 回目の比率だけで実際の負荷が 2 倍になったとは断定できない。同期処理の補助測定であり、pointer の待ち時間や画面反映までの実機 p95 が通常比 10% 以内と保証した結果ではない。A/B の 10% 判定自体は合成サンプルで検証済みで、この粒度では安全側へ減速する場合がある。モックの `latencyMs=0` は設定値で、実配信経路の到達 p95 の測定ではない。

### チェック結果

- `npm test -- --maxWorkers 2`: 最終実装で 95 files／794 tests を 2 回確認（追加 session 試験 9 件を含む）。
- typecheck、`git diff --check`、`check-collab-v2`、`check-native-repository`: 成功。native は静的 preflight のみ。
- `check-collaboration-bundle`: envFile:false の一時 Vite ビルド／probe ビルド成功、一時出力削除。通常メイン JS **477,762 B**（gzip **142,197 B**）、475,353 B 比 **+2,409 B／0.51%**。一時 session／表示／CSS は通常起動の static graph 外、DEV モックも本番 chunk 外。既存 audioStorage の static/dynamic import 警告は残る。
- collaboration UI、shared-session、lifecycle、provider、app、device-audio、history の 7 系統、app-storage、help-page、repository browser、build22 browser: 成功。`regression-results.json` に一覧。開発中の HMR による device-audio の初回失敗は、コードを固定して全系統再実行し解消。
- build22: Stage／Parade 操作、12 iPad 寸法、500m Parade・最大 600%・146 人画像を確認。rAF 間隔 p95 最大 16.8ms。保存失敗後の編集保持と再保存も追加試験で確認。

### スクリーンショット一覧

保存先: `C:\Users\shing\AppData\Local\Temp\claude\c--Users-shing-OneDrive--------ChatGPT-------\e5aa9c38-eb07-490c-ac06-62f047c4c161\scratchpad\shots-10\`。

`stage-` と `parade-` 各 13 枚、下記寸法をファイル名として `.png` を付ける（計 26 枚）。

`744x1133`, `1133x744`, `810x1080`, `1080x810`, `820x1180`, `1180x820`, `834x1210`, `1210x834`, `1024x1366`, `1366x1024`, `1032x1376`, `1376x1032`, `390x844`。

全寸法でホーム／共有が画面内にあり hit test できること、参加アイコンがあること、「見ています」の印が小窓内に収まることを自動確認。Stage 縦向きと Parade 横向き／スマホ等も画像を目視確認。旧来のスマホ Parade の編集領域の狭さは、この一時レイヤー追加では変更していない。

10-local時点の記録。実transportは10-transportで追加。実Supabase、実ネットワーク到達p95、iPad/Safari実機、macOS Swift compilationは引き続き未確認。直接配信の月間枠はサーバー強制しない。

## 10-transport 最終ローカル確認（2026-10-05）

- 最終 `npm test -- --maxWorkers 2` を2回：各97 files / 811 tests成功。新規transport15件、SDK接続1件、providerのACL連携1件を含む。追加試験も最終コードで2回確認。
- typecheck、Vite一時build、check-collaboration-bundle、check-collab-v2、check-native-repository、git diff --check成功。buildはenvFile:false、専用一時出力を削除。main **477,762 B**（基準差0 B）、gzip **142,200 B**。共同編集・Yjs・一時UIは通常起動のstatic graph外。既存audioStorageのstatic/dynamic import警告は残る。
- collaboration ui / shared-session / lifecycle / provider / app / device-audio / history / presence、app-storage、help-page、repository browser成功。build22は初回の最大ズーム保存後再読込assertion失敗、単独再実行成功。製品コードやassertionを変更して通したものではない。
- presenceは既存HTTPモックの5 contexts / 146 UUID。App/小窓SVGのpreview commit renderは0/0、start最大9,731 B / move149 B（内側）、約60fps、PNG画素差0、Parade rAF p95 24.5msで既存描画間引き条件。実Supabaseの頻度・到達時間の証明ではない。画像/JSONは `output/playwright/10-transport-presence/`。
- `node --expose-gc scripts/bench-collab-v2.mjs` 成功。146人×18シーン、履歴0/128でvalidation p95約40.3/211.3ms、最大観測heap増約32.5/49.8MiB。合成Node測定であり hosted/Edge性能の保証ではない。
- 新SQL suiteは初回適用後と再適用後に計2回実行するLinux CIへ接続。WindowsではSQL実行していない。Claudeがpush後にPostgreSQL17の実ロール・rollback・Auth cascadeを確認する。
- commit/push/install/gh/workflow実行、本番接続、シークレット読取はなし。未追跡 `.tmp-vite-https.config.mjs` はそのまま。

10-transportの変更ファイル（19）：

- 実通信：`src/collaboration/supabaseEphemeralTransport.ts`。
- 連携：`src/collaboration/ephemeralTransport.ts`、`ephemeralSession.ts`、`supabaseTransport.ts`、`provider.ts`、`sharedSessionController.ts`。
- 設定：`src/config/collaborationLimits.ts`。
- SQL：`supabase/migrations/20261004000000_collab_v2_foundation.sql`、`supabase/tests/bootstrap.sql`。
- 試験/CI：`src/collaboration/supabaseEphemeralTransport.test.ts`、`supabaseEphemeralSdk.test.ts`、`scripts/collaboration-provider.test.ts`、`scripts/testing/ephemeral-sql-suite.mjs`、`scripts/test-cloud-sql.mjs`、`scripts/check-collab-v2.mjs`、`.github/workflows/supabase-sql-test.yml`。
- 文書：`docs/COLLABORATION_PRESENCE.md`、`COLLAB_V2_SERVER.md`、`COLLABORATION_LIFECYCLE.md`。

## 第11回への申し送り

旧クラウド取り込みと旧API停止は未実装。旧Projectを取り込む際は文書ごとの検証/救出を維持し、1件の不正データで一覧全体を開けなくしない。一時preview/旧topic/旧資格は保存形式や新文書へ取り込まない。旧outboxの別参加世代への自動採用も禁止。旧API/旧Realtimeの停止時は匿名アクセス・残留購読・既存permissive policyを棚卸しし、新しい限定fenceを維持する。現在は旧クラウドコード・既存APIの定義/ACLを変更していない。共通認証所有者と動的ロード境界を維持する。
