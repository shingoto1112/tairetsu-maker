# 新しい共同編集 第9回-1（9a）

SQL/Edge は未適用・未配備の foundation 改訂。旧11 migration、本番、Project 型、ZIP、印刷、音源本体の形式は変更していない。
この冒頭から9a検証記録までは9a時点の契約。9bの専用maintenance・自動実行・圧縮は [9b実装記録](COLLABORATION_MAINTENANCE.md)、履歴取得・独立コピー・原子的共有復元APIは [9c実装記録](COLLABORATION_RESTORE.md) に進んだ。履歴画面は9dに残る。履歴権限は下記のユーザー確認済み契約を維持する。9cのネットワーク上限2MiB／ログ1MiBは端末救出上限を変えない。

## receipt と端末 sent の回収

- writer は **保存領域内の端末文書 × document generation × account × membership generation**。ランダム UUID を attachment に一度だけ保存し、同じ IndexedDB を使う複数タブは同じ writer を使う。Yjs client ID、JWT、タブ ID を writer にしない。別端末／独立した保存領域は別 writer。
- attachment schema **3** に `writer {id, allocatedThrough, ackThrough, reclaimedThrough, legacySentIds}`、outbox の `writerSeq` を追加。すべて連番は canonical decimal string、上限は PostgreSQL bigint。データの document schema 1/2、SQLite DB schema 2、IndexedDB DB version は変更しない。
- writerSeq は送信前に **body・base・outbox・revision と同一 CAS transaction** で確定する。まだ flush されていない新しい共有操作を provider が勝手に保存／送信しない。再起動時の端末音源・表示確認だけが dirty の場合は、既に確定した共有 outbox の再送を妨げない。競合後に振り直せるのは、SaveCoordinator が追跡する「まだ保存成功していない割当」だけ。固定された update ID／bytes／連番は再送で変えない。
- サーバーは文書行をロックし、writer の actor／参加世代／文書世代を検査する。次の writerSeq は `acceptedThrough+1` だけ。同じ連番への異なる ID／bytes は拒否。receipt がある同一要求は元の seq を返す。
- ACK は端末で sent 化 → 完全状態を base に含める → 連続 ACK 境界を進める → 境界以下の bytes を削除する。この全体を1回の保存で確定する。途中の pending の穴を飛ばさない。保存失敗なら元の durable pending とサーバー receipt は残る。
- **保存成功後だけ** `collab_v2_confirm_writer` に ackThrough を報告する。最後の送信後と再起動後にも報告するため、次の append がない場合にも回収できる。サーバーは連続 accepted 範囲以下だけを認め、receipt 削除・receipt_count 更新・reclaimedThrough を1 transactionで確定する。報告応答消失は冪等再試行。
- 回収済み境界以下は `result: RECEIPT_RECLAIMED`（writerId/reclaimedThrough）を返す。**自動 ACK、新規連番への振り直し、自動再送はしない**。provider は送信を保留し、取得・編集・救出を継続する。古いタブの未確認 pending を CAS で再導入しようとしても CONFLICT として内容を残す。
- TTL 削除、sent の slice、期限による writer 境界削除はしない。writer 台帳の上限は暫定1,024/文書。文書削除以外の境界GCは未実装。世代切替でも旧世代境界を残す設計を9cで維持する。
- schema 1/2 は1件単位で読み込み可能。writer 導入時、旧 sent の bytes は完全 base に含め、最大4,096個の `legacySentIds` に移す。これは移行用の有限な tombstone で、新しい送信ごとには増えない。writer のない旧要求の receipt は引き続き保持し、勝手に新方式として回収しない。
- ACK消失した旧pendingは、同actor・同digestの既存legacy receiptを新writer連番へ原子的に紐づけ、元seqを返す。新規appendにはしない。writer導入済み文書の**未採番の新規要求は WRITER_REQUIRED で拒否**し、古い実行中アプリが9bのログ削除後に回収境界を迂回できないようにする。
- IndexedDB／SQLite の前の保存にも writer／境界／snapshot ID が含まれる。前の保存の救出は従来どおり **独立コピー**。Swift の DB 全件復旧では current と previous の共有 attachment に `recoveryRequired:true` を付け、内容・outbox・古い境界は保持する。連番導入前の古いバックアップも自動送信しない。元DBは quarantine として残る。共有復旧後の自動再開を禁止するのは、新 writer を作って回収済み内容を再 append しないための追加防御。
- 開く処理／DB upgrade は attachment を一括検証・書換えしない。不正な1件はその文書の read で拒否し、他文書・一覧・個別救出を妨げない。

