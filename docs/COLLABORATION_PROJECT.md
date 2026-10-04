# 共同編集 第6回 — 全 Project 写像と編集入口

第7回の [共有開始・招待・参加・終了 API と本番設定](COLLABORATION_LIFECYCLE.md)を追加。
端末の参加コピーは共有文書に紐づく新 ID、CRDT の作成者 ID は維持する。
以下は第6回時点の記録。Swift・共通 fixture は第7回では変更していない。

2026-10-04。新規 Y.Doc は **documentSchema=2**。attachment の schemaVersion=1、
既存 IndexedDB/SQLite/bridge の番号とは別物。本番 SQL/Edge は未適用。
schema 1 は過去 fixture の読み込み・append を維持するが、全項目を編集する App には2が必要。
自動昇格はしない。作成者だけが正規化済み Project から初期化し、参加者は同じ bytes を hydrate する。

## 写像表

閉じた語彙 `projectSchema.ts` をモデル・コマンド・Edge で共用する。
未知の任意 JSON を同期する逃げ道は作らない。

| Project | Y.Doc / 競合の単位 |
| --- | --- |
| id / version / createdAt | metadata、初期化後は変更不可 |
| title / mode | settings の独立 register |
| stage / paradeSettings | 項目別 register。下記の関連値だけ同じ atom |
| animationSettings / guideSettings | 各フラグ別 register。省略と空 object も保持 |
| members | ID ごとの Y.Map。name / color / visible / zIndex は独立 |
| stageObjects | ID ごとの Y.Map。type / name / color / shape / visible / locked / zIndex は独立。defaultX / defaultY / widthMeters / heightMeters / defaultRotation は geometry 1値 |
| frames | scenes の ID ごとの Y.Map。label / section / timeSec は独立。stageWidthMeters / stageDepthMeters は stageSize 1値 |
| frames.notes | **Y.Text**。省略と空文字も保持。他者の文字が残るときは省略フラグより文字を優先 |
| frames.positions | member ID → {x,y} 1値 |
| frames.objectStates | object ID と field の tuple key。geometry={x,y,widthMeters,heightMeters,rotation} 1値、visible / zIndex は別 register。objectId はキーから投影 |
| frames.memberVisibility / groupVisibility / memberAppearanceOverrides | 対象 ID ごとの値。appearance の現行フィールドは color |
| frames.objectAssignments | (scene,object,member) の関連ごとの register。空割当も保持 |
| memberGroups / objectGroups | group ID ごとの Y.Map。name / color / defaultType / defaultShape は独立。所属 ID ごとの追加・削除 |
| movementPlans | plan ID ごとの Y.Map。参照・有効・開始終了時刻・note は独立、pathType / controlPoint / waypoints は path atom |
| movementPaths | path ID ごとの Y.Map。参照・visible は独立、pathType / 旧 type / controlPoint は path atom。旧経路の ID は**初期変換時だけ**補完 |
| 全ての意味のある列 | orders の slot＋active slot。シーン、メンバー、道具、両グループ、移動計画、経路、所属、道具割当内の順序 |
| 削除 | tombstones[JSON([entityRoot,id,deleteOperationUUID])]、操作ごとに独立 |
| audio | settings.song={name,type,size,duration?} または null。端末 audio.id / Blob は共有しない |
| sceneViewState / focusMemberId / viewerPerspective / lastOpenedAt / updatedAt | 端末 Project から保持。Y.Doc に書かない |
| 選択 / 再生位置 | 従来の React 状態 |

関連設定 atom（正規化が同じ意味として扱う旧名・新名・モード間の値）:

- width: stage.widthMeters + paradeSettings.width
- depth: stage.depthMeters + paradeSettings.totalDistance + backwardDistanceMeters
- grid: stage.gridSizeMeters + gridIntervalM + paradeSettings.cellSizeMeters
- horizontal: stage.horizontalGuideMode + horizontalDisplayMode + paradeSettings.horizontalMeasureMode
- diameter: stage.memberDiameterMeters + memberCircleDiameterM
- globalSize: useGlobalStageSize + useGlobalStageWidth + stage.fixedForAllScenes

同じ register の同時変更は Yjs の決定規則で収束する。端末時計・到着順の後勝ちではない。
別項目・別関連は両方残る。宣言済み全フィールドは往復試験で保持する。
未知の旧拡張フィールドはローカル base の追加情報として保持し、他端末には同期しない。
曲 descriptor は Project.audio にリモートの端末 ID を製造して投影しない。
第8回で descriptor と端末音源の対応表を接続する。

