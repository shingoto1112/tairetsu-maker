# 第8回-1: 文書 session の統合

`VITE_COLLABORATION_V2=1` のビルドだけ V2 を有効にする。既定 OFF。
ON では旧共同編集・本人クラウド入口、ログイン/Keychain 復元後の旧一覧取得、旧 API を遮断する。
認証、旧コード、旧 draft、移行は残す。共有 attachment は環境フラグと別物であり、
OFF に戻しても保持し、旧方式には降格しない。未配備/非互換 API の失敗でも旧方式へ戻らない。
`Project`、ZIP、内部座標、印刷、SQL/Edge、Swift は変更していない。

## 所有と終了

- `useSharedSession`: 安定した薄い host。動的 import した controller と閉じた文書の背景送信を所有。
- `SharedSessionController`: 文書専用 coordinator/editor/provider。開き直しでは再生成する。
- 開いた V2 attachment では `activeCloudProject` は null。通常/旧クラウド保存とは別 coordinator。
- 終了は batch 終了 → pending staging → 端末 flush。失敗なら editor と未保存の編集を保持する。
- 成功後、オンラインで pending があれば送信 lane だけ最長30秒、0件/失敗/切断/資格変更まで動かす。
  UI は端末保存まで待ち、ネットワークの完了は待たない。その後 provider 停止 → editor 破棄。
- 同じ文書を開く前に背景 owner を停止し、記録を読み直す。他の文書には coordinator を使い回さない。
- document/load generation は host と foreground callback、資格 epoch と account/membership は provider/transport が検査。
- 起動時の全件送信や常時の全件背景同期は実装しない。負荷・所有関係・GC 保護の追加が必要。

## 認証と送信

`src/cloud/session.ts` が認証資格、refresh single-flight、復元中状態、資格 epoch を所有。
participantAuth は同じサービスを使う。ゲスト mirror は補助復元であり refresh の所有者にはしない。
Keychain 書込/削除は JS で直列化し、`waitCloudAuthPersistence()` で完了/失敗を待つ。
ログアウトは通信/refresh より先に共通資格と guest mirror を消し、古い refresh/復元応答を拒否する。
資格変更/ログアウトでは旧資格の送受信を即停止し、その後にローカル batch/staging/flush を行う。
通常の文書終了順序に対する、安全性のための例外である。
Swift の変更は不要。Keychain 実機の確認は別途必要。

`SaveCoordinator.subscribeCommits` の `pendingUpdateIds` は新しく永続化された pending だけ。
controller はこれをまとめて send lane を wake。ACK/cursor/ローカル表示設定では送信を wake しない。
起動、online、ブラウザー前面復帰、iPad appStateChange の前面復帰でも wake する。
provider の状態だけでは Project/Canvas を更新しない。CRDT が変わらない ACK も投影を再描画しない。

## 8a-2 が使う入口

8a-2 の実装・検証・変更ファイル・画像・Linux/macOS確認事項は [COLLABORATION_UI.md](./COLLABORATION_UI.md) に記録。以下は8a-1時点の入口と申し送り。

- `sharedSession.store.subscribe/getSnapshot`: Project と別に購読。試験では DEV の `window.__sharedSession` から読める。
  `sharing`、`sync`、`pending`、`label`、`error`、`history` を公開。
  初期は「接続を確認中」。端末未保存、pull 未成功/失敗、資格未確認、held は「同期済み」にしない。
- `active.prepareIndependentCopy()`: removed/ended/保存失敗時にも live 未送信編集を含む独立コピー要求を作る。
  呼出側で Repository に commit。原本 attachment/outbox は残す。ボタンは未実装。
- Undo/Redo の partial/blocked を `historyResult` で store に渡す。表示は未実装。
- ホームの共有改名は「開いてから変更」に誘導。別の editor を裏で作らない。

## 音源と申し送り

