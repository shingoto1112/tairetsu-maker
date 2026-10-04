# 第9回-3（9c）：履歴API・独立コピー・原子的な共有復元

9aの履歴権限、9bの固定cut・間引き契約を維持する。画面は9d。未適用foundationの改訂で、本番接続・配備・commit/pushは行っていない。

## APIと復元計画

- 履歴は `CollaborationHistory.list/get`。文書に結び付けたkeyset、最大64件、閉じたsummaryと9a checkpoint DTOを検証する。現在の参加者（認証済みゲスト含む）は参加前の履歴も取得できる。外された人・部外者・未認証anonは新規取得不可。取得済み端末コピーは回収できない。
- 独立コピーは `prepareIndependentCopy` → `saveIndependentCopy`。共有内容だけをProjectへ射影し、新ID／作成日時、`collaboration:null`、新規作成CASで保存する。同一CommitRequestを保持し、保存失敗／応答消失でも同じ要求で再試行する。資格・outbox・端末表示状態は持ち出さない。
- 共通曲descriptorは8bの端末対応表と一意候補で解決する。未対応ならaudioはnull、`songUnresolved`と案内を返す。別曲へ無断変換しない。共有復元はdescriptorだけを変更し、端末音源IDは書き換えない。
- 旧schema 1は座標だけで名前・設定・道具・音源を保存していない。取得と同一トポロジーの共有復元は対応するが、控え単独の完全コピーは `LEGACY_CHECKPOINT_REQUIRES_BASE_PROJECT` として拒否する。元の保存済み文書からのコピーが必要。過去の名前などを現在値で黙って補完しない。

復元は現在のサーバー確定Hを再生した作業Docに通常の編集を適用する。古いbinaryのapplyもProjectから共有Docの再生成もしない。`planSharedRestore`は現在だけのentityを削除、過去だけのIDを生成し、保持済みIDは既存Mapを維持して `planRestore` で観測済みの全削除墓標を解除する。削除中の値も直接更新する。座標atom、所属、割当、経路、順序、Y.Text、optional、曲descriptorを復元し、有効な共有内容の一致を検証する。通常編集として新しいslot／解除eventが必要なので、履歴slot／event IDの一致は求めない。サーバー更新は既存受信経路・remote originで扱い、通常Undoへ自動登録しない。

## 原子性・CAS・冪等性

専用 `collab-restore` は最大1KiBの閉じた要求だけを受ける。actor・bytes・title・headはサーバーが決める。新要求は文書・actor各1分、再試行は同じIDで枠を再消費しない。ログはbytes・seq・時間・結果コードだけ。

1. `accept_restore` がactor・参加世代・文書世代・対象ID/seq/digestに結び付いた要求を永続化（ACCEPTED）。
2. `restore_state` が短い文書ロックでHと対象を取得。45秒lease、出力用2MiB＋256KiBの作業予約、再計画は最低5秒間隔。
3. Edgeが一度だけ計画・検証。updateが256KiB超なら **RESTORE_UPDATE_TOO_LARGE / 413** と独立コピー推奨を返し、共有は変えない。複数appendへ分割しない。復元後完全状態も2MiB以内。
4. `publish_restore` が文書ロック、H/baseSnapshot/leaseのCASと現在の資格を再確認し、**Hの必須直前控え（protected）・update・server writer receipt・head・結果・旧保守予約整理**を同一transactionで確定。必須控えの容量不足や後続失敗は全体rollback。間引いて無理に成功させない。
5. head/snapshot競合は409。同じ要求IDで最大3回、**別Edge呼び出し**から最新Hで再計画する。重い計画を一回のCPU2秒枠に重ねない。publish応答消失は同一bytesで再送し、確定済み結果をCASより先に返す。

server-owned writerはactor・参加世代・文書世代ごとに再利用し、通常append/probe/confirm_writerでは使えない。要求結果はTTLで消さず冪等の柵とする。最大4,096要求/文書、結果行は2行分overheadとして全体予算に算入。上限で新規復元を保留し、古いIDを再実行可能にしない。`confirmApplied` / `confirm_restore` は端末へ永続反映した後だけ使い、連続確認済みwriter receiptだけを回収する。要求結果は残る。文書削除時だけ要求も消す。

protectedは復元transaction中を覆い、確定の最後で解除する。確定後は通常保持方針へ戻る。旧maintenance lease／作業予約を無効化する。旧世代dueと、同じcutの控えを保存済みのdueだけ整理する。**同世代の未完了dueは捨てず、lease／retry日時を解除して再実行待ちへ戻す**。新しいHの控えは古い固定cutを保存した証拠にはならない。

## 上限の見直し

正本は `src/config/collaborationLimits.ts`。SQL設定との一致をpreflightで検査する。SQLはさらに下げられるが、静的上限より上へは上げない。

| 対象 | 9b | 9cネットワーク受付上限 |
|---|---:|---:|
| snapshot／復元後完全状態／保存する控え本文 | 8MiB | 2MiB |
| 再生ログ | 4MiB | 1MiB、最大512更新 |
| 圧縮開始 | 128更新／1MiB | 64更新／256KiB |
| 一つの通常／復元update | 256KiB | 256KiB |
| メンバー／シーン／配置／struct | 500／200／100,000／100,000 | 300／100／20,000／50,000 |

4MiB案は従来8＋4MiBより小さいが、9bのDeno RSS370MiBに対して余裕が不足する。実隊列表0.17〜0.5MiBに余裕を残す2MiBを採用し、早めの圧縮で再生量を制限する。復元上限を複数appendへ緩めない。