## 順序・削除・無効参照

各列は `orders[JSON(tuple)]={slots:Y.Array<{elementId,slotId}>,active:Y.Map<id,slotId>}`。
移動は新 slot を挿入し、対象 ID の active だけ切替。投影は active に一致する生存要素を
1回だけ出す。同じ要素の同時移動で重複しない。古い slot は履歴として残す。
一般 recipe は LIS で変更していない順序を保ち、シーンのドラッグ並べ替えは直接 ID 指定。
初回同時割当で別々の Y.Map を作らないよう、scene/object ごとの列を先に生成する。

有効な墓標が1つでもあれば削除。移動・名称変更・同じ ID の再追加は解除しない。
明示 restore だけが観測済み墓標を解除する。まだ届いていない他者の削除には効かない。
App の従来削除 recipe の座標・割当・所属・経路 cascade を共有では物理削除に変換せず、
復元用の情報を残す。削除済み対象への参照は**投影だけで無効参照として除外**する。
投影中の修復 transaction・正規化・時刻生成はない。

## 編集入口と stale 全置換

`SharedProjectEditor` を attachment 付き隊列表を開いたときだけ dynamic import。
既存 `updateProject(recipe)` の**同期的入口**で現在の Y.Doc を投影し、変更 branch/ID/field を
`recipeCommands.ts` のコマンドへ変換する。React effect で全 Project を監視するバインダーはない。
メンバー・道具・シーン・グループ・表示・割当・計画・設定・前シーン反映・まとめて移動・
テンプレート整列も共通入口を通る。1確定操作＝1 local-origin transaction。
複数対象への経路設定は同期 batch、ドラッグは pointer-up の1 transaction。
非共有は従来の recipe / Project スナップショット Undo のまま。

Y.Doc の更新と coordinator.changed から再投影する。同じ Y.Doc へ durable 状態を
REMOTE_ORIGIN で apply し、UndoManager の identity を保つ。ドラッグ中は自分の geometry
だけを表示で保持し、別対象・名前・表示は反映。削除は pointer-up でも解除しない。
固定 update を同期的に journal/outbox へ staging し、端末 commit 成功前の送信を禁止する。
保存失敗時は pending bytes を保持する。

| 洗い出した全置換経路 | 共有中の扱い |
| --- | --- |
| 通常 updateProject / スナップショット Undo | session コマンド / Y.UndoManager へ分岐 |
| replaceProjectWithHistory | 拒否。意図的取込みは importProject(live base) API |
| 古い React Project/配列/要素を返す recipe | 公開済み参照を検査し、stale 全置換を拒否 |
| async 保存・旧クラウド・読込 callback の setProject | session 公開投影だけ受理。captured snapshot は現在の投影に戻す |
| 現在の隊形を保存（frames 全体を組み直す経路） | journal の flush のみ。失敗時に成功表示しない |
| coordinator の Project-only edit / attachment 付き commit | 拒否 / 同世代の全投影一致を検証 |
| 一覧 rename | shared title コマンド＋CAS。通常 rename は変更なし |
| ZIP・旧クラウド取込み | 従来どおり独立した新規 Project。共有への明示取込み API は現行値に対するコマンド。UI は後続 |
| 古い端末項目 callback | 端末項目だけ採用して共有項目を再投影。別 Project ID は拒否 |

既存 `isSharedProject` は旧共有リンクの表示状態。新 attachment の判定に使わない。
旧クラウドと新共有 session の併用は拒否。開始・招待・presence・provider の App
ライフサイクル接続は第8回。実 App 試験では共有 record をハーネスで生成する。

## Undo/Redo と active slot 補完

Yjs **13.6.33** 固定。session の Symbol origin のみ、captureTimeout=0、
ignoreRemoteMapChanges=false。短時間の別操作を混ぜず、IME は確定時1操作。
remote・初期化・投影・他端末の同じ本人の操作は履歴外。履歴はセッション内のみ。

- A:0→1、B:1→2 の後の A Undo は B の2を守る。
- A が146人を移動、B が1人を変更: 145人を戻し、Redo も戻った部分だけ。
- 二重削除の一方を Undo: 他方の墓標が残る。
- 同時メモ Undo: 自分の文字だけを戻し、他者の文字を残す。
- 相手が要素を削除した後の名称・座標 Undo: 無効参照は画面上変化なしとして返す。

