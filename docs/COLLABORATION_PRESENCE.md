# 共同編集 第10回: 10-local

配信経路未選択のため、本番向けの一時通信は開始しない。SQL、RLS、RPC、Edge、Swift、Project 型、ZIP 形式、PrintPreview の内容は変更していない。

## 所有と接続

- `SharedSessionController.ephemeral` が文書単位で所有する。V2 OFF では作成も購読も送信もしない。
- `EphemeralTransport` を注入できる。実装には、認証済み送信者の envelope、メンバー表、資格変更通知、送信予算の取得、送信・購読停止が必要。
- DEV の明示的な `__sharedSessionMock` のときだけ、127.0.0.1 の HTTP/SSE モックを動的に読み込む。テストの actor は匿名の仮識別子で、本番の認証方式ではない。
- App は安定した session 参照、シーン／選択の通知、lazy 表示だけを接続する。旧クラウドの `canvasSnapshot` 合成へ一時情報は渡さない。
- close は保存を待つ前に一時 session を停止する。保存失敗時も編集・確定送信のデータは残す。dispose、認証 epoch の変化、参加資格変更も一時通信を停止する。

## プロトコル v1

UTF-8 JSON。すべてに `v:1, sessionId, seq`。seq は送信 session 単位の単調増加整数。payload に actor、表示名、自由文、任意属性を許可しない。`EphemeralEnvelope.actorId` は transport の認証済み情報、名前と色は transport のメンバー表を使用する。

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

初期 B（予算確認）→ 有効なサーバー許可を取得しオンラインなら A（上限 3Hz）。予算未取得／取得失敗／期限切れ／許可なしでは送信しない。確定編集はこの判定に依存しない。

正常な送信経路で preview 到達 p95 > 500ms（20 サンプル以上）、ローカル処理 p95 > 通常処理の 110%（20 サンプル以上）、または送信失敗が連続すると 3→2→1Hz→B。悪化判定の段階変更は最短 2 秒間隔。B では drag を送受信表示せず、小さい参加・選択更新のみ最大 1Hz（予算許可がある場合）。切断からの復帰も B で待つ。

45 秒安定してから A を 1Hz で再開し、各 45 秒の安定期間で 2、3Hz へ戻す。古い性能サンプルは 30 秒で判定から外す。月間枠による停止は最低 5 分保持し、その後も有効なサーバー許可が必須。開始情報／move の上限超過は B。予算値は 15 秒おきに更新するが、許可の expiresAt は常に守る。

描画 rAF p95 > 8ms では受信レイヤーを最大 10fps に間引く。送信頻度を下げる判断とは分離する。ローカル Canvas の同期処理と通知の所要時間、payload bytes、送信数、rAF 時間を bounded な測定配列で保持する。ローカル同期処理の比較は同じ操作内で通知前後を測る補助計測であり、実機の指追従遅延や総合的な負荷比較の代用にはしない。

クライアントの 3Hz と bytes の測定だけでは、改変クライアントの月間消費を強制制限できない。transport の `budget()` はサーバー発行の有効期限付き許可を返し、実 transport 側も送信を拒否する必要がある。本番では認証 epoch、文書世代、参加世代、ACL 世代と許可を結び付ける。10-local の HTTP モックはサーバー拒否と許可失効の試験用で、課金予算の実装ではない。

## 表示・性能・出力

参加アイコンは最大 3 人＋「+n」。同一 actor の複数 session はアイコンではまとめ、preview は別々に保持する。シーンの「見ています」は小さな外部 store を `useSyncExternalStore` で購読する。小窓右下の「● 人数」、ツールチップ、読み上げで伝え、小窓の高さを変えない。move はその store を更新せず、App／小窓 SVG を再描画しない。

`RemoteInteractionLayer` は操作を受け取らない色枠を既存 surface の子として重ねる。確定位置、Project、hit test、自分の DOM ドラッグは変えない。同じ対象への複数人の枠も保持する。Stage の観客／演者表示変換を適用し、Parade は既存ズーム・内部 y 軸・scroll に合わせる。巨大な bitmap や SVG は作らず、viewport の外には DOM 枠も作らない。

`data-ephemeral` を表示に付け、`exportImage.ts` は clone から除去し、直接 PNG 経路では html-to-image の filter で除外する。lazy CSS は印刷時も表示を隠す。PrintPreview は Project から独立して描画する既存方式のため変更不要。

## 配信経路の比較と未解決点

| 項目 | (d) 認証 RPC → server realtime.send | (a') 派生 topic へ直接 Broadcast |
|---|---|---|
| 解除後の新内容 | 解除 commit 後の旧 topic 送信をサーバーで防ぐ設計が可能 | ACL 通知後に残るメンバーが topic を切り替えるまで露出が残る |
| 保持 | realtime.messages の保持分が DB 容量を使う | 想定は DB 保持なし。選定時に実際の保持経路を再確認 |
| actor の信頼 | RPC の認証主体から envelope を作れる | 同じ topic 内の payload.actor は本人証明にならない |
| 予算強制 | RPC の原子的な受付／拒否で実装しやすい | チャンネルへの発行権限・予算許可失効をサービス側で強制できる設計が必要 |

(a') の残余露出は、解除直後の旧 topic のプレビュー（開始座標・対象 ID・累積差分・シーン／選択）であり、名前付きの確定 Project そのものは流さない。ただし配置や操作対象を推測できる情報なので「保存しないから漏れではない」とは扱わない。既存の相談の数秒〜最大 30 秒は設計目標で、実 transport の未検証の保証ではない。通知欠落／休止タブ／再接続でもこの上限を守るには短い期限の送信資格とサーバー側 fence が必要。

direct Broadcast は payload 内 actor を捨てるだけでは不十分。選定後は、SDK／サーバーが受信側へ認証済み publisher を証明できるか確認する。できない場合は、発行権限を本人に限定した actor 別 topic から actor を導く案、または検証可能な署名 envelope 等を追加する。メンバー表の表示名を引く際もこの証明が必要。共通 topic の自己申告 actor をそのまま信用する実装は採用しない。

公式の [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization) では、権限は接続／新しい JWT の時に計算され、各メッセージでは DB を問い合わせず、解除後も既存接続の受信資格が残ると説明されている。したがって RLS の予算行を更新するだけでは既存接続の毎回の予算強制や 30 秒以内の遮断を保証できない。これは (a') を選ぶ前に解決が必要な設計条件。[Broadcast](https://supabase.com/docs/guides/realtime/broadcast) ではクライアント送信と DB の `realtime.send` の保持経路が異なることを確認した（2026-10-05 参照）。

## 選定後の追加作業

1. (d)/(a') をユーザーが選択。許容する解除後露出、DB 保持、月間枠を明文化。
2. 認証済み publisher の証明とメンバー表更新、ACL／文書／参加世代 fence、資格失効、topic 切替・通知欠落・再接続を実装。
3. サーバーで予算発行・消費・受付拒否を強制し、受信数／参加人数を含めた月間消費を計算。
4. 現 interface の実 transport を追加し、Controller のモック限定接続を本番接続へ置き換える。
5. 実経路の到達 latency を時計ずれなく測る仕組みを追加。正常回線／不調回線／休止タブ、解除 commit と送信の競合、なりすまし、予算超過を統合試験。
6. iPad 実機で全体の指追従 p95 を V2 OFF と比較し、月間予算による停止・復帰を含めて公開判断。

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

未確認: 実 transport、解除競合・本人証明・月間枠のサーバー強制、実ネットワーク到達 p95、iPad／Safari 実機での指追従、macOS の Swift compilation。SQL/RLS/Edge の変更や本番接続はしていない。
