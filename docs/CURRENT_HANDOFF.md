# CURRENT_HANDOFF.md

このファイルは、長くなったCodexチャットから新しいチャットへ作業を引き継ぐためのメモです。
新しいチャットでは、まず `AGENTS.md`、`docs/SPEC.md`、このファイルを読んでから作業してください。

最終更新: 2026-05-14

## 現在のリポジトリ

- アプリ名: 隊列メーカー
- 技術構成: React + TypeScript + Vite
- Windows版: Tauri
- 作業フォルダ: `C:\Users\shing\Documents\Codex\2026-04-29\react-typescript-vite-web-stageflow-json`
- GitHub: `https://github.com/shingoto1112/tairetsu-maker`
- 公開URL: `https://tairetsu-maker.vercel.app`
- ローカル開発URL: `http://localhost:5173/`
- 現在ブランチ: `main`

## 新しいチャットで最初に読むファイル

必須:

1. `AGENTS.md`
2. `docs/SPEC.md`
3. `docs/CURRENT_HANDOFF.md`

必要に応じて確認:

- `docs/CHATGPT_PRO_REVIEW_BRIEF.md`
- `docs/RECREATE_FROM_ZIP_REPORT.md`
- `docs/UX_AUDIT.md`
- `docs/QA_REPORT.md`
- `docs/UI_REDESIGN_PROPOSAL.md`
- `docs/WINDOWS_APP_RELEASE.md`

## 重要な開発方針

- 既存機能を壊さない。
- `dist/` やビルド済みファイルは直接編集しない。
- 保存データ互換性を壊さない。
- ステージモードとパレードモードの処理を混同しない。
- UI文言は日本語。
- 共有リンク機能は使わない方針。
- ZIP / `.tairetsu` 書き出し・読み込みを基本にする。
- 大きな設計変更は、先に方針確認してから段階的に実装する。
- 変更後は最低限 `npm run build` を実行する。

## 現在の未コミット状態

このハンドオフ作成時点で、作業ツリーには未コミット変更があります。
新しいチャットでは、最初に必ず以下を実行してください。

```powershell
git status --short
git diff --stat
```

確認時点の差分:

```text
 M src/App.tsx
 M src/components/FormationLibrary.tsx
 M src/components/ParadeCanvas.tsx
 M src/components/StageCanvas.tsx
 M src/components/StageSettingsPanel.tsx
 M src/components/AssignmentPanel.tsx
 M src/components/ColorPaletteInput.tsx
 M src/components/GroupToolsPanel.tsx
 M src/components/MemberPanel.tsx
 M src/components/ObjectPanel.tsx
 M src/components/Toolbar.tsx
 M src/components/AudioPanel.tsx
 M src/components/DetailsPanel.tsx
 M src/components/SceneNotesPanel.tsx
 M src/components/Timeline.tsx
 M src/styles.css
?? .env.example
?? docs/CLOUD_COLLAB_SPEC.md
?? docs/CLOUD_COLLAB_SETUP.md
?? src/cloud/
?? src/components/CloudShareModal.tsx
?? src/vite-env.d.ts
?? supabase/
```

`git diff --stat` の概要:

```text
 docs/CURRENT_HANDOFF.md               | 106 ++--
 package-lock.json                     | 100 ++
 package.json                          |   1 +
 src/App.tsx                           | 2169 +++++++++++++++++++++++++++++++--
 src/components/AssignmentPanel.tsx    |  21 +-
 src/components/AudioPanel.tsx         |   7 +
 src/components/ColorPaletteInput.tsx  |   9 +-
 src/components/DetailsPanel.tsx       |  44 +-
 src/components/FormationLibrary.tsx   | 241 ++++
 src/components/GroupToolsPanel.tsx    |  65 ++-
 src/components/MemberPanel.tsx        | 106 +++-
 src/components/ObjectPanel.tsx        | 124 ++++-
 src/components/ParadeCanvas.tsx       |  37 +-
 src/components/SceneNotesPanel.tsx    |   9 +
 src/components/StageCanvas.tsx        |  47 +-
 src/components/StageSettingsPanel.tsx |  29 ++
 src/components/Timeline.tsx           |  68 ++-
 src/components/Toolbar.tsx            |  72 ++-
 src/styles.css                        | 343 ++++++
 19 files changed, 3400 insertions(+), 198 deletions(-)
```

