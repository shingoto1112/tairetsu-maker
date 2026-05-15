# クラウド共同編集仕様

最終更新: 2026-05-15

この文書は、隊列メーカーに追加するクラウド共同編集の初期実装仕様です。
完全リアルタイム共同編集ではなく、ロック式共同編集を採用します。
初期実装はシーン単位ロックでしたが、2026-05-15時点でメンバー位置と道具stateから、セル単位ロック + 保存済みパッチ同期へ段階移行しています。

## 基本方針

- 1つのクラウドプロジェクトを複数人で開ける。
- 編集はロック取得後にのみ可能にする。
- シーンを開いただけではシーン全体ロックを取らない。
- セル単位対応済みの操作は、操作開始時に対象セルだけのロック取得を試みる。
- 同じメンバー位置、同じ道具stateなど同じ対象セルは同時編集不可。
- 同じシーン内でも、別メンバー/別道具であれば同時編集可能。
- 全体データの編集はownerのみ可能にする。
- ドラッグ中の座標や未保存データは送信しない。
- 同期対象はロック状態、保存済みパッチ通知、プレゼンス表示のみとする。
- 保存済みパッチは安全な場合だけ自動画面反映し、未保存変更や自分の操作中対象がある場合は更新通知へフォールバックする。
- ローカル保存とZIP書き出しはバックアップ手段として残す。
- クラウド共同編集中は Undo / Redo を無効化する。ローカル編集では従来通り有効。

## ロック対象

ロック単位は以下です。

- `scene:{sceneId}`
- `scene_cell:{sceneId}|member_position|{memberId}`
- `scene_cell:{sceneId}|object_state|{objectId}`
- `project:members`
- `project:objects`
- `project:settings`
- `project:audio`
- `project:sceneOrder`
- `project:import`

`scene_cell` は、同じシーン内でも対象セルが違えば同時ロック可能です。
同じ `scene_cell` は同時ロック不可です。

既存互換のため `scene:{sceneId}` は残します。
未対応操作や危険操作では一時的に利用できますが、メンバー移動と道具移動/サイズ変更/回転は `scene_cell` を優先します。

安全優先のため、project系ロックは他のsceneロック、scene_cellロック、project系ロックと併用不可にします。

- ownerがproject系ロックを取得している間は、全てのscene/scene_cellロック取得を拒否する。
- 誰かがscene/scene_cellロックを持っている間は、ownerによるproject系ロック取得も拒否する。
- UIでは「全体設定を編集するには、現在のシーン編集が終わるまで待ってください」と表示する。

## セル単位ロック + パッチ保存

第1実装の対応範囲:

- メンバー位置: `scene_cell:{sceneId}|member_position|{memberId}` を取得し、`positions[memberId]` だけ保存する。
- 道具state: `scene_cell:{sceneId}|object_state|{objectId}` を取得し、`objectStates[objectId]` だけ保存する。

操作開始時にロック取得へ進み、取得できた場合だけ移動/変更を反映します。
ドロップ/操作完了時に `save_scene_cell_patch_with_lock` RPC で対象フィールドだけを保存し、保存成功後にセルロックを解除します。

Realtimeではドラッグ中の座標は送信しません。
保存成功時に `audit_logs` の `save_success` metadataへ `patchType`, `cellId`, `cellLockTargetId`, `patchValue` を記録し、他ユーザーは安全な場合のみ対象フィールドへ自動反映します。

今回まだ完全対応していないもの:

- 表示/非表示
- 道具割当
- シーンメモ
- 複数選択の同時移動
- キーボード移動のセル単位保存

これらは既存のscene lockまたは後続のセル単位対応で扱います。

## 権限

権限は3種類です。

- `owner`
- `editor`
- `viewer`

初期実装では、editor の権限は `scene:{sceneId}` の編集に限定します。

editor が編集できるもの:

- シーン内の配置
- 座標
- 表示/非表示
- シーン内メモ
- `scenes.data` に含まれる情報

editor が編集できないもの:

- メンバー名簿
- 道具マスター
- ステージ設定
- 音源設定
- シーン追加
- シーン削除
- シーン並び替え
- シーン名変更

owner のみ許可する操作:

- `project:members` のロック取得と保存
- `project:objects` のロック取得と保存
- `project:settings` のロック取得と保存
- `project:audio` のロック取得と保存
- `project:sceneOrder` のロック取得と保存
- `project:import` のロック取得と保存
- 共有設定
- 権限変更
- プロジェクト削除
- ロック強制解除
- JSON読み込みによるクラウド上書き

viewer は閲覧のみです。

## owner向けproject系操作の拡張

ownerは、対象ごとのproject lock取得に成功した場合のみ、以下の全体データを編集できます。

- `project:members`: メンバー名簿とメンバーグループ。
- `project:objects`: 道具マスターと道具グループ。
- `project:audio`: 音源メタ情報。音源ファイル本体は保存しない。
- `project:sceneOrder`: シーン追加、シーン削除、シーン名変更、シーン時刻変更、シーン並び替え。
- `project:import`: ローカルJSON/`.tairetsu`/ZIPからクラウドプロジェクトを上書き。

`project:members` と `project:objects` の初期拡張では、保存対象は各project resourceのマスター情報のみです。
project lock中にメンバー/道具を追加・削除しても、既存シーンの配置・表示状態は同時保存しません。
シーン内での配置・表示/非表示変更は、引き続き `scene:{sceneId}` lock で保存します。

`project:sceneOrder` は `project_resources.sceneOrder` と `scenes` tableを同一RPCで更新します。
シーン追加時は新しい `scenes` row を作成し、シーン削除時は削除前snapshotを残してから `scenes` row を削除します。

`project:import` は専用RPCでtransaction内にまとめます。
上書き前に既存の `project_resources` と `scenes` をsnapshotへ退避し、import後に `projects` / `project_resources` / `scenes` の整合性を保ちます。
import用lockは保存成功時にRPC内で解除します。

## ロック管理

ロック管理には `edit_locks` テーブルを使います。

主なカラム:

- `project_id`
- `target_type`
- `target_id`
- `locked_by`
- `lock_token_hash`
- `locked_at`
- `last_heartbeat_at`
- `last_activity_at`
- `expires_at`

ロック取得時にランダムな `lockToken` を発行し、DBにはhash化したtokenだけを保存します。
保存、heartbeat、解除時には `lockToken` を渡し、DB側で検証します。

フロント側では `lockToken` を `sessionStorage` に保存し、`localStorage` には保存しません。
タブ更新後に `sessionStorage` のtokenが残っていて、DB上のロックが有効な場合は編集継続を許可します。
tokenが失われた場合、そのタブからは保存できません。ロックはTTLで自然解除されます。

heartbeatは30秒ごとに送ります。
最終heartbeatから120秒経過したロックは期限切れ扱いにします。
最終操作から5分経過したロックは放置扱いにし、自動解除候補とします。
タブを閉じた時の解除処理は補助扱いにし、最終的にはTTLで解除される設計にします。

`last_activity_at` は実際の編集操作があった場合のみ更新します。

activity とするもの:

- メンバー移動
- 道具移動
- 配置変更
- 表示/非表示変更
- シーン内メモ変更
- Undo/Redo（ローカル編集のみ。クラウド共同編集中は無効）
- 保存
- 設定変更

activity としないもの:

- 閲覧
- スクロール
- ズーム
- パン
- 選択のみ

## 保存と競合

保存単位はロック対象単位です。

- `scene:{sceneId}` をロックしている場合は、そのシーンだけを保存する。
- `project:members` をロックしている場合は、メンバー名簿だけを保存する。
- `project:objects` をロックしている場合は、道具マスターだけを保存する。
- `project:settings` をロックしている場合は、設定だけを保存する。
- `project:audio` をロックしている場合は、音源メタ情報だけを保存する。
- `project:sceneOrder` をロックしている場合は、シーン順序とシーン名/時刻を保存する。

保存時には `baseVersion` と現在の `version` を比較します。
一致する場合のみ保存を許可し、保存後に `version` を `+1` します。
一致しない場合は競合として扱い、自動マージは行いません。

競合時は「最新を再読み込みしてください」と表示します。
必要に応じて、対象単位で退避JSONを書き出せるようにします。

- `scene:{sceneId}` の場合は該当シーンのみ。
- project系の場合は該当resourceのみ。

## データ構造

Supabaseでは以下のテーブルに分けます。

