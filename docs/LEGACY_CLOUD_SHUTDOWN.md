# 旧クラウド停止と期限付き救出（11a / 11b）

11aの成果物は未適用の `20261005000000_legacy_cloud_shutdown.sql`。
本番接続・設定変更・公開は行っていない。11bの端末取り込み・旧方式撤去は末尾を参照。
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
   続いて `20261005001000_legacy_rescue_listing.sql` を全内容適用する。
   エラーなら途中から実行せず、エラーをClaudeに渡す。停止migrationの再適用は期限を延長しない。
   停止migrationを再適用した場合は一覧metadataが旧定義に戻るため、最後に一覧migrationも再適用する。
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

期限は利用者決定で本番切替から30日。サーバーの旧データは自動削除しない。
端末やRPC引数では期限を変更できない。
一覧もexportも `clock_timestamp()<export_until` を検査し、期限ちょうどから拒否する。
長いtransactionの古い `now()` で期限を延長できない。受付済みの短いexportは完了し得る。

## 救出RPC契約 v1（11b向け）

- `legacy_list_owned_projects(p_limit=20, p_before_created_at=null, p_before_project_id=null)`：
  limit 1〜50、created_at降順＋UUID降順のkeyset cursor。cursorの2項目は両方指定する。
  11bの追加migration後は `{contractVersion:1, items:[{projectId,title,mode,schemaVersion,createdAt,hidden}], nextCursor:{createdAt,projectId}|null, exportUntil}`。
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

## 11a時点の検証と11bへの申し送り

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

## 11b実装（2026-10-05）

### 取り込みと端末台帳

ホームのV2欄から利用者が押したときだけ一覧を取得する。ログイン時の必須処理ではない。
20件ずつcursor取得し、選んだowner文書を1件ずつexportする。hiddenは別候補で初期選択しない。
soft-deletedはSQLで除外。期限は一覧のサーバー値を日本語日時で表示し、期限終了はサーバーが判定する。
中断・閉じる・アカウント変更で未確定処理を止め、再開は既存の確定台帳から続ける。

`src/legacyImport/validation.ts` は再構築・補完の前に、5 resourcesの存在・重複・schema、
sceneOrderとscene集合の完全一致、ID重複、全フィールドの型と有限数、member/object/group/movement参照を検査する。
未対応項目は黙って捨てず個別隔離する。旧projectPartsの補完処理は削除した。
成功した本文は `snapshotProject` でドメイン情報だけを変換し、独立した端末文書としてcreate-only保存する。
旧ロック・lease・preview・presence・資格・V2 attachment/outbox・snapshot/auditは含めない。
旧revisionは出典文字列だけに保持し、端末やV2のrevisionに転用しない。

台帳は既存のMigrationItem/Batch、`writeMigration`を使う。
キーはSupabase origin/path＋共通Auth account UUID＋旧文書UUID＋種別のcanonical JSONのSHA-256。
`legacy-rescue-v1-…`、隔離は `legacy-isolated-v1-…`。通常bootstrapの`legacy-projects-v1`とは別namespace/batch。
内容digestは`sourceHash`、targetは`legacy-copy-…`として初回から固定。台帳identityに本文・出典をsealする。
writtenのbody/summary/receipt/台帳を1トランザクションで作り、再読取り後にverified/completedへ進める。
2タブ・応答喪失・再起動・容量不足でも既存本体を上書きしない。利用者の編集・削除後は復活させない。
同じsourceのdigest違いは隔離し、利用者が「変更された内容を別の独立コピーとして救出」を押した場合だけ別種別で保存する。
欠損・未対応schema・参照不正・再読取り不一致は1件ずつ理由を表示し、次の文書を止めない。
隔離原文は`{legacyExport:…}`で包む。primitive/arrayの不正応答でも既存Swiftのobject JSON検証と整合する。
隔離原文はProjectの通常読込み対象にせず、旧クラウドも端末原本も変更しない。

音源は8bの端末対応表と端末本体確認を通った対応だけ採用する。未確認の旧IDでは再生させず、
名前・種類・サイズ・時間を残して選び直しを案内する。元の音源メタ情報と旧IDは出典にも保持する。
この取り込みだけで共有開始や新しい音源ダウンロードは行わない。

