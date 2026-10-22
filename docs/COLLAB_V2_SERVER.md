# 新しい共同編集 第3回：サーバー最小構成

## 2026-10-22：作成枠と終了済み文書の参照制限（iPad 1.1.1 / build 33）

今回の適用対象は **[20261022000000_collab_v2_quota_and_ended_access.sql](../supabase/migrations/20261022000000_collab_v2_quota_and_ended_access.sql) だけ**。以下の過去のfoundation適用・削除手順は今回に使わない。Codexはファイル作成とオフライン検証のみを行い、DB接続・適用・CI起動は行わない。ClaudeがレビューとLinux SQL試験を確認し、利用者の確認を取った後、利用者自身が適用する。

変更内容：作成者ごとの有効な共有20件（終了済みは除外）、全体100件の件数判定廃止。サービスのbytes予算は維持する。同じ作成者＋initial_digestの全行検索を先に行うため、20件到達・bytes予算満杯時も有効な同一要求の再送は成功し、削除済みdigestはDOCUMENT_DELETEDとなる。新規だけDOCUMENT_QUOTA_EXCEEDED→bytes予算検査の順とする。

documents/members/updates/sync_snapshotsのSELECTポリシーは、本人の所属とdeleted_atなしを確認するcan_read_documentに置換。helper所有者は既存is_memberと同じ管理ロールに合わせ、EXECUTEはauthenticatedだけ。履歴2表のhistory_allowedは変更しない。get_updates/list_membersはINVOKERのまま、is_member直後にaccess_statusのended検査を行う。外された人・部外者のNOT_MEMBER、access_statusの終了通知は維持する。migration自体で保存データの更新・削除はしない。

適用前の確認（読み取りのみ）：

1. 利用者が2026-10-22に確認した値は、有効文書6件・終了済み0件、bytes設定はリポジトリ既定値（total 128MiB等）、対象6表のSELECTはcollab_v2_member_readだけ。適用直前にも下のSQLで件数・容量設定・全SELECT/ALLポリシーを確認する。4表はis_member、履歴2表はhistory_allowed(document_id,'view')の計6つが想定。追加のpermissiveポリシーがあれば、今回の置換だけで参照を閉じられるとは判断せずClaudeへ確認する。
2. Claudeが静的check、クライアント試験、typecheck/build、Linuxの使い捨てPostgresで新SQL suiteの成功を確認する。CIは本番に接続しない。SQL未実行のオフラインcheckだけで適用可としない。
3. 既存DEFINER関数の管理所有者を確認する。SQL Editorの実行ロールが関数置換・owner設定・policy作成を実行できることを確認する。

```sql
begin read only;
select count(*) filter(where deleted_at is null) as active_documents,
  count(*) filter(where deleted_at is not null) as ended_documents from public.collab_v2_documents;
select total_bytes,state_bytes,checkpoint_bytes,work_bytes,row_overhead,
  max_snapshot_bytes,max_log_bytes,max_log_entries from collab_v2_private.budget_settings;
select tablename,policyname,permissive,roles,cmd,qual from pg_policies
where schemaname='public' and cmd in ('SELECT','ALL') and tablename in
  ('collab_v2_documents','collab_v2_members','collab_v2_updates','collab_v2_sync_snapshots',
   'collab_v2_checkpoints','collab_v2_checkpoint_contents') order by tablename,policyname;
select p.oid::regprocedure as signature,pg_get_userbyid(p.proowner) as owner,p.prosecdef
from pg_proc p where p.oid in ('collab_v2_private.is_member(uuid)'::regprocedure,
  'public.collab_v2_create_document(uuid,text,bytea,text,bytea,bytea)'::regprocedure);
commit;
```

適用と適用後の確認：