- `projects`
- `project_members`
- `project_resources`
- `scenes`
- `edit_locks`
- `snapshots`
- `audit_logs`

`projects` にはプロジェクト基本情報のみを置きます。

`project_resources` には以下の全体データを `jsonb` で保存します。

- `members`
- `objects`
- `settings`
- `audio`
- `sceneOrder`

`project_resources` には `resource_key` ごとに以下を持たせます。

- `version`
- `schema_version`
- `updated_at`
- `updated_by`

`scenes` にはシーンごとの以下を持たせます。

- `data`
- `version`
- `schema_version`
- `updated_at`
- `updated_by`

`projects`, `scenes`, `project_resources` には `schema_version` を持たせます。
既存JSONからクラウドプロジェクトへ移行する際は `schema_version` を設定します。

## scene.data の範囲

editor が編集できる `scenes.data` は、初期実装では以下を対象にします。

- `notes`
- `positions`
- `objectStates`
- `memberVisibility`
- `groupVisibility`
- `objectAssignments`
- `memberAppearanceOverrides`
- `sceneViewState`
- `stageWidthMeters`
- `stageDepthMeters`

シーン名、時刻、順序は `project_resources.sceneOrder` 側に置きます。

## 音源

初期実装では音源ファイル本体はクラウド保存しません。
`project_resources.audio` には音源メタ情報だけを保存します。

保存する情報:

- 音源名
- 長さ
- 開始位置
- BPM
- メモ
- ローカルファイル名

Supabase Storageへの音源保存は後続対応とし、実装前に無料枠の容量と転送量を確認します。

## snapshots

`snapshots` は scene だけでなく project_resources も対象にします。

対象:

- `scene:{sceneId}`
- `project:members`
- `project:objects`
- `project:settings`
- `project:audio`
- `project:sceneOrder`

保存成功後の状態を直近10件程度まで保存します。
削除やimportなど破壊的操作の前には、操作前バックアップも保存します。

## RLS/RPC

Supabaseでは全ての主要テーブルでRLSを有効化します。

- `project_members` に参加しているユーザーだけが対象 `project_id` のデータをSELECTできる。
- ownerまたはeditorのみが編集系RPCを実行できる。
- editorはscene保存RPCのみ実行できる。
- project系保存RPC、権限変更、強制解除、importはownerのみ実行できる。
- `project_members` のINSERT/UPDATE/DELETEはownerのみ許可する。
- `service_role` キーは絶対にフロントエンドに置かない。
- 保存、ロック取得、ロック解除、強制解除、復元処理はRPC関数で実装し、関数内で `auth.uid()` を使って権限確認する。

## Realtime通知

Realtimeで同期するのは、ロック状態、保存通知メタ情報、閲覧中シーンを示すプレゼンス情報のみです。
ドラッグ中の座標や未保存データは送信しません。

保存通知のメタ情報:

- `project_id`
- `target_type`
- `target_id`
- `version`
- `updated_by`
- `updated_at`
- `summary`

他ユーザーが保存した場合、閲覧中で未保存変更がない安全な状態では自動再読み込みし、編集中や未保存変更がある場合は「更新があります。再読み込み」ボタンを表示します。

プレゼンス情報はDBへ保存せず、Realtime Presenceで一時的に共有します。
表示するのは表示名、権限、閲覧中シーン、編集中/閲覧中の状態だけで、メールアドレスは含めません。

## ローカル/クラウドの区別

ローカルプロジェクトとクラウドプロジェクトは明確に区別します。

プロジェクト一覧では以下のバッジを表示します。

- ローカル
- クラウド
- 共有中
- 閲覧のみ

ローカル保存とZIP書き出しはバックアップ手段として残します。
ローカルJSONをクラウドにアップロードする場合は、新しいクラウドプロジェクトを作成します。
クラウドプロジェクトをローカルに複製する場合は、クラウドとの同期関係を持たない独立したローカルプロジェクトとして保存します。

## 初期実装順

1. Supabase schema/RLS/RPC
2. クラウド変換レイヤー
3. ログイン
4. ローカルJSONをクラウドプロジェクト化
5. クラウドプロジェクト読み込み
6. sceneロック取得/解除/heartbeat
7. scene保存/version競合
8. lock表示/更新通知
9. owner専用project系ロック
10. snapshots/audit_logs