結果は `empty | applied | partial | blocked`、consumedOperations、attempted/changed/skipped。
Yjs が上書き済み履歴を飛ばして古い操作も消費する場合、その全対象を返す。説明表示は第8回。

同時 map overwrite により Yjs が以前の active を復活できず、要素が消える場合がある。
deleteFilter で古い slot を保持し、現在勝っている自分の active が消されるときだけ、
記録した以前の active を**その Undo transaction 内**で補う。他者の現在 active は上書きしない。
新しい履歴の補完を優先し、Redo 用の逆参照も記録する。投影による slot 選び直しはしない。
双方の大小 clientID と繰返し Undo/Redo を試験する。この補完、Edge の隠れた内容検査、
メモの Item 区間は固定 Yjs 内部構造に依存するため、更新時は wire/Item/Undo 契約を再確認する。

## Y.Text textarea / IME

compositionstart の元の文字 ID と RelativePosition を記録。合成中は DOM draft を保ち、
Y.Text はリモート更新を受け続ける。compositionend で元の ID 区間だけを削除し、
anchor に確定文字を挿入する。他者の挿入・置換文字を消さず、後続の重複 input を抑止する。
通常のリモート更新では RelativePosition で caret/selection を復元する。
surrogate pair を分断しない。長い削除は Item 区間を照合し、文字ごとの全文走査を避ける。
DOM 試験2件、同時入力・置換・emoji・6万文字の削除/Undo を確認。
実 iPad Safari の日本語キーボードと合成中の scene 切替・削除は第8回の実機確認事項。

## Edge / 保存 / Swift

Map/Array/Text と閉じた有限 JSON のみ。割当前の bounded wire scanner と gc:false で、
可視値だけでなく削除・隠れた Item も検査。XML/subdoc/formatting/未知 root/field/型不正を拒否。
entity の必須項目、グループ所属コンテナ、orders の slots/active と active の参照先も検査する。
tuple key の wire 上限2048 bytes、各構成 ID は従来255 UTF-8 bytes。
update 256 KiB、snapshot 8 MiB、log 4 MiB、各4096 entry、members 500、scenes 200、
positions/構造の論理数100000、clients 1024、検証1秒。メモ65536 UTF-16文字。
履歴/旧 slot も quota を消費する。長期間の世代切替・圧縮は後続。

SQL 新規 default=2、check=1/2。Edge create は2のみ、append は DB schema と内部 metadata の
一致を確認する。契約 fixture は全写像2、2 writer の独立 update。旧 fixture は
`collaborationSchema1.json` に保管。ネイティブは bytes を不透明に保存する境界を維持。
Swift 変更は schema 1/2 受理、未来 schema 拒否試験を99へ変更、テスト raw 接続の
foreign_keys=ON のみ。上限値・保存形式・bridge は変更なし。

Swift 自己レビュー: 新規同名変数なし、混在/空リテラルの明示型を維持、throwing call は
XCTUnwrap の前に評価。新しいパス比較なし。全 DELETE 前に raw helper で foreign_keys=ON。
**macOS コンパイル/XCTest、iPad 実行は未確認**。Claude が既存手順で確認する。
**PostgreSQL/Deno の Linux CI は未確認**。Claude が push 後に確認する。
Windows Vitest の supabase/ handler と offline preflight は SQL 実行の代用ではない。

## 第7回・第8回へ

第7回: 招待・メンバー管理・文書/参加世代・作成者だけの共有文書削除・アカウント削除。
ローカル削除とサーバー削除を区別する。schema 2 の作成/参加は同じ初期 bytes を使い、
再参加で古い outbox の binding を付け替えない。slot/墓標の quota と世代切替では
checkpoint と切断端末の救出を先に扱い、ID を勝手に再生成しない。

第8回: 開始/招待/メンバー/presence UI、provider 起動停止/wake、保存・資格失効表示、
partial/blocked Undo 表示、song descriptor と端末音源対応、IME 実機確認、明示 restore/import。
意図的復元の checkpoint/確認表示が必要。session を Project JSON から再生成しない。
live drag は未送信。確定1 transaction と自分の drag geometry 保持を維持する。

## 検証記録

Windows/Node/隔離 Chromium。本番接続なし。既存5179を起動停止していない。
指定検査と計測の最終結果を以下に記録する。

