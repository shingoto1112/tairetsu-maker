# 旧クラウド停止と期限付き救出（11a）

今回の成果物は未適用の `20261005000000_legacy_cloud_shutdown.sql`。
本番接続・設定変更・公開は行っていない。画面・旧 `src/cloud` の置換は11b。
旧ロック方式を停止し、データを保持したまま現在ownerの恒久アカウントだけに救出RPCを提供する。
旧版の未保存編集を持つ利用者はいない前提で、切替には停止時間を設ける。
前提が変わった場合は停止前に各端末の編集を保存・ZIP退避してもらう。

## 停止対象

| 対象 | 処理 |
| --- | --- |
| `projects`, `project_members`, `project_resources`, `scenes` | PUBLIC/anon/authenticated の全table・column権限を取消し |
| `edit_locks`, `snapshots`, `audit_logs`, `project_invites`, `scene_cell_versions` | 同上。ロック・招待・履歴も直接取得不可 |
| `user_contacts`, `profiles` | 同上。旧連絡先・プロフィール画面も停止 |
| 上記への依存view/materialized view（多段も）、owned serial/identity sequence | カタログで依存を特定してtable/column/sequence権限を取消し |
| `on_auth_user_created_profile` trigger | 削除し、新しいV2匿名ユーザーの旧profile作成を停止。既存行・関数は保持 |
| `supabase_realtime` の上記11table | 登録済みのものだけpublicationから除外（旧SQLが登録するのはedit_locks/audit_logs） |
| `cloud-project:*` | `realtime.messages` のrestrictive ALL policyで、requested topicとrow topicの双方を拒否。Broadcast/Presenceを含む |
| `delete_current_account(text)` | 停止せず修正。共通アカウント削除を維持 |

停止する関数の既知署名はmigrationの配列に全列挙する。PUBLICを含む3ロールからEXECUTEを取消す。
存在しない過去overloadは無視するが、現在の旧関数の定義は書き換えない。

- 文書・保存：`create_cloud_project(text,text,integer,text,jsonb,jsonb)`、
  `hide_cloud_project(uuid)`、`delete_cloud_project(uuid)`、
  `import_cloud_project_with_lock(uuid,text,text,integer,jsonb,jsonb,text,text)`、
  `save_scene_with_lock(uuid,text,integer,jsonb,text,integer,text)`、
  `save_project_resource_with_lock(uuid,text,integer,jsonb,text,integer,text)`、
  `save_scene_order_with_lock(uuid,integer,jsonb,jsonb,text[],text,integer,text)`。
- cell：`list_scene_cell_versions(uuid)`、
  `save_scene_cell_patch_with_lock(uuid,text,text,text,jsonb,text,integer,text)` と
  `(uuid,text,text,text,jsonb,text,integer,text,bigint,uuid,uuid,text)`。
- lock：`acquire_edit_lock(uuid,text,text,text)` と `(uuid,text,text,text,text,uuid,uuid)`、
  `heartbeat_edit_lock(uuid,text,text,text,boolean)` と `(uuid,text,text,text,boolean,uuid,uuid,text)`、
  `release_edit_lock(uuid,text,text,text)` と `(uuid,text,text,text,uuid,uuid,text)`、
  `force_release_edit_lock(uuid,text,text)`、`request_lock_takeover(uuid,text,text)`。
- 共有・連絡先：`create_project_invite(uuid,text,text,text)`、`accept_project_invite(text)`、
  `list_project_collaboration(uuid)`、`update_project_member_role(uuid,uuid,text)`、
  `remove_project_member(uuid,uuid)`、`revoke_project_invite(uuid,uuid)`、
  `list_user_contacts()`、`add_contact_by_email(text)`、
  `add_project_member_from_contact(uuid,uuid,text)`、`add_project_member_to_contacts(uuid,uuid)`。
- helper：`cloud_collab_current_role(uuid)`、`cloud_collab_is_member(uuid)`、
  `cloud_collab_is_owner(uuid)`、`cloud_collab_can_edit_scene(uuid)`、
  `cloud_collab_token_hash(text)`、`cloud_collab_log(uuid,text,text,text,jsonb)`、
  `cloud_collab_cleanup_expired_locks(uuid)`、`cloud_collab_prune_snapshots(uuid,text,text)`、
  `cloud_collab_verify_lock(uuid,text,text,text)`、`cloud_collab_current_email()`、
  `cloud_collab_user_metadata_display_name(jsonb)`、`cloud_collab_current_display_name()`、
  `cloud_collab_normalized_display_name(text)`、`cloud_collab_display_name_for_user(uuid)`、
  `cloud_collab_scene_cell_scene_id(text)`、`cloud_collab_scene_cell_target_id(text,text,text)`。