### iPadの旧下書き

`legacyReaders.ts`のread-only列挙でprimary/pending/backupを別候補として提示する。
draftディレクトリだけを実際に読み、無関係な旧localStorage/端末一括一覧の本文を読み込まない。
破損・読取り拒否・IO失敗・不存在を区別。ログインや旧クラウド一覧取得は不要。
所属アカウントやクラウドより新しいことは推定せず、利用者が選んだ候補だけ独立コピーにする。
同じファイル内容の再選択は二重作成しない。異内容は利用者が選んだ時だけ別コピーになる。
元ファイルは削除しない。旧draft writer・timerは削除し、救出用readerは残す。

台帳のフィールド・DB schema・upgrade・bridge・Swift・backup形式は変更なし。
既存`sources:string[]`にcanonical JSONの出典を追加するだけで、TSとSwift双方の既存検証に収まる。
保存領域のinitialize/upgradeに全件検証や補完を追加していない。不正台帳1件があってもDB open・健全文書を利用できる。

### 旧方式の撤去順序・V2 OFF

1. Auth/config/session epochを共通基盤として保持。`cloud/account.ts`の旧`api.ts`型・エラー依存を`account.ts`/`errors.ts`へ分離。
2. App/FormationLibraryから旧一覧・開く・保存・招待・lock・Realtime入口とeffectを削除。
3. activeCloudProject、旧lock/preview/presence state、heartbeat/draft timer、共有・アカウント旧UIを削除。
4. 通常保存・Undo・編集可否・canvas合成の旧分岐を局所的に整理。
5. 未参照の旧api/realtime/lockTokens/projectParts/types/barrel、共有UI、draft writer、旧専用CSSを削除。

App全体を再実装していない。V2のCRDT・Undo・provider・presenceと共通Auth owner/epochを維持する。
`getAppFeatureFlags`の旧collaboration/personalCloudを廃止。
V2 OFFでは全runtimeでホーム/共有欄にクラウドUIを出さず、設定・期限切れセッションが残っていてもAuth復元/更新通信を開始しない。

### 各ビルドでV2をONにする場所（第12回で決定）

値は**ビルド時に**`VITE_COLLABORATION_V2=1`。未設定/`0`はローカル専用。
今回workflowにはON設定を入れていない。既存環境値・秘密の内容は読んでいない。

| 対象 | Claudeと利用者が本番切替時に設定する場所 |
| --- | --- |
| Web | Vercel対象projectのBuild Environment Variablesに`VITE_COLLABORATION_V2=1`を設定し、対象environmentを再ビルド。ローカルPowerShellでは`$env:VITE_COLLABORATION_V2='1'`を設定して`npm run build` |
| iPad TestFlight | `.github/workflows/ios-testflight.yml`の`Build web assets`の`env`に`VITE_COLLABORATION_V2: "1"`を追加。ここで作ったassetsを後続`cap sync ios`がコピーする |
| iPad simulator/local | `.github/workflows/ios-build.yml`の`Build web assets`にも同じenvを設定する場合だけON。ローカルはbuild/`npm run ios:sync`前に同じ環境値を設定 |
| Windows | `.github/workflows/windows-desktop.yml`の`Build Windows app`の`env`に同値を追加。`src-tauri/tauri.conf.json`の`beforeBuildCommand: npm run build`が引き継ぐ。ローカルも`npm run desktop:build`前に設定 |

各ONビルドには共通Supabase URL/公開anon keyの設定とV2サーバー/Edge配備が必要。
フラグを入れるだけでは旧停止やV2配備は完了しない。OFFへの再ビルドでも旧通信へのfallbackはない。

### 合意からの追加と第12回への申し送り