**端末の救出・保存上限は変更しない**（base8MiB、累積16MiB、JSON24MiB、4,096件）。共通定義でネットワーク受付と端末保管を分け、Swiftの既存検証値を維持した。旧データを開く・個別救出する能力と新規送信受付は別である。Swift変更・DB upgrade・全件変換はない。新上限に入らない旧文書は送信保留し端末編集を残す。本番未適用なので既存共有データを削る移行はしない。

## 状態と9dへの申し送り

`requesting`（送信中）、`accepted`（DB受付）、`committed`（共有確定）、`applied`（この端末へ永続反映）を区別し、対象seq・復元seq・receiptを返す。COMMITTEDだけで端末反映／全員一致と表示しない。

- 既定は独立コピー。共有復元は対象と影響を確認する専用操作にする。
- `newRestoreRequest` を一度だけ作り、要求ID・対象DTO・結果を保持する。失敗／画面再開でも同一要求で確認・再試行。9cは状態APIまでで、UIや操作状態を保存する新DBは作っていない。
- 独立コピーも準備したCommitRequestを保存成功まで作り直さない。
- 通常pull→SaveCoordinator保存成功、durable cursorが復元seqに到達した後、検証済み対象DTOとdurable Docを `observeRestore` へ渡す。保存失敗時は編集／pendingを残す。差分パスと未送信編集の有無を返す。
- 競合なしは有効な共有内容の一致をサーバーで検証済み。後続seqの差は「その後の共同編集により、指定状態と異なる項目があります」。未送信ローカル編集の差とは区別する。
- applied状態と結果を保存後に `confirmApplied`。失敗は同じ要求で再試行し、前の未確認receiptを飛ばさない。
- 413／必須控え容量不足は共有を変えず独立コピーへ案内。旧schema 1コピーには元文書が必要と案内。履歴削除は作成者だけ。

## Windows検証記録（2026-10-05）

- `npm test -- --maxWorkers 2`：92ファイル **773件×2回成功**。追加restore12件も別途2回成功。削除／二重墓標／Map・Y.Text保持、順序・割当・経路・optional・曲、一致と同時編集、応答消失、CAS再計画、コピー音源・資格非持出し、保存失敗編集保持、確認の連続回収を含む。
- typecheck、SQL/native静的preflight、実Vite設定の一時build2構成＋削除、bundle確認は成功。メインJS **475,264 B**（基準475,310 Bより **46 B減**）。通常起動に共同編集・Yjsの静的依存なし。audioStorageの既存import併用warningのみ。
- 指定collaboration ui/shared-session/lifecycle/provider/app/device-audio、build22、app-storage、indexeddb、help-page、repository browserすべて成功。ZIP、ステージ／パレード、壊れた1件を含むDB upgradeも回帰確認。
- Node単独12試行：既存v2は履歴なしwall p95 35.95ms／CPU141ms、128ログ135.67ms／469ms。新maintenance9ケースは想定どおり。通常復元CPU p95 **641ms**／wall326.48ms、長期蓄積復元 **844ms**／460.29ms、最大プロセスRSS **230.07MiB**。通常／長期圧縮CPU578／969ms。2MiB＋1MiB境界圧縮359ms／最大RSS179.92MiB、境界復元は復元後状態超過でQUOTA_EXCEEDEDを期待どおり返す。
- Node計算工程であり、HTTP／Auth／DB／hex出力・実Edge瞬間メモリの保証ではない。CPU500ms／RSS192MBの余裕目標は全ケース未達。Deno・Edge適合は未確認。

Linux確認事項：SQL初回・再適用、実ロール、protected中の強制失敗で全体rollback、公開CASと再計画、二重publication、256KiB超、解除後拒否、protected間引き除外、旧lease／保存済みdue整理と未完了due再実行、receipt回収後も冪等。CI追加のDeno check、実行試験2回、新上限の通常・長期・境界×圧縮／控え／復元のCPU・heap・RSS／OS最大値を確認（lib0のため `--allow-env` 必須）。macOSは既存Swift47件をコンパイル・実行する。WindowsではSQL／Deno／Swift実行、本番接続・配備は未確認。

変更ファイル：

- API／計画／状態：`src/collaboration/{historyApi.ts,restore.ts,restorePlan.ts,restore.test.ts,runtime.ts,checkpoint.ts}`。
- 上限／Deno共通import：`src/config/collaborationLimits.ts`、`src/repositories/collaborationData.ts`、`src/collaboration/{serverValidation.ts,serverValidation.test.ts,legacyServerValidation.ts,transport.ts,identity.ts,model.ts,legacyModel.ts,projectModel.ts,projection.ts,recipeCommands.ts}`。
- サーバー：`supabase/migrations/20261004000000_collab_v2_foundation.sql`、`supabase/functions/collab-restore/{handler.ts,index.ts,deno.json,handler.deno.ts}`。
- 試験／測定：`.github/workflows/supabase-sql-test.yml`、`scripts/{check-collab-v2.mjs,test-cloud-sql.mjs,bench-collab-maintenance.mjs,bench-collab-maintenance.deno.ts}`、`scripts/testing/{restore-sql-suite.mjs,maintenance-sql-suite.mjs,maintenance-benchmark-worker.mjs,load-collab-edge.mjs,load-collab-runtime.mjs,mock-collab-server.mjs,mock-maintenance-backend.mjs}`。
- 文書：`docs/{COLLABORATION_HISTORY.md,COLLABORATION_MAINTENANCE.md,COLLAB_V2_SERVER.md,COLLABORATION_RESTORE.md}`。

`git diff --check` と追加JSの構文確認も成功。App.tsx、Project型、ZIP形式、PrintPreview、dist、Swift、旧11 migration、既存未追跡 `.tmp-vite-https.config.mjs` は変更していない。合意に対する制約は上記の旧schema 1単独コピー不可と、SQL／Deno／Swift／実Edge未確認。9cで履歴画面・本番公開は追加していない。