- trigger関数：`handle_auth_user_profile()`、`handle_project_member_display_name()`。
  関数EXECUTEの取消しだけでは既存triggerの内部実行は停止しない。
  memberの正規化triggerは管理操作・旧データ処理のため保持する。

V2のtable/function/private schema/ACLには変更を加えない。
V2に接続する依存viewが見つかった場合は `LEGACY_DEPENDENCY_TOUCHES_V2` で全体をrollbackする。
取消し後にも継承・custom roleから実効権限が残る場合も全体rollbackする。
FOR ALL TABLES / public schema全体のpublicationでは個別除外できないため、
`LEGACY_PUBLICATION_REQUIRES_EXPLICIT_TABLES` で停止する。
どの場合も影響を棚卸しして、既知の署名・対象を追加した独立migrationで対応する。
全schemaのREVOKEや `DROP CASCADE` は使わない。旧SQLの削除は将来の別migration。

旧11 migrationはStorage bucket/view/sequenceを作成していない。音源は端末にある。
実DBに旧専用bucketがあると確認できた場合だけ、利用者とClaudeがそのbucketのpublic設定・
Storage policies・既存署名URLを確認し、そのbucket限定の停止を別途行う。
他用途のbucket・`storage.objects`全体の権限は取消さない。

## 本番適用前の読み取り専用棚卸しSQL

利用者が対象DashboardのSQL Editorで実行する。これは停止SQLではない。
custom function/追加overload・独立sequence・他schemaのview・新topic・Storageを確認する。
SQL/PLpgSQLの本文参照が必ず `pg_depend` に記録されるとは限らないので、関数一覧もレビューする。
想定外のAPIがあれば適用を保留し、Claudeに一覧を渡す。

```sql
-- 旧APIの署名、設定、ACL（本文・JWT・メール・文書内容は出さない）
select p.oid::regprocedure as signature,p.prosecdef,p.proconfig,p.proacl,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname not like 'collab_v2_%'
order by p.oid::regprocedure::text;

-- 旧tableとその依存view/sequence。column ACLも個別確認する。
with recursive targets(oid) as (
  select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname=any(array[
    'projects','project_members','project_resources','scenes','edit_locks',
    'snapshots','audit_logs','project_invites','scene_cell_versions','user_contacts','profiles'])
  union
  select r.ev_class from targets t join pg_depend d on d.refobjid=t.oid
    and d.refclassid='pg_class'::regclass and d.classid='pg_rewrite'::regclass
    join pg_rewrite r on r.oid=d.objid
    join pg_class c on c.oid=r.ev_class and c.relkind in ('v','m')
), objects as (
  select oid from targets
  union
  select d.objid from pg_depend d where d.refobjid in (select oid from targets)
    and d.refclassid='pg_class'::regclass and d.classid='pg_class'::regclass and d.deptype in ('a','i')
)
select c.oid::regclass as object,c.relkind,c.relacl,c.relrowsecurity,a.attname,a.attacl
from objects o join pg_class c on c.oid=o.oid and c.relkind in ('r','v','m','S')
left join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
order by c.oid::regclass::text,a.attnum;

-- 所有sequence以外の追加sequence、custom/default role grantsもレビュー
select schemaname,sequencename from pg_sequences where schemaname='public';
select defaclrole::regrole,defaclnamespace::regnamespace,defaclobjtype,defaclacl from pg_default_acl;
select roleid::regrole,member::regrole from pg_auth_members;
select pubname,puballtables from pg_publication where pubname='supabase_realtime';
select * from pg_publication_tables where pubname='supabase_realtime';
select p.pubname,n.nspname from pg_publication_namespace pn
  join pg_publication p on p.oid=pn.pnpubid join pg_namespace n on n.oid=pn.pnnspid;
select policyname,permissive,roles,cmd,qual,with_check from pg_policies
  where schemaname='realtime' and tablename='messages';
select relrowsecurity from pg_class where oid=to_regclass('realtime.messages');
select to_regprocedure('realtime.send(jsonb,text,text,boolean)');
select column_name from information_schema.columns
  where table_schema='auth' and table_name='users' and column_name='is_anonymous';
select to_regclass('storage.buckets');
-- storage.bucketsが存在する場合だけ次の2文を実行
select id,name,public from storage.buckets;
select policyname,roles,cmd,qual,with_check from pg_policies where schemaname='storage';
```

## 利用者が行う本番切替

1. ClaudeのLinux CI確認と11bの救出画面確認後、対象Supabaseプロジェクトを確かめる。
   上記棚卸しを行い、DB・Auth・Realtime設定をbackupする。backupの復元方法も確かめる。
