# クラウド共同編集 completion audit

最終更新: 2026-05-14

## Objective

Supabase Free 前提のロック式共同編集を、Web版で実際に複数ユーザーが共同作業できる状態まで実装・検証・反映する。

## Success criteria

- 複数ユーザーが同じクラウドプロジェクトを開ける。
- `owner` / `editor` / `viewer` 権限が機能する。
- `editor` は `scene:{sceneId}` のみ編集できる。
- `viewer` は閲覧のみ。
- シーンを開いただけではロックしない。
- 「このシーンを編集」で `scene:{sceneId}` lock を取得する。
- 同じシーンの同時編集は拒否される。
- 別シーンは同時編集できる。
- `project:*` lock は owner のみで、scene lock と排他。
- Realtime は lock 状態と保存通知メタ情報のみ同期する。
- 他ユーザー保存時、自動再読み込みせず「更新があります。再読み込み」を出す。
- 保存競合/ロック喪失時、対象単位を JSON 退避できる。
- lockToken は `sessionStorage` のみ。DBには hash のみ。
- service_role key はフロントに置かない。
- Supabase実環境とVercel Web版で共同編集を実測確認する。

## Prompt-to-artifact checklist

| Requirement | Evidence | Status |
| --- | --- | --- |
| 必須ファイル読了 | `AGENTS.md`, `docs/SPEC.md`, `docs/CURRENT_HANDOFF.md`, `docs/CLOUD_COLLAB_SPEC.md` を確認済み | Done |
| 作業前 status/diff | `git status --short`, `git diff --stat` 実行済み | Done |
| Supabase schema/RLS/RPC | `supabase/migrations/20260514000000_cloud_collaboration_foundation.sql` | Done locally |
| 招待/権限/Realtime SQL | `supabase/migrations/20260514001000_cloud_collaboration_sharing_realtime.sql` | Done locally |
| service_roleを使わない | `.env.example` は `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` のみ。service_role要求なし | Done locally |
| lockTokenをDB hash保存 | SQL uses `cloud_collab_token_hash`; frontend token helpers use `sessionStorage` | Done locally |
| auth/login | `src/cloud/auth.ts`, `FormationLibrary` cloud login UI | Done locally |
| クラウド作成/読込 | `src/cloud/api.ts`, `createCloudProject`, `loadCloudProjectParts`, `App.openCloudProject` | Done locally |
| scene lock取得/解除/heartbeat | `App.beginCloudSceneEdit`, `releaseActiveCloudSceneLock`, heartbeat effect | Done locally |
| scene保存/version競合 | `saveSceneWithLock`, `saveCloudCurrentScene` | Done locally |
| project:settings lock | `beginCloudProjectResourceEdit("settings")`, `saveCloudProjectResource` | Done locally |
| editor/viewer招待 | `CloudShareModal`, `create_project_invite`, `accept_project_invite` | Done locally |
| owner共有管理 | `CloudShareModal`, `list_project_collaboration`, role update/remove/revoke RPCs | Done locally |
| Realtime lock/save通知 | `src/cloud/realtime.ts`, `subscribeCloudProjectRealtime`; `client.realtime.setAuth(accessToken)` | Done locally |
| Realtime bundle impact | Realtime client is dynamically imported from `App.tsx`; Vite emits separate `realtime-*.js` chunk | Done locally |
| 更新通知UI | Cloud banner `更新を再読み込み`, `reloadActiveCloudProject` | Done locally |
| ロック復帰 | `readCloudLockTokenFromSession`, `restoreCloudLockFromSession` | Done locally |
| 競合/ロック喪失JSON退避 | `downloadCloudBackupJson` from conflict and heartbeat-loss paths | Done locally |
| ローカル/クラウド分離 | Cloud open uses `persistLocal: false`; cloud copy-to-local creates independent local project | Done locally |
| 設定手順 | `docs/CLOUD_COLLAB_SETUP.md` | Done locally |
| Supabase接続チェック導線 | `npm run cloud:check` / `scripts/cloud-collab-check.mjs` | Done locally |
| 2ユーザーRPCスモーク導線 | `npm run cloud:smoke` / `scripts/cloud-collab-smoke.mjs` | Done locally, unrun without env |
| 初回SQL適用補助 | `npm run --silent cloud:sql` / `scripts/cloud-collab-sql.mjs` prints both migrations in order | Done locally |
| Vercel env反映補助 | `npm run cloud:vercel-env` / `scripts/cloud-collab-vercel-env.mjs` reads `.env` and sets Production vars via stdin | Done |
| Build gate | `npm run build` succeeded after Realtime/JWT and dynamic import changes | Done |
| Script syntax gate | `node --check scripts/cloud-collab-check.mjs`, `node --check scripts/cloud-collab-smoke.mjs`, `node --check scripts/cloud-collab-sql.mjs`, and `node --check scripts/cloud-collab-vercel-env.mjs` succeeded | Done |
| SQL bundle gate | `npm run --silent cloud:sql` prints both migrations in order | Done |
| Vercel build gate | `npx vercel build` succeeded and wrote `.vercel/output` after dynamic import changes | Done |
| Static diff gate | `git diff --check` has no whitespace errors, only CRLF warnings | Done |
| Prod dependency audit | `npm audit --omit=dev` found 0 vulnerabilities | Done |
| Local server reachability | `Invoke-WebRequest http://127.0.0.1:5173/` returned 200 | Done |
| Local cloud UI after env | Vite restarted with `.env`; Playwright verifies cloud login/signup UI, no unset message, 0 console errors | Done |
| Supabase実環境 env | Hosted URL and publishable key are present in ignored local `.env`; `npm run cloud:check` reaches Supabase | Done |
| SQL migration実適用 | User ran SQL successfully; `npm run cloud:check` verifies `projects` table and cloud RPC surface | Done |
| 2ユーザー実共同編集 | `npm run cloud:smoke` succeeded with owner/editor/viewer; invite, same-scene lock rejection, different-scene lock, save, release, viewer edit rejection verified | Done |
| Vercel env/deploy | `npx vercel env ls` shows Production vars; `npx vercel build --prod` succeeded; production deploy `dpl_DpgNMtHb8nRzz6QxVnsMLybciaao` is aliased to `https://tairetsu-maker.vercel.app` | Done |
| Production UI smoke | `https://tairetsu-maker.vercel.app` returns app UI, cloud login form, no unset Supabase message, console errors 0 | Done |
| Production role display | owner/editor/viewer sessions showed the latest smoke project with `所有者` / `編集者` / `閲覧のみ` role badges | Done |
| Production same-scene lock | owner held `Smoke 1`; editor attempted `Smoke 1` and remained `クラウド閲覧中` with `このシーンは他の参加者が編集中です。` | Done |
| Production different-scene lock | while owner held `Smoke 1`, editor opened `Smoke 2` and entered `クラウド編集中` | Done |
| Production save notification | editor saved `Smoke 2`; owner session showed `更新があります: Smoke 2` and `更新を再読み込み` | Done |
| Web版で実際に共同作業 | Hosted Supabase + Vercel Production environment verified with owner/editor/viewer and production multi-session UI checks | Done |