- `npm test -- --maxWorkers 2`: 最終コードで2回連続成功、各82ファイル/697試験。
- `npm run typecheck`、`git diff --check`: 成功。
- `vite build`: 検証済み workspace 一時フォルダへ出力し削除。通常 main=459376 bytes /
  gzip=135672 bytes。通常 editorSession=16820、persistence/Yjs=107493、saveSession=2743 bytes。
- `node scripts/check-collaboration-bundle.mjs`: 成功。通常起動の静的 graph に共同編集/Yjs なし。
  provider を含む dynamic probe は editorSession=16783、persistence=109302、runtime=11492、
  saveSession=2680 bytes。既存 Supabase SDK 依存 chunk=204358 bytes。harness/testing 混入なし。
- `node scripts/test-collaboration-provider-browser.mjs`: 9シナリオ成功、2専用DB削除・mock停止。
- `npm run test:repository:browser`: 契約50手順、移行30ケース、共有CAS、原子性/破損/復旧、
  52専用DB、2ページCAS、200/1000件計測が成功。
- `node scripts/test-app-storage-browser.mjs`: 通常保存・ZIP・音源・GC・復旧の a〜l 成功。
- `node scripts/test-build22-browser.mjs`: stage/parade の各12寸法、drag・選択・pinch・
  scene view・146人画像・長い一覧が成功。
- `node scripts/test-collaboration-app-browser.mjs`: 実 App の schema 2 読込、編集入口保存、
  別 writer の座標を守る CAS、キーボード Undo、再読込が成功。本番通信なし。
- `node scripts/check-collab-v2.mjs`、`node scripts/check-native-repository.mjs`: 成功。
  ただし Linux の SQL/Deno 実行、macOS の Swift 実行ではない。

`node scripts/bench-collaboration-project.mjs`: 匿名146人×18シーン、Windows/Node、12試行。
数値は core コマンドの測定で、App の React 描画・Repository I/O・iPad・実 Edge を含まない。

| 処理 | median ms | p95 ms |
| --- | ---: | ---: |
| 初期化（全構造検証込み） | 24.071 | 50.053 |
| 1メンバーの1操作（入口 compiler＋transaction） | 0.468 | 2.394 |
| 投影 | 7.851 | 10.700 |
| リモート適用＋投影 | 7.196 | 11.147 |
| server validator | 43.759 | 62.321 |

初期文書174383 bytes、1操作 update=38 bytes、操作後174411 bytes。
中断前の初期化7.9msとの差には、作成時の全構造検証追加が含まれる。時間は保証値ではない。
長期間の slot/墓標/履歴増加時、実 iPad の IME/性能、実 Edge の1秒/メモリは別途確認が必要。

最終確認の branch は `codex/ipad-release-20261002`、HEAD は `f3b9460`。
依頼に記載された `9aeb8eb` の後に既存の第5回 Swift 修正 `c49fd5f` / `f3b9460` がある。
この作業では commit しておらず、既存の修正履歴を保持した。

変更ファイルの主なまとまり:

- `src/collaboration/`: projectSchema / projectModel / recipeCommands / editorSession /
  notesAdapter / serverSchema2 を追加、model / commands / projection / persistence /
  runtime / provider / transport / serverValidation を更新。schema 1 は legacyModel /
  legacyServerValidation に分離。fullProject と既存競合・Edge 検証の試験を更新。
- `src/App.tsx`、`src/components/SceneNotesPanel.tsx` とその DOM 試験、
  `src/storage/saveCoordinator.ts`: 編集入口・stale 防止・IME・保存境界。
- `src/repositories/`: attachment の documentSchema 1/2、契約 fixture と契約/native 試験。
- `supabase/functions/collab-ingest/handler.ts` と試験、未適用 foundation migration。
- Swift の `CollaborationValidation.swift` と `CollaborationTests.swift` の最小変更。
- `scripts/`: 実 App 試験、全写像 benchmark、runtime/Edge のローカル loader、
  provider/IndexedDB 試験・native preflight・旧 server benchmark の schema 整合。
- この文書と既存の STORAGE / PROVIDER / NATIVE_STORAGE / SERVER / README に現行契約への参照。

検証対象外のファイル・操作: Project 型、ZIP 形式、PrintPreview、dist、依存、
既存 `.tmp-vite-https.config.mjs` は変更なし。install / commit / push / gh / workflow 実行なし。
本番 Supabase、本人ブラウザー profile、音源本体・秘密情報を使わない。