注意:

- これらの変更は直近要望に関係している可能性があります。
- 勝手に戻さないでください。
- `docs/CLOUD_COLLAB_SPEC.md`、`src/cloud/`、`supabase/` はクラウド共同編集の新規追加です。
- `.env.example` と `src/vite-env.d.ts` は Supabase 設定用です。

## 最近の大きな流れ

最近の主な実装・調整:

- Web版をVercelへ公開済み。
- Windows版Tauriビルドを作成済み。
- アプリアイコンを新しい隊列メーカー用アイコンに変更済み。
- パレードモードを追加。
- パレードの横方向表示、縦m目盛り、5m/10mライン、スクロール、ズーム、書き出しを継続調整中。
- ステージ画像保存・印刷・PDF・PNG書き出しを継続調整中。
- メンバー/道具の名簿管理モーダルを追加中。
- 色選択UIを、ブラウザ標準カラーピッカーではなく、明るい色中心のパレットUIへ改善中。
- メンバーアイコン内の文字サイズ・配置を、1〜4文字で見やすい方向へ調整中。
- ステージ/パレードのピンチズーム、パン、ロック挙動を改善中。
- Supabase Free を前提にしたロック式共同編集の初期実装を進行中。

## 直近タスクの状況

ユーザーが承認した直近方針:

Supabase Free 想定で、完全リアルタイムではなく「シーン単位のロック式共同編集」にする。

最新状況:

- ロック式共同編集の初期実装はWeb版で実際に共同作業できるところまで完了。
- 本番URL: `https://tairetsu-maker.vercel.app`
- 最新Vercel deployment: `dpl_DpgNMtHb8nRzz6QxVnsMLybciaao`
- 最新検証用クラウドプロジェクトID: `68db9080-6fa2-4ee7-9032-f174482c7491`
- `npm run cloud:check` 成功。
- `npm run cloud:smoke` 成功。owner/editor/viewerで、招待受領、同一シーンロック拒否、viewerのscene lock拒否、別シーン同時ロック、scene保存、ロック解除を確認済み。
- 本番UIで owner/editor/viewer のロール表示を確認済み。
- 本番UIで、ownerが `Smoke 1` を編集中に editor が同じ `Smoke 1` を編集しようとすると閲覧のまま拒否されることを確認済み。
- 本番UIで、ownerが `Smoke 1` を編集中でも editor が別シーン `Smoke 2` を編集できることを確認済み。
- 本番UIで、editorが `Smoke 2` を保存すると owner 側に `更新があります: Smoke 2` と `更新を再読み込み` が表示されることを確認済み。
- `docs/CLOUD_COLLAB_COMPLETION_AUDIT.md` に完了監査を記録済み。

実装済み:

- `docs/CLOUD_COLLAB_SPEC.md` にクラウド共同編集の設計メモを追加。
- `supabase/migrations/20260514000000_cloud_collaboration_foundation.sql` に主要テーブル、RLS、RPC の土台を追加。
- `src/cloud/` に Supabase API/Auth/session/lock token/project parts のクライアント層を追加。
- ライブラリ画面にクラウドログイン、クラウド一覧、ローカルからクラウド作成、クラウドを直接開く、ローカルへ複製を追加。
- クラウドプロジェクトはローカル保存と明確に分離し、開いた直後は閲覧モード。
- 「このシーンを編集」で scene lock を取得し、30秒 heartbeat、編集終了、現在シーンのクラウド保存まで実装。
- `StageCanvas` / `ParadeCanvas` に read-only 状態を追加し、閲覧中は直接ドラッグ・編集操作を止める。
- ツールバーとステージ/パレード設定パネルもクラウド閲覧中は編集不可にした。
- `MemberPanel` / `ObjectPanel` / `AssignmentPanel` / `GroupToolsPanel` に権限 props を追加し、クラウド閲覧中やロック未取得時の編集ボタンを無効化。
- `ColorPaletteInput` に disabled を追加し、クラウドで編集不可の色変更入口も閉じられるようにした。
- `Timeline` / `DetailsPanel` / `SceneNotesPanel` / `AudioPanel` に権限 props を追加し、シーン追加・削除・並び替え・名称変更はクラウドでは不可、メモや座標などのシーン内編集はロック取得時のみ可能に整理。
- クラウドプロジェクトで音源を読み込んだ場合は、この端末での再生用として扱い、クラウド側の音源情報は更新しないようにした。
- owner 向けに `project:settings` のロック取得、30秒 heartbeat、解除、`save_project_resource_with_lock` による保存をフロントから既存RPCへ接続。
- `project:settings` ロック中だけステージ/パレード設定パネルを編集可能にし、scene lock とはフロント/DB両方で排他にした。
- `supabase/migrations/20260514001000_cloud_collaboration_sharing_realtime.sql` を追加し、招待テーブル、招待作成/受取、権限変更、参加者削除、招待取り消し、Realtime publication 追加を実装。
- `@supabase/supabase-js` を追加し、`edit_locks` と `audit_logs` の Realtime 購読をフロントに接続。
- Realtimeクライアントは動的importにして、通常利用の初期バンドルから分離。Viteでは `realtime-*.js` の別チャンクとして出力される。
- owner向けの「共有管理」モーダルを追加し、招待リンク作成、参加者権限変更、参加者削除、招待取り消しを実装。
- ライブラリ画面に招待リンク/招待コード入力を追加し、招待されたユーザーがログイン後にクラウドプロジェクトへ参加できるようにした。
- 他ユーザー保存時に「更新があります。再読み込み」ボタンを出し、自動再読み込みはしないようにした。
- 保存競合やロック喪失時は、対象シーンまたはproject resourceをJSON退避する処理を追加。
- `docs/CLOUD_COLLAB_SETUP.md` にSupabase/Vercel設定手順を追加。

検証済み:

- `npm run build` 成功。project:settings ロック接続後も成功。
- 共有/Realtime接続追加後も `npm run build` 成功。
- `npx vercel build` 成功。ただしVercel環境変数は未設定。
- Realtime動的import後も `npm run build` / `npx vercel build` 成功。
- `git diff --check` は空白エラーなし。CRLF警告のみ。
- `npm audit --omit=dev` は production dependency 0 vulnerabilities。
- `http://127.0.0.1:5173` のローカル表示確認成功。
- Chrome headless でページタイトル `隊列メーカー`、クラウドパネル表示、コンソールエラーなしを確認。
- `node --check scripts/cloud-collab-check.mjs` / `node --check scripts/cloud-collab-smoke.mjs` 成功。
- `npm run cloud:check` は `.env` 未設定のため、想定通り `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` 不足で停止。
- `node --check scripts/cloud-collab-sql.mjs` 成功。
- `node --check scripts/cloud-collab-vercel-env.mjs` 成功。
- `npm run --silent cloud:sql` は、2 migration を順番通りに連結して出力することを確認済み。
- `npm run cloud:vercel-env` は `.env` 未設定のため、想定通り `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` 不足で停止。
- チェック導線追加後も `npm run build` 成功。

次に進める候補:

- owner 専用の project 系ロックを `members` / `objects` / `audio` / `sceneOrder` に段階的に広げる。特に `members` / `objects` は既存UIがシーンデータも同時に触るため、保存単位の設計に注意する。
- 実 Supabase 環境変数を入れた状態で、ログイン・クラウド作成・ロック取得・保存を実機確認する。
- Supabase SQL migration を実プロジェクトに適用し、Vercel に `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` を設定する。
- `npx vercel env ls` では `tairetsu-maker` に環境変数が無い状態だったため、Web版で共同編集を有効にするにはVercel env追加が必要。
- Supabase導入補助として `npm run cloud:check` を追加。`.env` の URL/anon key と SQL migration 適用状態をログインなしで確認できる。
- `npm run cloud:smoke` を追加。owner/editor の2アカウント情報を環境変数で渡すと、招待、同一シーンロック拒否、別シーン同時ロック、保存、解除のRPC経路を確認できる。任意で viewer 情報も渡すと viewer のscene lock拒否も確認する。
- `npm run --silent cloud:sql | clip.exe` を追加。Supabase SQL Editor に貼るSQLを2 migration 分まとめてコピーできる。
- `npm run cloud:vercel-env` を追加。`.env` の `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` を Vercel Production に反映できる。値はコマンド引数ではなくstdinで渡す。Preview/Developmentは `CLOUD_VERCEL_ENVIRONMENTS` で明示指定。
- `docs/CLOUD_COLLAB_SETUP.md` に、初回ログイン、GitHubリポジトリ選択スキップ、New project、Project URL/anon public key取得までの手順を追記。
- Supabaseの新UIに合わせ、`anon public key` だけでなく `publishable key` 表記でも迷わないように手順とエラー文言を更新。
- ローカル `.env` は `.gitignore` で除外されていることを確認済み。`VITE_SUPABASE_URL=https://jhpvdrdunyicrzptgtom.supabase.co` とユーザー提供の publishable key を入力済み。
- `npm run cloud:check` は Supabase へ到達したが、`public.projects` が無く `PGRST205` で停止。SQL migration はまだ実プロジェクトに未適用。
- `npm run --silent cloud:sql | clip.exe` で、Supabase SQL Editor に貼るSQLをクリップボードへコピー済み。
- fetch後のスクリプト失敗時にNodeが荒く終了しないよう、`cloud-collab-check.mjs` / `cloud-collab-smoke.mjs` のcatchを `process.exitCode = 1` に変更。変更後も `node --check` / `npm run build` 成功。
- `npx vercel env ls` で Production の `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` が入っていることを確認済み。Previewはブランチ指定が必要になったため、標準補助コマンドはProductionのみへ変更。
- ユーザーが Supabase SQL Editor で migration を実行し、`Success. No rows returned` を確認。
- migration適用後の `npm run cloud:check` 成功。`projects` table と `create_cloud_project` / `acquire_edit_lock` / `create_project_invite` / `accept_project_invite` RPC が到達可能で、未ログイン時に `not_authenticated` を返すことを確認。
- `npm run cloud:smoke` は owner/editor 環境変数未設定のため想定通り停止。次は Supabase Auth で owner/editor、可能なら viewer の一時アカウントを作成して実行する。
- ローカルViteを `.env` 反映後に再起動済み。Playwright CLIで `http://127.0.0.1:5173/` を確認し、クラウド欄がログイン/新規登録フォームになっていること、`Supabase接続が未設定です` が出ないこと、console error 0件を確認。
- Vercel Production環境変数反映後に `npx vercel build --prod` 成功。`.vercel/output` 作成済み。
- owner/editor/viewer のテストユーザー作成済み。
- 初回 `npm run cloud:smoke` で `create_cloud_project` RPC 内の `project_id` 曖昧参照が発覚。migration SQLを修正済みで、`npm run --silent cloud:sql | clip.exe` により更新済みSQLをクリップボードへコピー済み。Supabase SQL Editor で再実行が必要。
- 修正内容: `create_cloud_project` の required resource exists、heartbeat/save/update系、共有管理RPCの一部でテーブルaliasを明示し、PL/pgSQLの返却カラム名との衝突を避けた。
- 再実行後の `npm run cloud:smoke` で `create_cloud_project` は成功。次に `digest(text, unknown) does not exist` が発覚したため、`cloud_collab_token_hash` を `extensions.digest(convert_to(...), 'sha256')` へ修正し、`create extension if not exists pgcrypto with schema extensions` に変更。更新済みSQLを再度クリップボードへコピー済み。
- digest修正SQLをSupabaseへ再適用後、`npm run cloud:smoke` 成功。owner/editor/viewerで、招待受領、同一シーンロック拒否、viewerのscene lock拒否、別シーン同時ロック、scene保存、ロック解除を確認済み。最新検証プロジェクトID: `68db9080-6fa2-4ee7-9032-f174482c7491`。
- `src/cloud/api.ts` のクラウド一覧で、他ユーザーの `project_members.role` を拾って自分のロール表示が上書きされる問題を修正済み。現在はaccess tokenの `sub` を使い、自分の `project_members` のみ取得する。
- Vercel Productionへ反映済み。production deploy `dpl_DpgNMtHb8nRzz6QxVnsMLybciaao` を `https://tairetsu-maker.vercel.app` にalias済み。
- 本番UIで `https://tairetsu-maker.vercel.app` の表示、クラウドログインUI、console error 0件を確認済み。
- 本番UIで owner/editor/viewer のロール表示、同一シーンロック拒否、別シーン同時編集、保存通知表示まで確認済み。