11a一覧はhidden文書を含むがhidden状態も期限も返さないため、厳密な別候補表示・期限表示を実現できなかった。
新migration `20261005001000_legacy_rescue_listing.sql`だけを追加し、同じ一覧RPCへ`hidden`/`exportUntil`を追加した。
owner/恒久account/期限/soft-deleted/空search_pathの境界は維持し、本文export契約fixture、旧データ、期限設定、V2は変更しない。
既存migrationの書換えはしていない。両適用順のLinux suiteにこのmigrationの反復適用・hidden・期限維持を追加した。

第12回では新migrationのLinux実実行を先に確認する。WindowsではPostgreSQL実行・実Realtime・本番設定は未確認。
ClaudeのmacOSでは既存47 XCTest・release Swift build・simulatorを再確認し、iPad実機で
未ログインのprimary/pending/backup救出、アクセス拒否、破損、低容量、強制終了/再開、backup復元後の再押下、元ファイル不変を確認する。
Swiftは今回変更していないので新規XCTestやpbxproj変更はない。nativeの実ファイル・ピークメモリ・Windows installerも未確認。
本番30日、旧データ自動削除なし、手動owner取り込み、独立端末コピーをリリース案内へ反映する。
新namespaceの隔離候補は旧bootstrapの復元候補一覧へ混ぜない。個別理由は取り込み結果に表示し、原文は台帳/backupに保持する。
期限後の管理者による原文調査・巨大文書の救出と将来の台帳保持方針は別作業。

### 11bの検証記録

| 確認 | 結果 |
| --- | --- |
| `npm test`（`.env`を読まない一時Vite config、`--maxWorkers 2`） | 2回成功、各96ファイル・834件。追加取り込み単体試験30件も最終修正後に2回成功 |
| `npm run typecheck` / `git diff --check` | 成功（GitのLF→CRLF案内のみ） |
| Vite build / `check-collaboration-bundle` | 一時フォルダへ成功・削除。main `index-BoPVUJEG.js` 369,803 B、gzip 114,308 B。基準477,762 Bから107,959 B減（22.6%）。共同編集/Yjs・help・ephemeral UIは通常起動graphに入らない |
| `check-collab-v2` / `check-native-repository` / SQL suite Node構文 | 成功。SQL実実行・Swift compileの代わりにはならない |
| collaboration browser：ui・shared-session・lifecycle・provider・app・device-audio・history・presence | すべて成功。旧文書API呼出0件。Auth/account削除/V2は維持 |
| build22 / app-storage / indexeddb / help / `npm run test:repository:browser` | すべて成功。通常作成・編集・保存・ZIP・音源・画像、stage/paradeのtouch/zoom、50手順・移行30ケース・2ページCAS・200/1000件のRepository検証を含む |
| 新`test-legacy-import-browser` | 最終2回成功。実IndexedDB、2タブ、応答喪失、再起動、中断/再開、quota・summary/ledger書込みrollback、5不正schema/欠損/参照の個別隔離、再読取り不一致、編集/削除保持、changed digestの明示救出、期限終了、未ログインdraft、画面寸法を確認 |
| 新`test-legacy-local-browser` | 2回以上成功。設定と期限切れAuthが残るWeb/iPad/TauriのOFFでクラウド通信0件、通常作成・編集・保存・Undo・印刷用PDF。旧方式UIも0件 |

初期の表示試験・追加試験の比較方法・CSS削除の空selector・ES target非対応の`Array.at`は修正して再確認済み。
最終buildはCSS構文警告なし。既存audioStorageのstatic/dynamic import重複警告だけ残る。
commit/push/install/gh/workflow実行、本番接続、secret読取なし。Project型・ZIP形式・PrintPreview・dist・共通export fixtureは不変。

画面は匿名fixtureだけで、指定scratchpadの`shots-11b`に保存：

| 寸法 | 取り込み画面 | 下書き救出画面 |
| --- | --- | --- |
| 744×1133 | `import-744x1133.png` | `draft-744x1133.png` |
| 1133×744 | `import-1133x744.png` | `draft-1133x744.png` |
| 1032×1376 | `import-1032x1376.png` | `draft-1032x1376.png` |
| 1376×1032 | `import-1376x1032.png` | `draft-1376x1032.png` |
| 390×844 | `import-390x844.png` | `draft-390x844.png` |