1. 対象プロジェクトのSQL Editorで、今回のmigrationのコメントからbegin;〜commit;まで**全内容を1回のRunで一括実行**する。部分実行、既存migrationの貼り直し、db pushは行わない。新しいEdge配備や容量設定変更は不要。
2. エラーなら同じセッションでROLLBACKし、失敗内容をClaudeへ渡す。途中の続きだけを実行しない。確定前の失敗は全体ROLLBACKとなる。再実行はClaudeの修正・確認後に全体を実行する。
3. [適用後の読み取り確認SQL](../supabase/verify/20261022_quota_and_ended_access_verify.sql)を全体実行する。createの署名/default/戻り値・20件判定と再送順序、helperのSQL/STABLE/DEFINER・空search_path・管理所有者一致、get_updates/list_membersのINVOKERとended検査を確認する。createのEXECUTEはservice_roleだけ、helperと2つの読み取りRPCはauthenticatedだけ（PUBLIC/anonなし）。6表でRLS=true、4ポリシーがcan_read_document、履歴2ポリシーがhistory_allowedのままで、追加permissiveポリシーなしを確認する。
4. 上の件数・容量設定の読み取りを再実行し、適用により既存データが更新されていないことを確認する。同時利用による増減は別途考慮する。動作確認用の文書を使う場合は利用者が範囲を決め、終了通知と端末コピー・未送信内容保持を確認する。SQL suiteは残存本文・履歴を含むfixtureで6表0行とanon権限拒否を確認するが、実Supabaseのロール設定・JWT・iPad実機は別途確認する。

ロールバック方針：適用中の失敗はROLLBACK。COMMIT後に問題が見つかった場合は修正migrationを追加し、強化したRLSを元のis_memberだけの状態へ戻さない。文書データの削除や過去のfoundation再適用をロールバックとして使わない。

クライアント確認：managementTransportとsupabaseTransportは終了判定にaccess_status RPCを利用し、lifecycleもmanagement.access経由で確認する。終了判定を文書テーブルの直接SELECTに依存する箇所はない。uiServiceのrun(action, { keepNotice })は維持する。100件は一覧のページサイズとして残し、全体件数の根拠にした旧コメントだけを修正する。

検証範囲：追加SQL suiteは20/21件・終了による枠解放・全体100件超・20件到達かつbytes予算超過時の再送・削除済みdigest・6表RLS・RPC/ACL・適用失敗ROLLBACK・再適用を対象とする。WindowsではSQLを実行できず、Linux CIでの実行結果は未確認。

第11回-1（11a）：[旧クラウド停止・期限付き救出の手順](LEGACY_CLOUD_SHUTDOWN.md)を追加。
旧11 SQLとV2 foundationは変更せず、独立した停止migrationを追加した。
本番推奨順はV2 foundation→停止migration→Realtimeの **Allow public access OFF**→
旧通信停止の確認→匿名ログイン有効化。既定export期限は初回本番停止適用から30日（サーバー設定）。
共通 `delete_current_account` のNULL確認・実在恒久アカウント検査・search_path・EXECUTEも修正する。
画面は11bで更新するため、11aだけで新版クライアントの切替が完了したとは扱わない。

第10回-transport（2026-10-05）は、ユーザー選択の直接 private Broadcast を追加。未適用foundationの改訂で、適用済み本番への操作は行っていない。詳細は [配信・認可・予算・実測手順](COLLABORATION_PRESENCE.md) を参照。

本番適用時の追加操作：