共有 `settings.song` の name/type/size/duration と端末 `audio` を照合し、違えば音源を止め、日本語で選び直しを案内する。
現在の選択経路は `App.loadAudio → updateProject → editor.edit → planRecipe/settingsFields → settings.song`。
8a-1 はこの変更に確認を出す。8b は共通曲の変更と端末音源の対応付けを別操作にする。
metadata 照合であり、音源のバイナリ同一性を証明するハッシュではない。

8a-2: 状態/救出の画面、V2 一覧、Edge の検証済み題名、招待を消費しない openExisting、軽量共有バッジ。
V2 のアカウント削除経路も確認すること。現在 App の旧クライアント遮断は共通の削除 RPC も遮断する。
既存 `createCollaborationAccountApi` と共通 RPC の位置付けを整理して接続する。削除を実行する検証は今回行っていない。
8b: 音源 descriptor と端末対応付け。公開ゲスト入口は旧 API 停止後。
公開前に実 Supabase と実 iPad の確認が必要。モック成功は公開条件を満たさない。

試験: `node scripts/test-shared-session-app-browser.mjs`。
独立 Vite を V2 ON/環境ファイル読込なしで起動し、2つの隔離ブラウザーとローカルモックだけを使用する。
DEV のモック接続は loopback HTTP のみ。本番では試験用設定/host を出さない。

## 実施結果（Windows / HEAD 6835c99）

| 確認 | 結果 |
| --- | --- |
| `npm test -- --maxWorkers 2` | 最終ソースで 86 files / 720 tests、2回 PASS |
| `npm run typecheck` / `git diff --check` | PASS |
| Vite build / `check-collaboration-bundle` | 一時出力を削除。main 466,239 B、gzip 138,540 B。静的起動 graph に Yjs/runtime なし |
| `test-shared-session-app-browser` | 最終ソースで2回 PASS。2ブラウザー即時同期、オフライン再起動、背景 ACK、遅延応答、removed/ended、救出、Undo、音源、iPad4寸法、実ログイン。旧 API 呼出0 |
| `test-collaboration-provider-browser` | PASS。以前の待ち条件が古い pending=0 を収束と誤認したため、durable outbox/cursor の照合を追加 |
| `test-collaboration-app-browser` / `test-collaboration-lifecycle-browser` | PASS |
| `npm run test:repository:browser` / `test-app-storage-browser` | PASS。旧データ、ZIP、保存失敗保持、音源、GC、復旧を含む |
| `test-build22-browser` | 同じアサーションを独立 Vite（環境ファイルなし）へ向けて全体 PASS。stage/parade各12寸法、タッチ、長いルート、名簿 |
| `check-collab-v2` / `check-native-repository` | PASS。Swift 実行/コンパイルの代替ではない |

build22 は編集と並行していた既存開発サーバーで2回中断した。
その後、読み取り専用 HEAD サーバーで parade を比較し、固定ソースの独立サーバーで現在版の全体を確認した。
テスト中のソース編集/開発サーバー再読み込みを避ける。一時比較スクリプトは削除済み。
依存追加、commit/push、workflow、本番接続なし。元の `.tmp-vite-https.config.mjs` は未変更。

変更ファイル（20件）:

- session: `src/hooks/useSharedSession.ts`, `src/collaboration/sharedSessionController.ts`, `src/storage/sharedSessionState.ts`
- 接続/表示: `src/App.tsx`, `src/components/FormationLibrary.tsx`, `src/collaboration/editorSession.ts`
- 認証/方式: `src/cloud/session.ts`, `src/collaboration/guestAuth.ts`, `src/platform/runtime.ts`
- 保存/送受信: `src/storage/saveCoordinator.ts`, `src/collaboration/provider.ts`
- 単体試験: `src/cloud/session.test.ts`, `src/collaboration/sharedSessionController.test.ts`, `src/storage/sharedSessionState.test.ts`, `src/platform/runtime.test.ts`
- ブラウザー/チェック: `scripts/test-shared-session-app-browser.mjs`, `scripts/test-collaboration-provider-browser.mjs`, `scripts/testing/mock-collab-server.mjs`, `scripts/check-collaboration-bundle.mjs`
- 引継ぎ: `docs/COLLABORATION_SESSION.md`