## Final verification summary

- Supabase project: `https://jhpvdrdunyicrzptgtom.supabase.co`
- Production URL: `https://tairetsu-maker.vercel.app`
- Latest production deployment: `dpl_DpgNMtHb8nRzz6QxVnsMLybciaao`
- Latest backend smoke project: `68db9080-6fa2-4ee7-9032-f174482c7491`
- Backend smoke covered owner/editor/viewer, invite acceptance, same-scene lock rejection, different-scene concurrent lock, scene save, release, and viewer edit rejection.
- Production UI covered role badges, owner scene edit, editor same-scene lock rejection, editor different-scene edit, and save notification display.

## Remaining follow-ups

- Clean up smoke-test projects from Supabase if they are no longer needed.
- Broaden owner-only project resource editing beyond `settings` only when the UI/save boundaries are intentionally redesigned.
- Add longer manual QA for TTL expiry by waiting beyond the configured timeout, if needed.

## Owner Project Operations Extension Audit

### Objective

クラウド共同編集における owner 向け project 系操作を拡張し、メンバー名簿、道具マスター、音源メタ情報、シーン追加/削除/並び替え/名称変更、JSON / `.tairetsu` / ZIP import によるクラウド上書きを、ロック式共同編集の安全設計を守ったままWeb版で使える状態にする。

### Success criteria