1. ClaudeのLinux SQL CI成功後、最新の `20261004000000_collab_v2_foundation.sql` をレビューして適用する。新RPC `collab_v2_ephemeral_state`、private helper `ephemeral_allowed`、ACL通知trigger、派生topicのSELECT/INSERTと限定restrictive fenceを確認する。旧permissive policyとの共存を試験する。確定通知topicへのclient INSERT禁止を確認。realtime schemaへ独自table/functionを作らず、private schemaをData APIへ公開しない。
2. Dashboard → Realtime Settingsでpublic accessを無効にし、private channelを使う。Broadcastは通常有効。確定/ACL通知のDB Broadcastは既存 `realtime.send` の仕組みを使い、アプリtableのPostgres Changes購読や新Edge functionは追加しない。SQL Editorの適用ロールがRealtime policy作成とsend呼出を扱えることを確認する。
3. 最新Web/端末アプリを配布し再読込する。1文書8人で一時用最大9 channels/端末、確定用別1。複数タブ・端末を人数と別に数える。DashboardのProject Settings → Product Reports → RealtimeとOrganization Usage（Realtime Messages/Peak Connections/Egress）を確認する。[公式Reports](https://supabase.com/docs/guides/realtime/reports)。
4. 残るメンバー/解除側の旧JWT・旧socketを残し、解除commitから旧topic最終preview、新topic移行までを実測する。通知欠落・休止・offline・foreground・token更新・退出・削除・再参加を確認。数秒〜の残余露出はユーザー決定で許容し、厳密な30秒上限は約束しない。確定編集は引き続きサーバー資格検査で拒否する。
5. 5/8接続＋複数tabの実messagesを測り、月間上限へ近づく前に `EPHEMERAL_BUDGET.maxHz=0.25` でB（離した時だけ確定反映）、必要なら `enabled=false` で一時送信を停止して再配布する。既に開いている旧版へ即時強制できないので最新版へ更新する。無料枠・全体60件/秒をサーバーで自動保証する実装ではない。

LinuxでClaudeが確認：改訂SQL初回/再適用、anon/guest/通常/作成者/解除/部外者の派生topic送受信、本人以外の発行と確定topicへの発行拒否、ACL/参加世代回転で旧topicの新規認可拒否、remove/leave/soft/physical delete/rollbackの内容なし通知。`scripts/testing/ephemeral-sql-suite.mjs` は既存Linux試験に接続済み。Realtime認可cache・残留接続・実配信率はLinux PostgreSQLの代用ではなく、適用後の実サービス確認が必要。

第9回-3で専用 `collab-restore` と履歴クライアントAPIを追加し、未適用foundationを改訂した。[9c契約・新上限・検証・9d申し送り](COLLABORATION_RESTORE.md)を参照。現行ネットワーク受付はsnapshot2MiB／ログ1MiB・512件／圧縮64更新または256KiB、復元update256KiB。端末保存上限とSwiftは変更なし。以下の過去の容量表は現行値ではない。

配備前にClaudeがLinuxのSQL初回・再適用、Deno check／実行2回／新上限9ケース測定、macOS47件を確認する。Node測定だけでEdge適合としない。SQLに追加した `accept_restore / restore_state / publish_restore / release_restore` はservice専用、`confirm_restore` は現在の要求actor限定のauthenticated RPC。原子的復元は公開CASを失ったら新しいEdge呼び出しで計画し直す。

本番配備時に利用者が追加で行うこと：改訂foundationの内容を確認して適用し、既存2関数と同じ環境設定・origin制限で `collab-restore` を配備する。Authをhandlerが検証するため配備方法は下記と同じ。private schemaを公開しない。DashboardでCPU・メモリ・容量・権限を確認してから9dを有効にする。9c単独では新しい画面は出ない。追加の課金・依存・端末DB変換は不要。旧上限を超える端末文書は送信を止めても編集と救出を残す。

第9回-2で専用 `collab-maintenance`、lease・公開CAS・作業予約、自動／手動控え・間引き・頻度制限を追加した。[現行9b契約・最終検証](COLLABORATION_MAINTENANCE.md)を参照。以下の過去の容量・試験値は現行値ではない。配備・確認・停止手順は9bに更新した。

第9回-1で未適用foundationを改訂。writer連番・ACK境界によるreceipt/sent回収、knownSnapshotId、checkpoint DTO/権限、80/32/16MiB配分を追加した。
下記は第3回時点の記録。永続receipt4,096件の累積停止、cursor=0ごとのsnapshot、旧容量表は [現行9a契約](COLLABORATION_HISTORY.md) に置き換わる。本番適用前の実DB使用量確認が必要。

第7回で未適用 foundation を改訂。[現行 API・変更点・適用前の設定](COLLABORATION_LIFECYCLE.md)を参照。
list_members/access_status、private 試行制限・終了記録、同世代の招待応答再取得、Auth 削除前の
招待失効 trigger を追加した。旧11 migration・旧関数は変更なし。以下は第3回時点の記録。

第6回で新規 document_schema default=2、check=1/2、Edge 全写像検証へ更新した。
create は2のみ、append は DB と内部 schema 一致を検査する。本番には未適用。
[全写像・境界・Linux CI 申し送り](COLLABORATION_PROJECT.md)を参照。
以下の座標 schema 1 は第3回時点の記録。

今回は未適用・未配備です。Claude が差分と Linux CI を確認し、その後に利用者が操作します。
アプリとの接続は第4回です。SQLを適用しても現在のUIは共同編集へ切り替わりません。

## 何を追加するか

隊列表の共有先、参加者、招待、確定した変更、再送の記録、再接続用の初期状態を、
`public.collab_v2_*` の6テーブルへ保存します。旧 `projects` 等とは別です。
音源・UI・旧クラウド・旧11 migration・既存アカウント削除RPCは変更しません。
`collab_v2_private` は内部処理専用で、Data API の公開スキーマに追加しません。

対応は第1・2回の **schema 1（メンバー座標のみ）**。
作成者・参加権限・ゲスト種別はDBの正本で管理し、Yjsの内容から決めません。
8人はログインユーザーIDの数です。同じ人の複数端末は1人、別ブラウザーで新しく匿名ログインすると別人です。
参加者は誰でも招待・解除できます。作成者の解除・退出は禁止、文書削除は作成者のみです。

## 判断と実装の境界

- 読み取り・退出wrapper・内部の読み取りは `SECURITY INVOKER`。RLSで参加者だけに開きます。
- 管理の書込とEdge専用の作成・appendは限定 `SECURITY DEFINER`。直接書込を禁じつつ、複数テーブルの不変条件を原子的に守るためです。
- 全新関数は空の `search_path`、完全修飾参照、PUBLIC/anon/authenticated/service_roleからの明示REVOKEと必要なEXECUTEだけを設定します。
- RLSの参加判定だけは、小さなprivate DEFINERで再帰を避けます。削除済みAuthユーザーの古いJWTも拒否します。
- **初期状態もYjs検証が必要**なので、作成RPCは一般利用者に開放せずEdge経由にしました。匿名ゲストは招待参加でき、文書作成は既存の恒久アカウントだけです。
- 同じ作成者＋固定した初期bytesの再送は同じ文書を返します。削除済み文書を再生しません。別文書として再共有する場合は新しいProject ID／新しいY.Docを作ります。
- appendは文書行をロックし、検証headの一致、参加世代、文書世代、容量を再確認して `head_seq + 1` を採番します。更新・receipt・head・通知は同一transactionです。
- receiptは更新ログとは独立し、圧縮で消しません。同じID・同じbytesは元のseqを返し、別digest・別actorは拒否します。SHA-256はEdgeとDB双方で計算します。
- メンバー追加・解除・退出・Auth削除による離脱は、triggerでACL世代とランダムtopicを更新します。再参加の参加世代は新しいUUIDです。
- private Broadcastはサーバーからの更新通知だけ。広い既存Realtimeポリシーがあってもv2の送受信を開放しないrestrictive fenceを追加します。Presence/live relayは後続回です。
- 初期snapshotは完全な `Y.encodeStateAsUpdate` V1。`Y.snapshot()`ではありません。ログ圧縮・履歴・文書世代切替は第9/7回で実装します。

`auth.users` の作成者FKをCASCADEにし、アカウント削除時にその人の共有文書を物理削除します。
他人の文書からの離脱もCASCADEで、topic更新・未使用招待の失効が発生します。
他の文書の更新actorはSET NULLで履歴を保ちます。初期snapshotへの循環FKは遅延検査にし、CASCADEを妨げません。
既存 `delete_current_account` が最後にAuthユーザーを削除する経路にも、自動で適用されます。
旧文書の所有者移譲は従来どおり、新文書には移譲しません。他メンバーの端末コピーは消えません。

## 容量と無料枠

| 対象 | 暫定上限 |
|---|---:|
| 1更新 | decoded 256 KiB |
| 初期／検証後の完全状態 | 8 MiB |
| 文書のログ | 4 MiB |
| 文書の永続receipt | 4,096件 |
| 文書のsnapshot＋ログ＋receipt見積もり | 16 MiB |
| 新方式全体のbytes＋receipt見積もり | 128 MiB |
| 作成者ごとの有効な共有文書 | 20件（終了済みは除外、全体件数上限なし。2026-10-22 migration適用後） |
| 文書ごとの招待発行 | 32件/時、保管256件 |
| schema 1内容 | メンバー500、シーン200、配置100,000、CRDT論理要素100,000、client ID 1,024 |

receiptの見積もりは1件512 bytes。DB全体の実容量、index、TOAST、旧データ、Authの匿名ユーザー、
Realtimeの通知保管は別途監視します。128 MiBは無料枠保証ではなく、安全余裕を残す暫定の受付上限です。
全体容量判定は短いadvisory lockで直列化します。最大100文書の合算なので初期規模には適しますが、高頻度化時には集計方式を再評価します。
削除墓標・招待・receiptの自動GCは今回ありません。上限到達時は共有送信を止め、端末の編集を残します。
有料プランへの変更・外部有料サービス・自動課金設定は不要です。利用量はDashboardで確認し、Freeのまま運用します。

## 適用前に Claude が確認すること

1. `.github/workflows/supabase-sql-test.yml` の Linux jobが成功していること。
2. 既存11 migration、`src/cloud`、UI、package-lockに意図しない変更がないこと。
3. SupabaseのSQL Editorで、利用者が以下を読み取り確認すること。実サービス固有の所有権・Realtime・JWTはスタブCIでは保証できません。

```sql
select to_regprocedure('realtime.send(jsonb,text,text,boolean)') as broadcast_function;
select relrowsecurity from pg_class where oid = 'realtime.messages'::regclass;
select column_name from information_schema.columns
where table_schema = 'auth' and table_name = 'users' and column_name = 'is_anonymous';
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies where schemaname = 'realtime' and tablename = 'messages';
```

期待値は `realtime.send` が存在、RealtimeのRLSがtrue、`is_anonymous` 列が存在です。
Realtime関数や既存ポリシーの権限差異があれば、SQLを勝手に書き換えて適用せずClaudeに相談してください。

**公開前の必須確認**：匿名ログインしたゲストも `authenticated` ロールです。
V2 foundation単体は旧APIを変更しません。公開ゲスト招待の前に、11aの停止migrationと
[棚卸し・停止確認](LEGACY_CLOUD_SHUTDOWN.md)を必ず完了してください。
保管ブランチの旧認可hotfixは混ぜていません。共通削除RPCの旧不備は11aで修正します。

## 利用者が SQL Editor に貼る手順

1. Supabase Dashboardで**現在の対象プロジェクト**を開き、SQL Editor → New queryへ進みます。
2. Claude確認済みの `supabase/migrations/20261004000000_collab_v2_foundation.sql` の**全内容**を貼ります。
3. `begin;` から `commit;` までを一度にRunします。途中だけを選択実行しません。
4. エラーならtransactionは確定しません。エラー全文をClaudeへ渡し、続きだけを適用しません。
5. 新migrationは再適用可能です。今回は既存11本を貼り直しません。CLIの `db push` も不要です。

この後、11aの停止migrationを同様に全体実行します。エラーは全体rollbackです。
再適用でexport期限は延長されません。停止対象・実DB追加object・Storageの扱い・
Realtime設定と旧版の閉鎖は [切替手順](LEGACY_CLOUD_SHUTDOWN.md)に従ってください。

## Edge Function の配備（CLIを推奨）

共有検証モジュールを `src/` からimportするため、ファイル一式を扱えるCLIの手順を使います。
Dashboardでindex.tsだけ貼る方法では依存ファイルが不足します。
[公式CLI準備](https://supabase.com/docs/guides/cli/getting-started)と[公式配備手順](https://supabase.com/docs/guides/functions/deploy)を参照してください。

1. 利用者がSupabase CLIを用意し、PowerShellでこのリポジトリのルート `ipad-ui` を開きます。
2. `supabase --version` と `supabase functions deploy --help` で使用CLIのオプションを確認します。
3. `supabase login` を実行して本人の管理アカウントでログインします。
4. Dashboard → Project SettingsのProject ID（project ref）を確認し、下の `<PROJECT_REF>` を置き換えます。
5. Dashboard → Edge Functions → Secretsで `COLLAB_ALLOWED_ORIGINS` を追加します。値はWeb版の**正確なorigin**（例 `https://example.vercel.app`）。複数ならカンマ区切り、末尾の `/` は付けません。
6. 以下を実行します。このコマンドはEdgeだけを配備し、SQLを適用しません。

```powershell
supabase functions deploy collab-ingest --project-ref <PROJECT_REF> --no-verify-jwt
supabase functions deploy collab-maintenance --project-ref <PROJECT_REF> --no-verify-jwt
supabase functions deploy collab-restore --project-ref <PROJECT_REF> --no-verify-jwt
```

`--no-verify-jwt` はgatewayの旧JWT検査を外す指定です。**関数内のAuth検証は必須のまま**です。
入口はBearer user access tokenを必須とし、毎回 `/auth/v1/user` で本人を検証します。
これにより署名鍵の種類によるgateway差異に依存しません。公開apikeyだけでは更新できません。
ランタイム既定の `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` を利用します。
service keyをクライアント・Git・招待URLに置いたり、確認のため表示したりしません。
新APIキーへの移行時はランタイム設定とこのHTTP adapterを再確認します。

配備後、DashboardのFunction Testで認証ヘッダー無しのPOSTを送り、401を確認できます。
9bでは両方の関数に対して確認します。maintenanceも同じ `COLLAB_ALLOWED_ORIGINS` とランタイム既定キーを使い、cron用の新しい秘密は不要です。共有 `_shared/backend.ts` と `src/collaboration/{maintenance,checkpoint,serverValidation,legacyServerValidation,serverSchema2,projectSchema}.ts` を含むリポジトリ一式から配備します。
origin無しのネイティブ通信は許可します。Webはallowlist外originを403にします。
認証済みの作成・移動・再送確認は第4回providerから行います。配備だけでUI上のボタンは増えません。

### 9b追加の配備・確認

詳細は [maintenance契約・検証](COLLABORATION_MAINTENANCE.md)。Linux SQL／Deno／macOS確認後に利用者が行います。今回Codexは実行していません。

1. 9aに記載した実DB容量の読取り確認とバックアップを済ませ、新foundation全体を適用する。新しい `compact_updates`／`compact_bytes`／頻度／lease設定が存在することを確認する。80/32/16MiBは実容量に応じて適用前に下げる。
2. 上のコマンドで **ingestも再配備し、maintenanceも配備**する。片方だけでは初期控え／新ACK／専用入口の契約が揃わない。CLIのhelpでオプションを確認する。
3. 両関数の無認証401、許可外Web originの403、外された人／部外者の403を確認する。匿名ログイン済み参加ゲストはmaintenanceを呼べる。service credentialや user JWT をチャット・Git・ログへ貼らない。
4. 新規共有を作り、初期控えまたはseq=0 dueを確認する。設定閾値に達する編集と再接続／前面復帰を行い、新snapshot IDと控えが更新されることを確認する。公開中の別端末編集も届くことを確認する。
5. 手動控えUIは9dなので、必要なら本人の認証でFunction Testに `action: manual` と文書ID・文書世代・参加世代だけを送る。成功STORED、頻度制限429／Retry-After、容量失敗413を確認する。cutSeqや内容を入力しない。
6. Dashboard SQL Editorで次の**読取りだけ**を行い、必要なログと予約が残ること、成功後にdue／予約が解放されることを確認する。出力はseq・bytes・時刻だけで内容・descriptorを含まない。

```sql
select compact_updates, compact_bytes, maintenance_interval,
  actor_maintenance_interval, manual_interval, lease_duration
from collab_v2_private.budget_settings;
select d.id, d.generation, d.head_seq, s.upto_seq as latest_seq,
  p.upto_seq as previous_seq, d.log_bytes, d.last_checkpoint_seq,
  d.last_checkpoint_at, d.compaction_required
from public.collab_v2_documents d
left join public.collab_v2_sync_snapshots s on s.id=d.latest_snapshot_id
left join public.collab_v2_sync_snapshots p on p.id=d.previous_snapshot_id;
select document_id, generation, cut_seq, due_at, lease_until, retry_at
from collab_v2_private.history_due;
select document_id, bytes, expires_at from collab_v2_private.work_reservations;
select document_id, count(*) as points, min(server_at), max(server_at)
from public.collab_v2_checkpoints group by document_id;
```

7. Function logsには bytes／seq／elapsedMs／結果コードだけが出ることを確認し、実Edgeで146人×18シーンと境界入力のCPU・メモリ・HTTP/DB込み時間を測る。CPU2秒・メモリ256MBの [公式制限](https://supabase.com/docs/guides/functions/limits) への適合をNode測定だけで判断しない。Nodeの目標未達があるため、Deno／実Edge結果が出るまでは無料枠での最大入力対応を確認済みと扱わない。

利用者の追加操作は、maintenanceの配備、ingest再配備、設定・実DB／実Edge測定、上記動作確認です。cronの設定や新しい秘密の登録は不要です。誰も文書を開かない期間はmaintenanceが走らず、控え作成が次回の参加者の呼出しまで遅れる仕様です。

## 匿名ログインと濫用対策

旧APIの確認後、Dashboard → Authentication → Sign In / Providers → Anonymous Sign-Insを有効にします。
ゲストは `signInAnonymously({ options: { captchaToken } })` → 招待参加RPCの順で参加します。
メール・メール送信サービスは不要です。iPadは既存メール＋パスワードのログインを使います。

[Supabase公式](https://supabase.com/docs/guides/auth/auth-anonymous)はCAPTCHAを強く推奨し、匿名ログインに既定30回/時/IPの制限を設けています。
AuthenticationのCAPTCHA ProtectionでCloudflare Turnstileを設定し、Web参加画面でcaptchaTokenを渡してください。
[Turnstileには無料プランがあります](https://www.cloudflare.com/products/turnstile/)。Supabase Freeでもこの構成で外部の有料メール／レート制限サービスは不要です。
**CAPTCHAの設定は匿名参加だけのスイッチではありません。** [公式案内](https://supabase.com/docs/guides/auth/auth-captcha)では既存のサインインにも適用されます。
現在の `src/cloud/auth.ts` のメール＋パスワード入口にはcaptchaTokenがありません。iPadを含む既存ログインのCAPTCHA対応と動作確認を済ませてから設定を有効にしてください。
今回はUI・旧認証を変更できないため、CAPTCHA対応は第4回以降の公開前作業へ申し送ります。
同一施設の共有IPを考慮しても、最初からIP上限を大きく上げないことを推奨します。
匿名ユーザーの自動掃除はSupabaseにはありません。共有参加中のユーザーを年齢だけで削除しないでください。
ゲストはログアウト・ブラウザー消去・別端末で同じIDへ戻れません。再招待では別ユーザーとして人数枠を使います。

Edgeの1 worker同時実行制限はメモリ保護で、全workerを横断する濫用対策ではありません。
招待は256bitランダムtoken、DBにはhashのみ、24時間・1回使用です。
短い参加コードは使いません。tokenをURL **fragment**（`#invite=...`）に置き、未認証画面で文書内容を公開しません。

Realtime Settingsの **Allow public accessを無効** にし、providerは `config: { private: true }` で購読します。
[認可は接続中にキャッシュされます](https://supabase.com/docs/guides/realtime/authorization)。解除後も古いtopicの接続が即切断するとは限りません。
サーバーは変更後のtopicにしか通知せず、旧topicへ座標や文書本体を送信しません。既に保存された端末コピーは回収できません。

## 適用後の確認クエリ（利用者が実行）

```sql
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename like 'collab\_v2\_%' escape '\';

select has_function_privilege('authenticated',
  'public.collab_v2_append(uuid,uuid,bigint,uuid,bigint,text,bytea,bytea,text,uuid,bigint)', 'EXECUTE') as client_append,
  has_function_privilege('service_role',
  'public.collab_v2_append(uuid,uuid,bigint,uuid,bigint,text,bytea,bytea,text,uuid,bigint)', 'EXECUTE') as edge_append;
-- false / true

select c.relname,
  has_table_privilege('authenticated', c.oid, 'INSERT') as client_insert,
  has_table_privilege('authenticated', c.oid, 'UPDATE') as client_update,
  has_table_privilege('authenticated', c.oid, 'DELETE') as client_delete
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname like 'collab\_v2\_%' escape '\' and c.relkind = 'r';
-- すべて false

select policyname, permissive, roles, cmd from pg_policies
where schemaname = 'realtime' and policyname like 'collab\_v2\_%' escape '\';

select count(*) as document_count, coalesce(sum(log_bytes),0) as log_bytes,
  coalesce(sum(receipt_count),0) as receipt_count from public.collab_v2_documents;
select pg_size_pretty(pg_database_size(current_database())) as entire_database_size;
```

RLSはpublicの9テーブルともtrue、Realtimeは受信allowと送受信restrictive fenceの3ポリシーです。privateの設定・due・予約・lease・rateにもRLSと直接アクセス拒否を設定しています。
このSQLは新テーブルを `supabase_realtime` publicationへ追加しません。通知は `realtime.send` 経由です。
旧publication・旧テーブル定義・旧関数・旧ACLは維持します。

## 元に戻す方法

まず新providerを停止し、Edge Functionsで `collab-ingest`、`collab-maintenance`、`collab-restore` の3関数を削除／停止します。
共有データが作られた後のDB削除は不可逆です。利用者の端末コピー／必要なバックアップを確認してから、Claude確認済みの以下をSQL Editorで実行します。

```sql
begin;
drop policy if exists collab_v2_private_receive on realtime.messages;
drop policy if exists collab_v2_receive_fence on realtime.messages;
drop policy if exists collab_v2_send_fence on realtime.messages;
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and starts_with(p.proname,'collab_v2_') loop
    execute format('drop function %s',f.signature);
  end loop;
end $$;
drop schema if exists collab_v2_private cascade;
drop table if exists public.collab_v2_documents cascade;
drop table if exists public.collab_v2_members;
drop table if exists public.collab_v2_invites;
drop table if exists public.collab_v2_updates;
drop table if exists public.collab_v2_update_receipts;
drop table if exists public.collab_v2_sync_snapshots;
drop table if exists public.collab_v2_writers;
drop table if exists public.collab_v2_checkpoints;
drop table if exists public.collab_v2_checkpoint_contents;
commit;
```

旧データを削除するSQLは含みません。匿名ログインを元の設定へ戻す場合、他用途で使っていないか確認してください。
Realtimeのpublic access設定も、適用前に記録した値へ利用者が戻します。

## 検証記録と負荷見積もり

Windows: `npm test -- --maxWorkers 2` **79ファイル / 639件成功**、typecheck、Web buildと静的preflight成功。
最終修正後の追加対象試験は **2ファイル / 25件成功**（空文書・未知schema・CAS再試行上限も確認）。
SQLの実実行、Deno check、実Supabaseへの接続・設定確認・配備は今回行っていません。
Linux workflowは固定localhostの使い捨てPostgres17へ11 migration＋新migration＋再適用を行い、
auth/JWT/anonymous/roles/realtimeの最小スタブで権限・同時参加・commit競合・冪等性・削除を確認します。
CIには本番シークレット・配備コマンドがありません。

`node --expose-gc scripts/bench-collab-v2.mjs` は実検証モジュールを既存TypeScriptでtranspileして計測します。
146人×18シーン、初期78,199 bytes、146人まとめ移動3,122 bytes。
最終コードの12回のローカル試行でログなし中央値約27ms / p95約33ms、128更新（447,275 bytes）再生で中央値約118ms / p95約127ms。
後者CPU p95約360ms、観測heap増加最大約50MiB。Node RSS約236MiBにはコンパイラ・fixture・GC等も含み、Denoのメモリ値ではありません。
実Edgeの保証値ではありません。

[Supabase公式制限](https://supabase.com/docs/guides/functions/limits)は **CPU 2秒/要求、メモリ256MB、Free wall time150秒**。
現実的な初期文書ではCPUに余裕があると推定しますが、ログ上限・悪意のある文書・実Denoの最大メモリは未測定です。
バイナリの宣言件数・深い構造をYjs適用前に検査し、適用ごとの論理要素数を制限します。
検証時間は累積1秒、head競合再検証は最大3回。同期処理の途中を強制中断する保証はなく、最終的な強制停止はプラットフォーム側です。
同一workerは大きな要求を1件だけ処理し、他は `429 WORKER_BUSY` で即再試行を求めます。
本番の時間・メモリ・呼出量と、ログが増えた際の圧縮頻度は第4/9回で確認してください。

## 第4回への通信契約

- 作成POST: `{action:"create", displayName, bytes}`。作成前の固定初期bytesを再送し、応答の文書ID・文書世代・参加世代を端末に保存します。
- 更新POST: `{action:"append", documentId, generation:"1", membershipGeneration, updateId, bytes}`。bytesはcanonical base64 V1、ID/bytesはdurable outboxから固定します。actorは送れません。
- ACK: `{documentId,generation,updateId,seq:"...",duplicate:boolean}`。HTTP成功＋DB確定のみACKとして保存します。
- SQL参加: `collab_v2_create_invite(uuid)` → `collab_v2_join(token,displayName)`。発行tokenを再取得できません。期限・使用・失効の詳細を未参加者へ公開しません。
- pull: `collab_v2_get_updates(documentId,generation,cursor,limit=32)`。snapshot＋昇順updates＋head/topic/ACL。headだけでcursorを進めず、ページ最後の適用seqとCRDTを端末へ原子的に保存して次ページを取得します。
- bigintはJSON十進**文字列**、参加世代はUUID。DB bigintをJS Numberへ変換しません。
- 400不正/依存不足、403資格失効、409head/文書世代競合、413容量、429混雑、503一時失敗。ローカル編集を残し、409/429/503は固定要求でジッター付きbackoffを行います。
- `MISSING_DEPENDENCIES` は先行するoutboxの送信／不足ログのpull後に固定更新を再送します。`VALIDATION_BUDGET` は無限再試行せず、ログ圧縮や運用上の調整が必要な状態として扱います。
- 参加世代の変更時に古いoutboxを自動送信しません。資格を再確認して利用者判断／独立コピーへ進めます。
- 通知event=`update`、payloadはdocumentId/generation/headSeq/aclGenerationだけ。通知はACKでも正本でもありません。
- ACL変更時は旧topicへ切替通知を送りません。復帰・再接続・低頻度pollで最新topicを確認し、購読を作り直します。
- 二ブラウザーで、確定前送信禁止、切断→編集→再起動→再送、重複、通知欠落、頁取得途中の新append、解除→再招待と古いoutboxを試験します。
- providerでは146人全移動をdrag毎フレーム送らず、確定操作を送ります。CAPTCHA参加画面・全Project写像・iPad bridge・snapshot圧縮・live relayは後続の担当範囲です。
