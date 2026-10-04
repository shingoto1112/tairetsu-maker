# 新しい共同編集 第9回-2（9b）

第9回-3で履歴取得・独立コピー・専用共有復元APIを実装した。[9cの現行上限・原子性・測定・9d申し送り](COLLABORATION_RESTORE.md)を参照。以下の8MiB作業予約／128更新・1MiB圧縮閾値は9b時点の記録で、9cでは2MiB予約／64更新・256KiB閾値へ変更した。共有復元はprotected直前控えと同一transactionで確定し、旧leaseを無効化する。保存済みcut／旧世代dueだけ整理し、同世代の未完了固定dueは再実行待ちへ戻す。

2026-10-04、開始 HEAD `740dfe3`。編集担当 Codex 1人。未適用 foundation の改訂で、本番接続・配備・commit・push・依存追加は行っていない。

## 採用した入口と契約

専用 `collab-maintenance` Edge を追加した。ingest の別 action は配備が簡単だが、append と重い再構成が worker のメモリ／busy 状態を共有する。専用関数は配備が1つ増える代わりにその負荷を分離する。Yjs 13.6.33 と既存の検証／閉じた DTO を共用し、新しい依存・cron・pg_net・ジョブ用秘密は追加していない。`_shared/backend.ts` は既存の Auth getUser／service RPC adapter を共用する。

要求は `action: maintain|manual, documentId, generation, membershipGeneration` のみ、最大1KiB。actor・確定 seq・理由・出力 binary はクライアントに指定させない。Auth の匿名ログイン済みゲストを含む現在の参加者だけが呼べる。SQL は service_role 専用、参加世代・文書世代を claim と公開の両方で再確認する。外された人／部外者／未認証 anon は不可。履歴権限の正本は9aの `history_allowed` のまま。

maintenance は通常の send/pull・保存・編集状態から独立し、失敗で outbox を held にしない。append ACK と pull の `maintenance {checkpointDue,compactionRequired}`、起動／再接続／前面復帰で起動する。ネットワーク等の失敗は指数バックオフ＋jitter、BUSY／容量延期はサーバーの再試行時間で再試行する。2端末の重複は SQL lease で排除する。snapshot ID は既存の snapshot 統合・cursor・Project・outbox と同じ端末保存で確定する。dirty editor を確定 seq の控えとして送信する入口はない。

## lease、公開、容量

- `claim_maintenance` は文書行を短くロックし、generation・baseSnapshotId・cutSeq・leaseToken・actor・参加世代・期限を確定する。同じ読み取り境界の base と cut 以下のログを返す。再構成中に DB ロックは持たない。
- `gc:false` で wire／隠れた Item／依存／閉じた schema を検証し、Docを破棄して参照も外す。その後 GC 可能な Doc に統合し、完全 state update を生成する。さらに別の Doc へ再読込し、schema／共有内容／clock／削除範囲を照合する。`mergeUpdates` 単独では圧縮しない。
- 公開 CAS は lease・generation・参加世代・snapshot 系列を再確認する。**head=cutSeq は要求しない**。途中の追記は残す。完成済み lease の公開応答消失は同じ結果を返す。別 lease 取得後の古い公開は拒否する。
- 最新 snapshot と直前 P を残し、ログを **P 以下だけ削除**する。P＋Pより後の連続ログで head へ再構成できる。receipt／writer 境界はこの削除に連動させない。破損した最新からの自動切替は今回の入口には追加していない。
- 最大出力8MiBを作業枠に予約する。lease／rate 行の overhead も作業枠で計上する。期限だけで予約を予算から無視せず、次の claim の実削除／release／公開で解放する。公開は置換後の差分で判定し、減量は設定引下げ後も許可する。
- 作業枠16MiBには行 overhead も含むため、8MiB予約が同時に2件入る保証はない。これは無料枠向けの保守的な backpressure。満杯の state 枠を作業枠で通常 append が超えることはない。

## 自動・手動控えと間引き

append の同一 transaction で「前回控えから10分以上、追記前 head が前回控え seq より進んだ」とき、追記前 head を due として固定する。既存 due は上書きしない。作成 Edge は初期 DTO も検証して、文書・初期 snapshot・初期控えを同一 transaction で保存する。旧 service 呼出しが DTO を省略した場合、または初期控え容量が不足した場合は seq=0 の due を保持する。

maintenance は due を先に処理し、その cut だけを DTO 化して `store_checkpoint` を呼ぶ。公開 transaction で控え保存・last_checkpoint・due／lease・予約の解放を原子的に確定する。自動控えは `automatic` 理由。容量不足は `DEFERRED_CAPACITY`、due を保持し、1分後に再試行する。延期中にも安全な範囲で圧縮できるが、due の再生に必要な base／ログを削除する圧縮は許可しない。

`manual` action はサーバーが claim 時の head を選ぶ。容量不足は413で失敗を返し、既存の控えを勝手に間引かない。画面は9dで追加する。

