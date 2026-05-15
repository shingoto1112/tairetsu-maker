# クラウド共同編集仕様

最終更新: 2026-05-15

この文書は、隊列メーカーに追加するクラウド共同編集の初期実装仕様です。
完全リアルタイム共同編集ではなく、ロック式共同編集を採用します。
初期実装はシーン単位ロックでしたが、2026-05-15時点でメンバー位置、道具state、表示/非表示、道具割当、シーンメモから、セル単位ロック + 保存済みパッチ同期へ段階移行しています。

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
- `scene_cell:{sceneId}|member_visibility|{memberId}`
- `scene_cell:{sceneId}|object_state|{objectId}`
- `scene_cell:{sceneId}|object_visibility|{objectId}`
- `scene_cell:{sceneId}|object_assignment|{objectId}`
- `scene_cell:{sceneId}|notes|_`
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

対応範囲:

- メンバー位置: `scene_cell:{sceneId}|member_position|{memberId}` を取得し、`positions[memberId]` だけ保存する。
- 道具state: `scene_cell:{sceneId}|object_state|{objectId}` を取得し、`objectStates[objectId]` だけ保存する。
- メンバー表示: `scene_cell:{sceneId}|member_visibility|{memberId}` を取得し、`memberVisibility[memberId]` だけ保存する。
- 道具表示: `scene_cell:{sceneId}|object_visibility|{objectId}` を取得し、`objectStates[objectId].visible` だけ保存する。
- 道具割当: `scene_cell:{sceneId}|object_assignment|{objectId}` を取得し、`objectAssignments[objectId]` だけ保存する。
- シーンメモ: `scene_cell:{sceneId}|notes|_` を取得し、`notes` だけ保存する。

操作開始時にロック取得へ進み、取得できた場合だけ移動/変更を反映します。
ドロップ/操作完了時に `save_scene_cell_patch_with_lock` RPC で対象フィールドだけを保存し、保存成功後にセルロックを解除します。

Realtimeのlive previewは、現時点ではメンバー位置と道具stateだけを対象にします。
表示/非表示、道具割当、シーンメモは保存済みpatch通知で同期します。
保存成功時に `audit_logs` の `save_success` metadataへ `patchType`, `cellId`, `cellLockTargetId`, `patchValue` を記録し、他ユーザーは安全な場合のみ対象フィールドへ自動反映します。

## Phase 0 live preview 基盤

リアルタイム共同編集へ進む前段として、2026-05-15に live preview 基盤を追加しました。

採用方針:

- `scenes.data` JSONB を正式データとして維持する。
- `scene_cell_versions` は既存全セル分をmigrationで作らず、保存時に lazy upsert する。
- version行がないセルは `version = 0` とみなす。
- `edit_locks` は新しい `edit_leases` tableを作らず、既存tableをTTL付きleaseとして拡張する。
- Phase 0ではpreview型と送信口だけを用意し、ドラッグ中の座標をまだ保存データへ反映しない。

`scene_cell_versions`:

- `project_id`
- `scene_id`
- `cell_kind`
- `cell_id`
- `version`
- `updated_by`
- `updated_at`

保存時の流れ:

1. 権限を確認する。
2. `edit_locks` 上のlease/token/client/operationを確認する。
3. `scene_cell_versions` を lazy upsert する。
4. 対象セルversionを `select ... for update` でロックする。
5. `expectedBaseVersion` と現在versionを比較する。
6. 一致した場合のみ `scenes.data` の対象フィールドへpatch適用する。
7. `scene_cell_versions.version` と `scenes.version` を更新する。
8. `audit_logs` に `cellVersion`, `baseCellVersion`, `leaseId`, `operationId`, `holderClientId` を含めて保存通知を残す。

preview event / commit event:

- preview eventは `projectId`, `sceneId`, `cellKind`, `cellId`, `leaseId`, `operationId`, `holderClientId`, `seq`, `value` を持つ。
- commit eventは保存済みpatchの確定通知として `cellVersion` を持つ。
- lock eventは `lock_acquired`, `lock_released`, `lock_expired` を扱い、可能な場合は `leaseId`, `operationId`, `holderClientId` を含む。
- previewの `seq` は操作内の単調増加番号として扱い、古いpreviewを後から描画しないために使う。
- previewは将来の表示専用レイヤーに反映し、`scenes.data` を直接変更しない。
- 受信側は、対象セルに有効なleaseがある場合のみpreviewを信用する。

## Phase 1 メンバー移動 live preview

2026-05-15時点で、最初のlive preview対象としてメンバー移動を実装します。

対象:

- `scene_cell:{sceneId}|member_position|{memberId}`

送信側の流れ:

1. ユーザーがメンバーをドラッグし始める。
2. 既存の `scene_cell` leaseを取得する。
3. lease取得後、ドラッグ中の位置をRealtime broadcast `preview` として送る。
4. previewには `projectId`, `sceneId`, `cellKind`, `cellId`, `leaseId`, `operationId`, `holderClientId`, `seq`, `value` を含める。
5. 送信頻度は約80ms間隔に抑える。
6. ドロップ時に `save_scene_cell_patch_with_lock` で正式保存する。
7. 保存成功後、commit broadcastを送り、leaseを解除する。

受信側の流れ:

1. `preview` を受信する。
2. 自分の同一cell操作中であれば無視する。
3. `edit_locks` 上の現在の `leaseId`, `operationId`, `holderClientId` と一致する場合のみ採用する。
4. 同じoperationでは `seq` が古いpreviewを無視する。
5. 採用した位置は表示専用snapshotへ重ね、`project.frames` や `scenes.data` には混ぜない。
6. commit / save notification / lock release / lock expired でpreview表示を消す。