## 2026-05-14 追記: owner向け project 系操作拡張

今回の追加目標:

- owner のみが、クラウド上でメンバー名簿、道具マスター、音源メタ情報、シーン追加/削除/並び替え/名称変更、JSON / `.tairetsu` / ZIP import によるクラウド上書きを実行できるようにする。
- editor は引き続き `scene:{sceneId}` の scenes.data のみ編集可能。
- viewer は閲覧のみ。
- project 系ロックは scene lock と排他にし、Realtime はロック状態と保存通知メタ情報のみ同期する。

実装済み:

- `supabase/migrations/20260514002000_cloud_project_owner_operations.sql` を追加。
  - `save_scene_order_with_lock`
  - `import_cloud_project_with_lock`
- `npm run --silent cloud:sql` は3本の migration を順番に出力する。
- `npm run cloud:check` は新RPC2本も確認する。
- `npm run cloud:smoke` は owner/editor/viewer に加え、以下を確認するよう拡張。
  - scene lock 中の project lock 拒否
  - project lock 中の scene lock 拒否
  - editor の project lock 拒否
  - owner による `project:members` / `project:objects` / `project:audio` 保存
  - owner による `project:sceneOrder` のシーン追加/削除
  - owner による `project:import` のクラウド上書き
- フロントに owner 専用の導線を追加。
  - 全体設定
  - メンバー名簿
  - 道具マスター
  - 音源設定
  - シーン構成
  - クラウド上書き
- メンバー名簿/道具マスターの project lock 中は、マスターのみ保存対象にし、各シーン内の配置/表示状態は同時変更しないよう境界を整理。
- 音源はクラウドにファイル本体を保存せず、メタ情報のみ保存対象にした。
- シーン構成の保存は `sceneOrder` resource と `scenes` table をRPC内で整合更新する。
- シーン削除と import は snapshots に操作前バックアップを残す。
- editor/viewer には project 系編集ボタンを表示しない。
- 他ユーザーの project lock 中は「メンバー名簿の編集中です。シーンは閲覧のみです。」のように、シーン編集不可の理由を表示する。

検証済み:

- `npm run typecheck` 成功。
- `npm run build` 成功。
- `npm run cloud:check` 成功。
- `npm run cloud:smoke` 成功。
  - 最新RPC smoke project ID: `d0872735-1ae2-4650-bf2e-b29f183d1aff`
- ローカルUI `http://127.0.0.1:5173/?qa=project-ops` で確認。
  - owner で project 系ボタンが表示される。
  - owner が `メンバー名簿` ロックを取得すると管理モーダルが開き、道具管理タブは無効化される。
  - owner が `シーン構成` ロックを取得し、シーン名変更を `クラウド保存` できる。
  - editor では project 系ボタンが表示されない。
  - owner が `メンバー名簿` ロック中、editor の「このシーンを編集」は拒否され、閲覧のみ表示になる。