自動控えの transaction 内で、直近2時間を10分、24時間を1時間、以後をUTCの1日 bucket にする。同じ bucket は保護済み／復元前・世代変更前／手動／自動の順で優先する。まず重複する自動控えを削り、文書容量がなお不足する場合は古い自動→手動→復元前の順で減らす。最新と `protected=true` は削除しない。自動保存に失敗したら、その試行の間引きも rollback する。

9c は復元前の必須控えを復元 transaction 内で `protected=true` にし、操作の完了まで維持する。作成者による手動削除 RPC も protected 行を拒否する。9b から共有復元を呼ぶことはない。

## 設定・計測

private `budget_settings` に `compact_updates=128`、`compact_bytes=524288`、`maintenance_interval=5秒`、`actor_maintenance_interval=10秒`、`manual_interval=1分`、`lease_duration=45秒` を追加。既存の80/32/16MiB・文書24MiB・控え64点/2MiBを変更しない。NOOP／BUSYを含む現在の参加者の要求を文書・actorで制限する。手動は両方1分。公開・release は同じ lease に限定し、再試行のため claim の頻度制限をかけ直さない。

Edge の計測出力は **bytes、seq、elapsedMs、結果コードのみ**。要求・例外全文・本文・token・actor・文書ID・音源 descriptor は出さない。`decodeBase64` は8MiB入力で V8 の巨大な iterable 一時配列を作らないよう、確保済み byte 配列への書込に変更した。

Node benchmark は146人×18シーン＋128更新、削除・解除・order slot・墓標を含む1024更新蓄積＋128更新、正確な8MiB snapshot＋4MiBログを測る。fixture 作成と TS compiler、各測定処理は別プロセス。12試行のp95は最大値。binary 検証／GC／DTO と入力decodeのメモリを含むが、HTTP／DB待ち時間は含まない。NodeのCPUはプロセス全スレッド、RSSはプロセス全体。瞬間最大は OS の high-water mark を併記し、heapだけを目標192MiBと比べない。

WindowsにDeno／PostgreSQLはない。CIにDeno型検査、native handler実行2回、同じfixtureでのDeno計測を追加した。Node・Linux Deno・本番Edgeはいずれも別の測定であり、代用しない。目標CPU p95 500ms／全工程1秒程度／最大メモリ192MBとの最終比較は、この文書末尾の検証記録に記載する。

## 9c・9dへの申し送り

- 9c: 必須の復元前控え＋復元 update＋writer receipt＋head を同一 transaction で確定する。共有復元と generation 切替は既存 maintenance lease／due を明示的に無効化・整理する。旧 due を新世代へ付け替えない。protected を保護し、256KiB超更新と復旧バックアップの自動送信禁止を維持する。
- 9d: `manual` Edge の成功／容量失敗、一覧・取得・独立コピー、DEFERRED_CAPACITY と履歴容量の日本語表示を追加する。maintenance の失敗を通常編集のエラーに混ぜない。手動ボタンの連打には429／Retry-Afterを扱う。
- 初回圧縮は P の復旧経路を残すので、ログが減らない場合がある。控え容量延期が長引けば必要ログの保持で最終的に編集受付容量へ届く。圧縮は墓標／clockの無期限編集を保証しない。利用者に無料枠適合や無制限履歴を約束しない。
- Claude: Linux SQL の初回／再適用・実ロール・lease競争・公開中append・期限切れ／停止／ACK消失・世代／解除／削除・満杯時の置換差分・dueの固定・間引きを確認する。Deno実行と最大入力のCPU/RSS、macOS XCTest47件も確認する。Swift／Project／ZIP／PrintPreview／保存領域upgrade は変更していない。

## 最終のローカル検証記録

Windows / Node v24.15.0、Ryzen 7 7735U。下記は他の試験が終了してからの単独測定。全ケースでエラー0、146人×18シーン。通常／蓄積は128更新、境界は65更新で正確に8,388,608 B＋4,194,304 B。蓄積には1,024回の削除／解除／order変更／位置変更がある。

| 負荷 | 処理 | CPU p95 ms | 計算工程 wall p95 ms | プロセス最大 RSS MiB |
|---|---|---:|---:|---:|
| 通常 | 圧縮 | 781 | 305.45 | 224.99 |
| 通常 | 控え | 484 | 224.80 | 216.89 |
| 長期蓄積 | 圧縮 | 1,124 | 522.39 | 243.44 |
| 長期蓄積 | 控え | 641 | 291.17 | 228.64 |
| 8MiB＋4MiB | 圧縮 | 469 | 224.18 | 257.75 |
| 8MiB＋4MiB | 控え | 281 | 140.30 | 224.52 |