- owner のみが project 系ロックを取得できる。
- editor は scene data のみ編集可能なまま。
- viewer は閲覧のみのまま。
- project 系ロックは scene lock と排他。
- `project:members`, `project:objects`, `project:audio`, `project:sceneOrder`, `project:import` を実動作させる。
- シーン追加/削除/並び替え/名称変更は `sceneOrder` resource と `scenes` table の整合性を保つ。
- シーン削除と import は snapshots に操作前バックアップを残す。
- import はRPC/transactionで中途半端な状態を避ける。
- Realtimeはロック状態と保存通知メタ情報のみ。
- service_role key は使わない。

### Prompt-to-artifact checklist

| Requirement | Evidence | Status |
| --- | --- | --- |
| 必須ファイル読了 | `AGENTS.md`, `docs/SPEC.md`, `docs/CURRENT_HANDOFF.md`, `docs/CLOUD_COLLAB_SPEC.md`, `docs/CLOUD_COLLAB_SETUP.md`, `docs/CLOUD_COLLAB_COMPLETION_AUDIT.md` を確認済み | Done |
| 作業前 status/diff | `git status --short`, `git diff --stat` 実行済み | Done |
| SQL/RPC追加 | `supabase/migrations/20260514002000_cloud_project_owner_operations.sql` | Done |
| sceneOrder保存RPC | `save_scene_order_with_lock` handles version check, new scenes, deleted scenes, snapshots, audit log | Done |
| import RPC | `import_cloud_project_with_lock` handles owner check, import lock, validation, snapshots, replace resources/scenes in transaction | Done |
| SQL bundle更新 | `scripts/cloud-collab-sql.mjs` includes 3 migrations | Done |
| cloud check更新 | `scripts/cloud-collab-check.mjs` checks new RPCs | Done |
| smoke拡張 | `scripts/cloud-collab-smoke.mjs` covers project locks/resources/sceneOrder/import | Done |
| フロントAPI | `src/cloud/api.ts` adds `saveSceneOrderWithLock` / `importCloudProjectWithLock` | Done |
| project lock target | `src/cloud/projectParts.ts` supports `project:import` lock target | Done |
| owner UI導線 | `src/App.tsx` cloud banner buttons for members, objects, audio, sceneOrder, import | Done |
| members boundary | `src/App.tsx` guards project:members so scene placement/visibility is not saved together | Done |
| objects boundary | `src/App.tsx` guards project:objects so scene placement/visibility is not saved together | Done |
| audio metadata only | `AudioPanel` / `App.loadAudio` keep audio file local and save metadata only when `project:audio` lock is active | Done |
| sceneOrder UI | `Timeline` allows scene list edits under `project:sceneOrder` while scene memo/data stays disabled | Done |
| editor/viewer UI | project operation buttons are owner-only; editor/viewer project edits remain disabled | Done |
| remote project lock UI | project lock reason is shown as read-only message for other users | Done |
| Supabase実適用 | User ran SQL; `npm run cloud:check` verifies `save_scene_order_with_lock` and `import_cloud_project_with_lock` | Done |
| Backend smoke | `npm run cloud:smoke` succeeded with owner/editor/viewer and project ops | Done |
| Build gate | `npm run build` succeeded | Done |
| Local UI smoke | Playwright CLI verified owner buttons, members lock/modal, sceneOrder save, editor project buttons absent, project lock blocks editor scene edit | Done |
| GitHub push | Commit `b355b87` pushed to `origin/main` | Done |
| Vercel production deploy | `npx vercel deploy --prebuilt --prod` produced `dpl_2ccD1j4ytfxtZHr6mdTLffcc6UMj` and aliased `https://tairetsu-maker.vercel.app` | Done |
| Production UI smoke | Production URL shows cloud login UI; owner can open latest smoke project and sees project operation buttons; console errors/warnings 0 | Done |

### Final verification summary

- Supabase project: `https://jhpvdrdunyicrzptgtom.supabase.co`
- Latest owner project-ops backend smoke project: `d0872735-1ae2-4650-bf2e-b29f183d1aff`
- Production deployment: `dpl_2ccD1j4ytfxtZHr6mdTLffcc6UMj`
- Production URL: `https://tairetsu-maker.vercel.app`
- `npm run cloud:check`: passed.
- `npm run cloud:smoke`: passed with owner/editor/viewer.
- `npm run build`: passed. Vite large chunk warning remains unchanged.
- Local UI target: `http://127.0.0.1:5173/?qa=project-ops`

### Remaining follow-ups for this extension

- Clean up smoke-test projects from Supabase if desired.
- Add a longer TTL expiry/manual disconnect QA pass if lock timeout behavior needs real waiting-time evidence.