4,096は「未回収 receipt／端末に滞留する outbox」の上限で、文書の累積更新数の上限ではない。
追加モック試験では4,100件を処理し、毎回 sent bytes／receipt が0になることを確認する。
ただし9a単独ではログ圧縮をまだ実行しないため、ログ4MiB／検証再生4,096更新に達すると送信保留になる。9bの圧縮を組み合わせて長期運用する。

## 初期 snapshot と通信量

pull に `p_known_snapshot_id`、snapshot に `id` を追加。`cursor < snapshot.uptoSeq` または取得済みIDと異なる場合だけ bytes を返す。
head=0 でも一度取得して保存したIDを次の pull へ渡す。IDは **snapshot の受信状態・cursor と同じ保存** で確定し、受信保存に失敗したIDは既知扱いしない。
join/open の初回取得もIDを保持する。IDだけで必要な seq の取得を飛ばせない。
snapshot 取得中に発生したローカル編集は Y.Doc へ合流し、置換で消さない。

30秒poll、head=0で1日2,880回の場合、従来の base64 本体通信量は `4*ceil(snapshot bytes/3)*2880`。
例えば64KiBなら約240MiB/日、最大8MiBなら約30GiB/日（JSON/HTTP overheadを除く）。
9aでは保存成功した初回1回だけの約85.3KiB／10.7MiBになる。snapshot 更新・保存失敗・別端末の初回取得では再取得が必要。

## checkpoint の閉じたDTO

`src/collaboration/checkpoint.ts` をクライアントと将来の専用Edgeで直接共有できる。
Yjsは固定 **13.6.33**。binary／doc.store／内部構造への依存は既存 serverValidation 境界に集約したまま、新DTO処理は公開APIのみを使う。

envelope: `documentId, generation, confirmedSeq, formatVersion=1, sharedSchemaVersion=1|2, content, song, digest, reason, serverAt, requestedBy, automatic`。
reason は `manual / automatic / before-restore / before-generation`。
serverAt／requestedByはサーバーが確定する。Auth削除で requestedBy がNULLになった既存履歴も読める。

content は検証済み共有モデルの **閉じた論理root DTO**（schema 2: metadata/settings/members/stageObjects/scenes/memberGroups/objectGroups/movementPlans/movementPaths/orders/tombstones、schema 1: metadata/members/scenes）。
端末Projectのコピーではなく、論理的な順序・参照・削除の意味を保つ。songは共通descriptor（name/type/size/任意duration）として分離する。
端末audio ID／audioBindings／音源本体／UI view／資格／outbox／任意のProject拡張項目は入らない。

`createCheckpointDTO(snapshot, seq付きupdates, cut metadata)` は連続ログが確定seqまで揃うことを検査する。
`checkpointFromConfirmedDocument` は **サーバーのcutから再構築したDoc専用**。dirty editorにseqラベルを付けて保存する入口として使わない。
検証はDTOを公開Yjs APIで再構築し、既存の閉じたschema validatorで検査し、正規化前後のDTOも照合する。
SHA-256対象は canonical JSONの版＋schema＋共有内容＋song。理由／日時／actor／seqはdigest対象外で、同一文書内だけ内容を重複排除する。

foundation: checkpoint_contents（bytes/digest/版）、checkpoints（cut/理由/要求者/サーバー日時）を追加。
一覧は keyset（serverAt,id）最大64、取得、作成者限定削除、参照のなくなったcontentの削除を用意。
`store_checkpoint` はservice_role限定の土台で、今回クライアント向け作成endpointは公開しない。9bの検証Edgeが必ずDTO生成・検証を済ませて使う。