計算工程の時間は全ケース1秒程度の目標内。CPU 500msは通常控えと境界で達成し、通常圧縮・長期蓄積では未達。**RSS 192MBは全ケース未達**（表はMiB。192MiBとして比較しても未達）。NodeのCPUはGC等の全スレッドを含み、Supabase CPUとは同一ではない。メモリの工程内サンプルとOS最大値を両方出力する。base64 decode はRSSに含むが、CPU／wallの計算工程測定の前に行う。HTTP／Auth／RPC／hex出力を含む実Edgeの全時間・瞬間メモリは未測定であり、目標／無料枠への適合は未確認。境界のNode RSSは256MiBも超えるため、現行上限のまま無料枠で動くとは扱わない。Linux Denoと実Edgeで測り、安全な入力・ログ・論理要素上限まで下げることを公開前条件に残す。decoder変更前の8MiB入力の最大RSS約482MiBは、最終decoderで約258MiBまで低減した。

既存 `node --expose-gc scripts/bench-collab-v2.mjs` は単独で、履歴なし wall p95 34.15ms／CPU p95 156ms／RSS191.45MiB、128更新 wall p95 147.13ms／CPU p95 609ms／RSS259.02MiB。この既存測定はschema1、compilerを含むプロセスであり、上記schema2のmaintenanceと直接比較しない。

- 最終クライアント／decoderで `npm test -- --maxWorkers 2` は **90ファイル755件、2回合格**（76.92秒／69.76秒）。追加した Edge・pipeline 5件と provider 3件も両方に含む。追加対象の2ファイル34件を別途2回実行し、両方成功。
- typecheck、実Vite設定で一時フォルダへのbuild2構成＋削除、`check-collaboration-bundle` は成功。通常メインJS **474,341 B（基準との差0）**、gzip141,076 B。共同編集／Yjsは通常起動の静的依存に含まれない。既存audioStorage import warningのみ。
- `test-collaboration-{ui,lifecycle,provider,app}-browser`、`test-shared-session-app-browser`、`test-device-audio-app-browser`、`test-build22-browser`、`test-app-storage-browser`、`test-indexeddb-browser`、`npm run test:repository:browser` はすべて最終decoder変更後にも成功。保存失敗時の編集保持・壊れた1件を含むupgrade・CAS・旧ZIP／音源・ステージ／パレード回帰を含む。
- `git diff --check`、`check-collab-v2`（35関数、CASE括弧／dollar quoteも検査）、`check-native-repository`、追加SQL／benchmark JSの `node --check` は成功。
- WindowsでSQL／Denoは実行していない。CIファイルは編集のみで、workflow実行もしていない。SQL suite は初期／自動／手動、128更新とbyte閾値、lease競争、公開とappend競争、期限切れ／release／ACK消失、満杯時の置換差分、解除／世代／削除、実ロール、間引き／protectedを追加した。Denoはhandler実行2回と同一fixture計測をCIに追加した。

補強後のSQL試験も自己レビュー済み。解除後の公開は解除前の実参加世代を使い、間引きは30分前・3時間前・3日前の各bucketで自動優先削除、手動保持、protected保持を明示確認する。35関数の引数・戻り値、ドル引用の対応、IF／ELSIF／WHILE内CASEの括弧、grantループのservice専用8関数とauthenticated helperを確認した。内部thinningには利用者のexecuteを付与しない。静的確認はPostgreSQLでの実行を代替しない。

合意を補強した点は、NOOP／BUSYにも頻度制限をかけること、初期控え容量不足でも初期dueを保持して作成／編集を進めること、保守的な8MiB作業予約、旧serviceのDTO省略時の初期due、最大入力decoderの改善。追加の機能範囲はないが、性能目標未達／実Edge未確認が残る。

変更ファイルは32件（新規13件を含む）。既存 `.tmp-vite-https.config.mjs` は変更していない。

- サーバー: `supabase/migrations/20261004000000_collab_v2_foundation.sql`、`supabase/functions/collab-ingest/{handler.ts,index.ts}`、`supabase/functions/collab-maintenance/{index.ts,handler.ts,handler.deno.ts,deno.json}`、`supabase/functions/_shared/backend.ts`。
- クライアント・検証: `src/collaboration/{checkpoint.ts,legacyServerValidation.ts,serverSchema2.ts,serverValidation.ts,provider.ts,supabaseTransport.ts,transport.ts,maintenance.ts,maintenance.test.ts}`。
- 試験・計測: `scripts/{check-collab-v2.mjs,collaboration-provider.test.ts,test-cloud-sql.mjs,bench-collab-maintenance.mjs,bench-collab-maintenance.deno.ts}`、`scripts/testing/{load-collab-edge.mjs,load-collab-runtime.mjs,mock-collab-server.mjs,maintenance-benchmark-worker.mjs,maintenance-sql-suite.mjs,mock-maintenance-backend.mjs}`、`.github/workflows/supabase-sql-test.yml`。
- 文書: `docs/{COLLABORATION_HISTORY.md,COLLAB_V2_SERVER.md,COLLABORATION_MAINTENANCE.md}`。