このPhaseで扱わないもの:

- 道具移動、サイズ変更、回転のlive preview
- 表示/非表示のlive preview
- 道具割当のlive preview
- シーンメモのlive preview
- previewを使ったUndo/Redo

正式データの更新は、引き続き保存済みcell patchだけで行います。

## Phase 2 道具 state live preview

2026-05-15時点で、2つ目のlive preview対象として道具stateを実装します。

対象:

- `scene_cell:{sceneId}|object_state|{objectId}`

送信対象:

- 道具移動
- 道具サイズ変更
- 道具回転

送信側の流れ:

1. ユーザーが道具の移動・サイズ変更・回転を始める。
2. 既存の `scene_cell` leaseを取得する。
3. lease取得後、ドラッグ中の `ObjectState` 全体をRealtime broadcast `preview` として送る。
4. previewには `projectId`, `sceneId`, `cellKind`, `cellId`, `leaseId`, `operationId`, `holderClientId`, `seq`, `value` を含める。
5. 送信頻度はメンバーpreviewと同じく約80ms間隔に抑える。
6. ドロップ時に `save_scene_cell_patch_with_lock` で正式保存する。
7. 保存成功後、commit broadcastを送り、leaseを解除する。

受信側の流れ:

1. `preview` を受信する。
2. 自分の同一道具操作中であれば無視する。
3. `edit_locks` 上の現在の `leaseId`, `operationId`, `holderClientId` と一致する場合のみ採用する。
4. 同じoperationでは `seq` が古いpreviewを無視する。
5. 採用した `ObjectState` は表示専用snapshotへ重ね、`project.frames` や `scenes.data` には混ぜない。
6. commit / save notification / lock release / lock expired でpreview表示を消す。

正式データの更新は、引き続き保存済みcell patchだけで行います。

このPhaseでlive previewまで完全対応していないもの:

- 表示/非表示
- 道具割当
- シーンメモ
- 複数選択の同時移動
- キーボード移動のセル単位保存

表示/非表示、道具割当、シーンメモはPhase 4で保存済みpatch同期に対応していますが、ドラッグ中previewのような未保存previewは送りません。
複数選択の隊列操作パネル移動/整列とキーボード移動はPhase 5で保存済みpatch同期に対応しています。
キャンバス上で複数選択メンバーをドラッグして同時移動する操作はPhase 6で対応しています。

## Phase 4 セル単位パッチ対象拡張

2026-05-15時点で、live preview対象外だったシーン内操作のうち、保存済みpatchとして安全に分離できるものをセル単位保存に対応しました。

対象:

- `member_visibility`
- `object_visibility`
- `object_assignment`
- `notes`

方針:

- 操作開始時または確定時に対象セルのleaseを取得する。
- 複数セルを同時に変更する操作は、必要な全セルleaseを取得できた場合だけ変更を反映する。
- 取得に失敗した場合は変更せず、取得済みleaseを解除する。
- 変更後は対象セルごとに `save_scene_cell_patch_with_lock` を実行し、保存成功後にleaseを解除する。
- シーンメモは入力中に毎文字保存せず、クラウド共同編集中はblur時にまとめて保存する。
- live previewは送らず、保存成功後のpatch通知だけを他ユーザーへ反映する。

## Phase 5 複数選択移動・キーボード移動

2026-05-15時点で、単一セル操作だけでなく、複数の `member_position` / `object_state` をまとめて変える移動系操作をセル単位保存へ対応しました。

対象:

- キーボード矢印移動
- 複数選択の矢印ボタン移動
- 複数選択の左右反転
- 隊列テンプレート適用
- 整列/均等配置

方針:

- 変更対象となる全メンバー/道具のleaseを先に取得する。
- すべて取得できた場合だけローカル表示へ反映する。
- 取得に失敗した場合は変更せず、取得済みleaseを解除する。
- 変更後は対象ごとに `save_scene_cell_patch_with_lock` を実行し、保存成功後にleaseを解除する。
- 保存済みpatch同期のみで扱い、矢印キー押下中や一括整列中のlive previewは送らない。
- ローカル編集では従来通りUndo/Redoへ履歴を積む。クラウド共同編集中はUndo/Redoを無効のままにする。

## Phase 6 キャンバス上の複数選択ドラッグ

2026-05-15時点で、ステージ/パレードのキャンバス上でも、複数選択メンバーを相対位置を保って同時ドラッグできるようにしました。

対象:

- ステージモードの複数選択メンバードラッグ
- パレードモードの複数選択メンバードラッグ

方針:

- 複数選択中のメンバーの1人をドラッグした場合、その選択集合を同時移動対象にする。
- ドラッグ開始時に対象全員の `member_position` leaseを取得する。
- すべて取得できた場合だけドラッグを開始する。
- 取得に失敗した場合は変更せず、取得済みleaseを解除する。
- ドラッグ中の表示は既存の `member_position` preview経路を対象メンバーごとに使う。
- 正式データはドロップ後に対象メンバーごとの `save_scene_cell_patch_with_lock` で保存する。
- 単一メンバー移動の既存挙動は維持する。

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
- `lease_id`
- `operation_id`
- `holder_client_id`
- `renewed_at`

ロック取得時にランダムな `lockToken` を発行し、DBにはhash化したtokenだけを保存します。
保存、heartbeat、解除時には `lockToken` を渡し、DB側で検証します。

`scene_cell` では、`lockToken` に加えて `lease_id`, `operation_id`, `holder_client_id` を検証します。
これにより、同じユーザーの別タブ・別端末や古い操作からの保存を区別します。

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