2. 停止時間を設ける。旧版を全端末で閉じ、以後旧クラウド編集を再開しない。
   旧版はローカルデータのZIP退避用に扱う。旧クラウド一覧・保存・招待・プロフィールは動かなくなる。
3. 未適用のV2 foundationを全体transactionで適用し、続いて停止migrationの全内容を一度にRunする。
   旧11本は貼り直さない。停止→V2の順もCI対象だが、本番推奨順はV2→停止。
   エラーなら途中から実行せず、エラーをClaudeに渡す。停止migrationの再適用は期限を延長しない。
4. Dashboard → Realtime Settings → **Allow public access をOFF**にする。
   [公式Realtime認可](https://supabase.com/docs/guides/realtime/authorization)のとおり、private RLSだけではpublic channelを閉じられない。
   既存接続の認可はキャッシュされるので、SQL適用だけで残留socketの即停止を保証しない。
   停止時間中に全端末を閉じ、古い接続の終了と新規旧topic接続の拒否を実サービスで確認する。
5. 旧版から旧RPC・直接SELECT/更新・Postgres Changes・Broadcast/Presenceが使えないこと、
   新版からV2 private channel・編集・解除・アカウント削除が継続することを確認する。
   ownerの救出のみ成功し、参加者・未認証・匿名・削除文書は拒否されることも確認する。
6. **旧通信の停止確認後に**Anonymous Sign-Insを有効にする。
   匿名ユーザーもauthenticatedロールになる（[公式匿名認証](https://supabase.com/docs/guides/auth/auth-anonymous)）。
   CAPTCHA/Email/Origin/Edge配備の条件は [サーバー手順](COLLAB_V2_SERVER.md)を継承する。
7. 切替日時とexport終了日時を記録し、救出期限を利用者へ案内する。
   期限後は救出RPCがサーバー側で拒否する。旧データの保持期間・backup・容量を再評価し、
   削除する場合は別migrationとして決める。今回の期限切れで旧データは削除されない。

```sql
-- 初回停止適用時刻から既定30日。private schemaをData APIに公開しない。
select cutover_at,export_until from legacy_cloud_private.shutdown_settings;
-- 期限変更が合意された場合だけ、管理者が絶対時刻を指定して更新する。
-- update legacy_cloud_private.shutdown_settings
-- set export_until='<合意した終了日時とタイムゾーン>'::timestamptz where singleton;
```

期限は設定値。既定30日の利用者確認はClaudeが後で行う。端末やRPC引数では変更できない。
一覧もexportも `clock_timestamp()<export_until` を検査し、期限ちょうどから拒否する。
長いtransactionの古い `now()` で期限を延長できない。受付済みの短いexportは完了し得る。

## 救出RPC契約 v1（11b向け）

- `legacy_list_owned_projects(p_limit=20, p_before_created_at=null, p_before_project_id=null)`：
  limit 1〜50、created_at降順＋UUID降順のkeyset cursor。cursorの2項目は両方指定する。
  `{contractVersion:1, items:[{projectId,title,mode,schemaVersion,createdAt}], nextCursor:{createdAt,projectId}|null}`。
  本文なし。titleは最大256文字（一覧表示用）。非owner一覧は空。次頁までの管理者変更は反映され得る。
- `legacy_export_project(p_project_id)`：指定1文書。
  [固定fixture](../supabase/tests/fixtures/legacy-export-v1.json)と同じ形。
  projectの許可した列、5 resourcesの `resource_key/data/version/schema_version`、
  scenesの `scene_id/data/version/schema_version` のみ返す。resourcesはkey順、scenesはID順。
  シーンの表示順はsceneOrderにある。ゼロシーンは `[]`。5 resources欠損は拒否し、黙って初期値にしない。
- 両RPCはSECURITY DEFINER / 空search_path / 完全修飾table・helper参照。
  非公開の共通account/期限helperはSECURITY INVOKER。3者とも旧認可helperを使わない。
  実在する `auth.users.is_anonymous IS FALSE` とauth.uid()、現在owner membership、
  `projects.deleted_at IS NULL` をSQL内で確認。作成者だけでもownerでなければ救出不可。
  PUBLIC/anon/service_roleにEXECUTEを与えず、authenticatedだけに付与する。
- STABLEの呼出statementのMVCC snapshotで、認可・project・resources・scenes・サイズ判定を統一する。
  ロックtoken・招待・参加者メール・監査情報・updated_by/created_byは返さない。
  自由入力の本文は内容のまま保持する（本文中に利用者が記入した文字列の匿名化ではない）。
- 最大8 MiB（`octet_length(result::text)`、UTF-8 JSONB表現）。集約前に各許可行のJSONサイズを合算し、
  巨大文書／多数の小行も早期拒否する。HTTPヘッダー・プロトコルの総転送サイズの保証ではない。
  上限超過は管理者による別救出が必要で、分割途中の文書は返さない。
  digest/export時刻/account IDを応答へ混ぜず、内容のdigestと取り込み台帳を11bで分けて保持する。

| SQLSTATE / message | 意味 |
| --- | --- |
| 42501 / PERMANENT_ACCOUNT_REQUIRED | NULL UID・不存在・匿名。JWTのuser_metadataは認可に使わない |
| 42501 / LEGACY_EXPORT_EXPIRED | 救出期限終了 |
| 42501 / LEGACY_PROJECT_UNAVAILABLE | 非owner・不存在・削除済み・NULL文書ID。同じ応答で存在を漏らさない |
| 22023 / INVALID_ARGUMENT | 一覧limit/cursor不正 |
| 22023 / LEGACY_EXPORT_INCOMPLETE | 5 resourcesが揃っていない |
| 54000 / LEGACY_EXPORT_TOO_LARGE | サイズ上限超過 |

共通 `delete_current_account(text)` は確認値を `IS DISTINCT FROM` で検査。
NULL UID・不存在・匿名を文書変更前に拒否し、Auth行をロックする。空search_pathを使い、
PUBLIC/anon/service_roleの既定EXECUTEを取消す。返却形式と理由コードは従来形を維持し、
匿名だけ `permanent_account_required` を追加する。旧単独owner文書削除・共同ownerへの移譲・
履歴の本人ID除去・招待処理を維持する。V2は既存Auth trigger/FK cascadeで終了する。
直前のパスワード再認証は既存クライアント責務で、確認文字列を本人再認証の代用としない。

## 検証と11bへの申し送り

Linux CIは2 oracleに分割する。
`test-cloud-sql.mjs` はfoundationの旧定義・ACL非干渉と従来V2回帰を維持。
`test-legacy-cloud-sql.mjs` は隔離DBで旧11→V2→停止／旧11→停止→V2、両migration再適用、
table/column/PUBLIC/依存view/sequence・全旧関数の実効権限、旧API拒否、期限・認可・サイズ、
2 transactionのsnapshot、共通削除・V2 cascade/終了通知、旧topic拒否・V2継続を検査する。
実Realtimeのpublic access設定・残留socket・DB所有権・PostgRESTのHTTP制限はスタブCIで保証しない。

11bでは次を実装する。

- owner限定の**明示取り込み**。fixture v1を検証し、旧IDをV2/端末IDとして再利用しない。
- 端末台帳キー：Supabase環境識別子＋account UUID＋旧cloud文書UUID＋取り込み種別。
  digestは別保持、target IDは初回固定。成功sourceのdigest違いは救出候補へ送り、自動上書きしない。
  応答消失・再起動・CAS失敗でも同じ固定保存要求で再試行する。
- V2 OFFは「端末だけ（ローカル専用）」にする。旧方式の通信を再開するfallbackを残さない。
- 停止済み旧版の案内、期限終了・非owner・サイズ超過・不完全文書の日本語表示。
  手元の旧コピー・ZIPによる救出はクラウドexportと分ける。
- 旧11 SQL／hotfixブランチを丸ごと適用しない。将来の旧object削除は別migrationで個別DROPする。

## Windowsでの確認記録（2026-10-05）

- `npm test -- --maxWorkers 2` を2回：各98ファイル・813件成功（新fixture検査2件を含む）。
- `npm run typecheck`、`check-collab-v2.mjs`、新SQL runner/suiteのNode構文検査、`git diff --check` 成功。
- `npm run build -- --outDir .tmp-11a-build` 成功。出力先を確認して一時フォルダだけ削除、distは変更なし。
  既存のaudioStorageのstatic/dynamic import重複に関するVite警告は残る。
- `node --expose-gc scripts/bench-collab-v2.mjs` 成功：146人×18シーンのp95は
  履歴0件37.2ms／128件350.2ms。合成・ローカル計測で、本番性能の保証ではない。
- 初回テストはsandbox内のesbuild親directory参照で起動失敗。
  ローカル実行のsandbox制限を外して上記テスト2回とbuildを確認した。
- PostgreSQL/Linux環境がなく、新SQLの実実行は未確認。Claudeがpush後のLinux CIを確認する。
  本番の棚卸し・所有権・public access・既存socket・Storage・PostgRESTも未確認。
- install、commit/push、gh、workflow実行、本番接続・シークレット読取は行っていない。
  CLI未導入かつ依存追加禁止のため、migrationファイルは直接作成した。