## 履歴権限：ユーザー確認済み（2026-10-04）

| 操作 | 参加中の通常／ゲスト／作成者 | 外された人／部外者／未認証anon |
|---|---|---|
| 参加前を含む履歴の一覧・取得・独立コピー | 可 | 新規取得不可 |
| 手動控え・共有復元 | 可（実行入口は後続回） | 不可 |
| 控えの手動削除 | 作成者だけ | 不可 |
| 自動作成・間引き | サーバーだけ | 不可 |

判定の変更箇所はSQLの **collab_v2_private.history_allowed** 1か所。RLS、読取RPC、削除RPC、Edge用保存RPCが共用する。
メンバー追加・解除は全員、文書削除は作成者だけという既存の決定は維持。
ゲストは匿名ログイン後の authenticated ロールであり、未認証 anon ロールではない。外された人の端末に取得済みのコピーを消すことはできない。

## 全体容量と失敗契約

全値は private `budget_settings`。実DB測定後に下げられる暫定値で、無料枠／文書単位の保管数を保証しない。

| 配分／制限 | 暫定値 |
|---|---:|
| 現状態・ログ・receipt・全snapshot（直前含む）・writer／due行 | 80MiB |
| 全checkpoint（重複排除content＋履歴行） | 32MiB |
| 作業予約 | 16MiB |
| 全体合計 | 最大128MiB |
| 文書の現状態・復旧用計上 | 24MiB（snapshot2個＋ログ等のため旧16MiBから変更） |
| 文書のcheckpoint通常 | 最大64点、計上2MiB以下 |
| 必須控え時の例外 | 最大66点、計上8MiB以下。全体32MiB配分は超えない |
| 行・index等の暫定余裕 | 1行最低512B、設定で増やせる |

require_budget は全snapshotを計上し、ログ行・receipt・writer・due・checkpoint内容と履歴行・期限切れを含む未解放予約も計上する。
全体advisory lockで判定と書込を直列化。置換時は `p_extra - p_replaced` の **確定後差分** で判定する。設定を下げた後でも減量を拒否しない。
通常追記は80MiB配分を越えて作業16MiBを使わない。9bでは実ピークをlease付き予約へ計上し、公開CAS成功時に旧対象分・予約の解放を同一transactionで行う。期限切れという理由だけで予算上無視しない。
TOAST圧縮率／実index／DB全体の空き容量を正確に算出する会計ではない。運用前に実容量で設定値を調整する。

- 自動控え: `DEFERRED_CAPACITY`、dueを保持して延期。まだログを捨てない。
- 手動控え: 容量エラーを表示し、勝手に既存控えを消さない。
- 復元／世代切替の必須控え: 保存できなければ操作全体を行わない。
- 現状態の追記: 送信保留。端末の編集・保存・独立コピー救出は保持。

**本番適用前に利用者が確認する手順**:

1. ClaudeがLinux SQL CIの新foundation＋再適用、macOS XCTest、差分を確認する。今回こちらからpush／workflow実行しない。
2. 利用者が対象Supabase DashboardのDB使用量を確認し、SQL Editorで以下を読み取り実行する（Codexは接続しない）。

```sql
select pg_size_pretty(pg_database_size(current_database())) as whole_database;
select schemaname,relname,pg_size_pretty(pg_total_relation_size(relid)) as total
from pg_stat_user_tables order by pg_total_relation_size(relid) desc;
```

3. 旧データ、Auth、Realtime、TOAST/indexを含む実使用量と、必要な作業余裕を利用者に報告してもらう。余裕不足なら80/32/16や文書制限を**適用前に下げる**。無条件に128MiBを確保済みと扱わない。
4. 履歴権限と復旧後の送信保留を利用者に確認する。旧ゲストAPI／認証/CAPTCHAに関する既存公開前確認も完了させる。
5. Claude確認済みfoundation全体を利用者が適用する。9bの専用Edge／運用監視なしで長期共同編集を公開しない。

## 9b〜9dへの申し送り