Supabase実環境:

- ユーザーが SQL Editor で3本目の migration を含むSQLを実行済み。
- `save_scene_order_with_lock` / `import_cloud_project_with_lock` は `cloud:check` で到達確認済み。

残タスク:

- Git commit `b355b87` (`Extend cloud owner project operations`) を `main` にpush済み。
- Vercel Production へ反映済み。
  - deployment: `dpl_2ccD1j4ytfxtZHr6mdTLffcc6UMj`
  - production URL: `https://tairetsu-maker.vercel.app`
- production URL でクラウドログインUI、ownerのクラウドプロジェクト一覧、project系ボタン一式、console error/warning 0件を確認済み。

## 新しいチャットでの具体的な手順

1. Codexで新しいチャットを開く。
2. 同じ作業フォルダを開く。
   - `C:\Users\shing\Documents\Codex\2026-04-29\react-typescript-vite-web-stageflow-json`
3. 最初のメッセージとして、下の「新チャット開始プロンプト」を貼る。
4. Codexに以下を確認させる。
   - `AGENTS.md`
   - `docs/SPEC.md`
   - `docs/CURRENT_HANDOFF.md`
   - `git status --short`
   - `git diff --stat`
5. 直近タスクの実装を続ける。
6. 実装後に `npm run build` を実行する。
7. 必要ならWeb版へ反映するため、GitHubへpushする。

## 新チャット開始プロンプト

新しいチャットに以下をそのまま貼ってください。

```text
このリポジトリは隊列メーカーです。
まず AGENTS.md、docs/SPEC.md、docs/CURRENT_HANDOFF.md を読んでください。

前のチャットがコンテキスト上限に近いため、このファイルから引き継いで作業してください。
最初に git status --short と git diff --stat を確認し、未コミット変更を壊さずに進めてください。

直近の未完了タスクは、Supabase Free 想定のシーン単位ロック式共同編集です。
docs/CURRENT_HANDOFF.md の「直近の未完了タスク」に沿って進めてください。

既存機能、保存互換性、ステージモード/パレードモードの分岐、ローカル保存との分離を壊さず、実装後は npm run build を実行してください。
```

## ローカル開発サーバーを開く手順

新しいチャットで動作確認したい場合:

```powershell
npm run dev
```

表示されたURL、通常は以下をブラウザで開く。

```text
http://localhost:5173/
```

既に別プロセスが動いていてポートが変わる場合は、Viteの表示に従ってください。

## Web版へ反映する手順

変更をGitHub/Vercelへ反映する場合:

```powershell
npm run build
git status --short
git add .
git commit -m "実装内容が分かる日本語または英語メッセージ"
git push
```

push後、Vercelが自動デプロイします。

公開URL:

```text
https://tairetsu-maker.vercel.app
```

## 注意すべき未解決・継続論点

- 右側道具割当付き書き出しは、まだ設計方針が決まった段階で、実装途中または未実装の可能性があります。
- 名簿管理モーダル `RosterManagementModal.tsx` は未追跡なので、新チャットで内容確認が必要です。
- 印刷・スクリーンショット・PDF周りは変更影響が大きいので、既存のステージ/パレード出力を壊さないように注意してください。
- パレードモードの画像保存は、最前/最後尾から前後3mを含む範囲で出す方針です。
- 共有リンク機能は使わない方針です。復活させないでください。
- JSON単体バックアップは優先度低めです。ZIP書き出しを基本にしてください。

## このチャットを続けるか、新しいチャットにするか

このチャットでも作業は続けられますが、履歴がかなり長くなっているため、反応が重くなったり、古い文脈が混ざるリスクがあります。

おすすめは、新しいチャットに移り、このファイルを読ませてから続行することです。
Codex側から自動で新しいチャットを作成して送信することはできないため、ユーザー側で新しいチャットを開いて、上の開始プロンプトを貼ってください。