- **9b**: 専用maintenance Edge、lease＋作業予約、snapshot公開CAS、直前snapshot Pと **Pより後のログ** を復旧経路として残す。head=cutSeqは要求せず、snapshot ID／generation／leaseのCASを使う。due.cutSeqの控えが完成するまで必要ログを圧縮で消さない。検証済みcutだけDTO化する。
- append transaction は「前回控えから10分以上、追記前headが前回控えseqより進んだ」とき、追記前headのdueを永続記録する。既存dueは上書きしない。9bが処理成功時にlast_checkpointとdue/leaseを原子的に更新する。
- Claudeの機会的maintenance案を推奨する。cron用秘密／ジョブ履歴を増やさず、参加者のクライアントが受付後に呼べる冪等Edgeにできる。ただし誰も呼ばない期間は控えが遅れ、次回編集者が負荷を負う。dueと必要ログを保持し、再接続時も呼ぶことが条件。全員閉じた最後の状態は現在状態として保持し、次回追記前のheadをdueにする。今回のdueはcron方式でも利用可能なので、最終選択は9bの負荷・実Edge計測後に決める。
- **9c**: 専用の原子的共有復元（直前必須控え＋復元update＋writer receipt＋headを同一transaction）。256KiB超updateは拒否して独立コピーを案内。復旧バックアップの古いwriterを自動で新世代へ付け替えない。
- **9d**: 履歴UI、延期／容量／復旧保留の日本語表示、権限確認反映、実DB/Edge測定と上限調整。

Linux SQL実行、Swift実コンパイル、本番使用量、実EdgeでのDTO最大CPU/メモリはWindowsでは未確認。Node単体／ブラウザー／静的SQL/Swift preflightは別の検証であり代用とはしない。

## 9a の変更ファイルと検証記録（2026-10-04）

変更は29ファイル。未追跡の既存 `.tmp-vite-https.config.mjs` は変更していない。

- 共同編集: `src/collaboration/{writer.ts,checkpoint.ts,history.test.ts,persistence.ts,saveSession.ts,provider.ts,transport.ts,supabaseTransport.ts,lifecycle.ts,deviceAudio.test.ts}`。
- 端末保存: `src/repositories/{types.ts,collaborationData.ts,contract/testing/indexedDbBrowserSuite.ts}`、`src/storage/{saveCoordinator.ts,sharedSessionState.ts}`。
- Swift: `ios/ProjectRepositoryCore/Sources/ProjectRepositoryCore/{CollaborationValidation.swift,ProjectRepository.swift}`、`ios/ProjectRepositoryCore/Tests/ProjectRepositoryCoreTests/CollaborationTests.swift`。
- foundation: `supabase/migrations/20261004000000_collab_v2_foundation.sql`、`supabase/functions/collab-ingest/handler.ts`。
- 試験: `scripts/{collaboration-provider.test.ts,test-cloud-sql.mjs,check-collab-v2.mjs,check-native-repository.mjs,test-collaboration-provider-browser.mjs,test-shared-session-app-browser.mjs,testing/mock-collab-server.mjs}`。
- 文書: このファイル、`docs/COLLAB_V2_SERVER.md`。

確認結果:

- `npm test -- --maxWorkers 2`: 最終クライアントコードで **89ファイル・747件、2回成功**。回収・DTO・providerの対象2ファイル34件も **2回成功**。追加の実IndexedDB試験も成功。
- `npm run typecheck`、`git diff --check`、`check-collab-v2`、`check-native-repository`、SQL試験スクリプトの `node --check`: 成功。SQL試験内の既存変数との名前重複は修正済み。
- `test-collaboration-{ui,provider,lifecycle,app}-browser`、`test-shared-session-app-browser`、`test-device-audio-app-browser`: すべて成功。providerとshared-sessionは最終変更後にも確認。
- `test-build22-browser`、`test-app-storage-browser`、`test-indexeddb-browser`、`npm run test:repository:browser`: 成功。保存失敗時の保持、旧形式・ZIP・音源、一覧、破損した1件を含むDB upgrade、二つのタブCAS、ステージ／パレード表示の回帰を確認。
- `check-collaboration-bundle`: 実Vite設定で一時フォルダへ2構成をbuildして削除、成功。メインJS **474,341 B**（基準473,569 Bから **+772 B**）、gzip 141,074 B。通常起動の依存グラフに共同編集・Yjsなし。既存のaudioStorage静的／動的import併用warningは残る。
- `node --expose-gc scripts/bench-collab-v2.mjs`: 単独測定で146人×18シーン、履歴なし p95 **28.60ms**／CPU p95 **125ms**、履歴128件 p95 **122.61ms**／CPU p95 **421ms**、RSS最大 **250.13MiB**。Nodeプロセス全体の値でありEdgeの制限適合を示さない。並行試験中の測定はCPU競合があったため、この単独測定を採用。

Claudeへの確認依頼: Linuxで `scripts/test-cloud-sql.mjs` のfoundation初回・再適用、writer連番競争／回収後再送、実ロール（anon・匿名ログインゲスト・通常・作成者・外された人・部外者）のcheckpoint RLS、各容量／置換差分を実行する。macOSでSwift47件（共同編集14件）をコンパイル・実行し、新transition、current／previousを含む復旧バックアップ、schema1/2読込を確認する。Denoの共通DTO import／型検査と実Edgeの最大入力計測は9b前に行う。

合意を補強した点: 文書現状態枠を旧16MiBから暫定24MiBへ変更（最大8MiB snapshotを直前分と2個保持するため）、復旧DBは旧形式も送信保留、writer導入後の未採番要求を拒否、切れたログ再生をEdgeで拒否。合意した9a範囲からの機能追加はない。自動控え・間引き・圧縮・共有復元・履歴UIの実行は9b〜9dに残す。

commit／push／依存追加／workflow実行／本番接続は行っていない。Project型・ZIP形式・PrintPreview・distは変更していない。

## 9b の確定事項と検証記録（2026-10-04）

[実装・変更一覧・詳細測定](COLLABORATION_MAINTENANCE.md)、[配備手順](COLLAB_V2_SERVER.md)を参照。未適用foundationの改訂であり、9aのwriter／端末保存／履歴DTOの契約を維持する。

- 入口は専用 `collab-maintenance`。appendから重い再構成のworker負荷を分離し、現在の参加者だけが呼ぶ。文書5秒・actor10秒、手動は両方1分。NOOP／BUSYも制限し、ログはbytes・seq・時間・結果コードだけ。
- 機会的maintenanceを採用。受付後・再接続・前面復帰にproviderがバックグラウンドで呼び、leaseで重複排除する。自動控えは固定due cutを再構成して保存し、last_checkpoint・due・lease・予約解放を原子的に更新する。初期控え、手動控え、容量延期と10分／1時間／1日粒度の間引きも追加した。
- 圧縮公開はgeneration／baseSnapshotId／cutSeq／leaseToken／参加世代のCAS。head=cutSeqを要求しない。直前PとPより後のログ、未完了dueの再生経路を保持する。8MiB作業予約と置換後差分で判定し、通常追記が作業枠を消費しない。
- 最終decoderで単体755件×2、追加対象34件×2、指定ブラウザー全種、typecheck、bundle、静的SQL／native／diff確認は成功。メインJSは474,341 B、基準との差0。Swift変更なし。
- 他の試験終了後のNode単独測定ではCPU p95 281〜1,124ms、計算工程wall p95 140〜522ms、プロセス最大RSS 217〜258MiB。CPU500msは一部、最大メモリ192MBは全ケース未達。HTTP／Auth／DBを含む全工程時間とDeno／実Edgeの無料枠適合は未確認。現行上限での公開保証はせず、実測と安全な上限調整を公開前条件にする。
- ClaudeはLinux Postgres17で補強後のSQL初回・再適用・実ロール・競争・容量・間引き3区分、Denoの型検査／実行2回／測定、macOS47件を確認する。Codexはcommit／push／workflow実行／本番接続をしていない。
- 9cは必須直前控えをprotectedにして復元全体を原子的に確定し、世代変更で旧maintenance lease／dueを整理する。9dは手動控え・履歴・容量延期の日本語UIと独立コピーを追加する。履歴権限は9aの既定値でユーザー確認済み（2026-10-04）。
