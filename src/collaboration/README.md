# 共同編集モデル — 第1回

第2回のRepository/coordinator統合、付属JSON契約、上限、圧縮、GC判断とSwiftへの引継ぎは
[COLLABORATION_STORAGE.md](../../docs/COLLABORATION_STORAGE.md)を参照。以下は第1回のモデル設計。

1 Project = 1 Y.Doc。今回はシーン／メンバーの存在と確定座標のみを扱う。
App、Canvas、Repository、保存 coordinator、クラウド、Swift、ZIP、Project 型は接続・変更していない。

## 責任の境界

| 層 | 責任・今回の状況 |
| --- | --- |
| 同期モデル (`model.ts`) | CRDT schema、作成、参加時の検証。今回は存在・座標のみ |
| 編集コマンド (`commands.ts`) | 確定した編集を1 transactionへ変換、セッション内 Undo/Redo |
| 投影 (`projection.ts`) | Y.Doc の座標を既存 Projectへ投影。他の項目は端末側 baseを保持 |
| Repository | 文書状態、journal、outbox、cursor と Projectの原子的保存。第2回 |
| provider | 認証、取得、再送、cursor、ACK、接続管理。未実装 |
| 一時表示 | presence・最大3Hzの差分 live drag・混雑時Bへの切替。未実装 |
| サーバー | 認可、schema／容量検証、採番、snapshot、共有文書作成の一意性。未実装 |

`testing/memoryTransport.ts` は配送操作を制御できる試験用。更新イベントを直ちにキューへ入れるため、
端末 commit 後に送る実 providerの代わりには使えない。サーバーや保存の安全性を試験するものでもない。

## Schema v1

```text
metadata: Y.Map { schemaVersion: 1, projectId: string }
members: Y.Map<memberId, Y.Map<フィールド>>   // 今回は空レコード = 存在
scenes:  Y.Map<sceneId, Y.Map<フィールド>>
  positions: Y.Map<memberId, { x: number, y: number }>
```

座標は有限な内部座標の `{x,y}` 一値。表示方式への変換、ステージ／パレード境界への clamp はしない。
x と y を分けず、他メンバーの座標を巻き込まない。座標なしのメンバーも存在できる。
同じメンバーの因果関係のある後の変更は反映される。同時変更の勝者は CRDTの決定規則であり、
端末時計、サーバー到着順、指を離した時刻による後勝ちではない。

次回以降、メンバー／シーンの Mapへフィールドを追加できる。ただし schema変更は互換性判定を伴わせる。
順序は別 rootの `memberOrderSlots` / `sceneOrderSlots: Y.Array<{elementId,slotId}>` と
`memberActiveSlots` / `sceneActiveSlots: Y.Map<elementId,slotId>` を想定する。
投影は active slotに一致する生存要素を一度だけ出し、古い slotは Undo・切断中更新のため保持する。
削除は別 rootの `deletions: Y.Map<JSON.stringify([entityType,entityId,deleteOperationId]), true>` を想定する。
有効な墓標が一つでもあれば投影対象外。移動で墓標を解除しない。自分の削除の Undoで他者の墓標を消さない。
今回は順序／削除の編集APIを作らず、baseの順序を保持し、存在集合が違う投影は拒否する。
道具の geometry一値と表示/zIndex、メモ Y.Text、関連単位の所属／割当は後続回で実装する。

## 初期化は作成者だけ

```ts
import { loadCollaboration } from "./collaboration";
const runtime = await loadCollaboration();
// 作成者だけ: 既存の正規化済み Projectから一度生成し、そのバイナリを登録する。
const creator = runtime.createSharedDocument(normalizedProject);
const state = runtime.encodeStateAsUpdate(creator);
// 参加者: 同じ Project JSONから新たに生成しない。
const participant = runtime.joinSharedDocument(state);
const commands = new runtime.CollaborationCommands(participant);
commands.moveMembers([{ sceneId, memberId, position: { x, y } }]); // 確定時のみ
const projected = runtime.projectSharedDocument(participant, localProject);
// セッション終了時に commands.destroy(); participant.destroy();
```

作成関数は新しい文書を返すため、既存文書の再初期化をしない。参加関数は Projectを受け取らない。
ただしプロセスをまたぐ「一度だけ」はこのAPIだけでは保証できない。
第2回以降、安定した共有文書ID／作成 operationIdと CAS／一意制約で登録を一度にし、再試行時は登録済み状態を読む。
`Project.id` は投影対象の照合用であり、Y.Docの clientID／origin／guidを認証情報にしない。

作成前に呼び出し側で既存正規化を済ませる。未知参照・重複ID・非有限座標は自動修復せず拒否する。
投影は ID集合と schemaを確認し、座標以外（`sceneViewState`、focus、perspective、音源ID、時計、未知フィールドを含む）を
baseから保持する。投影中に normalizeや時刻生成を呼ばず、baseと Y.Docを変更しない。
今回は全 Projectを復元できる文書ではなく、同じ文書の完全な Project baseが別途必要。

## コマンドと Undo/Redo

移動は配列全体を先に検証し、入力座標をコピーする。Yjs transactionにはロールバックがないため、
検証の例外で半分だけ移動しないようにする。同じ座標の移動は書かず、Redoを消さない。
originはコマンドインスタンスごとの Symbol。`trackedOrigins` はその originだけ、`captureTimeout: 0` で
短時間の別操作もまとめない。初期化、remote、originなしの書き込みは履歴に含めない。
UndoManager自身のoriginは Yjsが逆操作の履歴用に追跡する。

Y.UndoManagerの `ignoreRemoteMapChanges: false` を維持し、他者が上書きした座標を復活させない。
手動で以前の Projectを書き戻す方式は使わない。
`undo()` / `redo()` は `status: empty | applied | partial | blocked`、消費した操作数、
対象一覧 `attempted`、実際に座標が変わった `changed`、変わらなかった `skipped` を返す。
結果は呼び出し前後の可視座標の比較であり、未配送の他者更新まで先読みして保護する保証ではない。
部分Undoの Redoは実際に戻った対象だけを結果の対象にする。

Yjs標準動作では完全に上書きされた履歴を飛ばし、さらに古い戻せる操作を一度の呼び出しで戻す場合がある。
内部stackを書き換えてこの挙動を変えず、消費した全操作と対象を結果に含める。
後のUIは `consumedOperations > 1` と `partial/blocked` を利用者に知らせること。
未送信状態は第2回の journal/outboxに残すが、Undo履歴はこのセッションだけで、再起動をまたぐ保存は今回しない。

仕様の参照: [Yjs UndoManager](https://docs.yjs.dev/api/undo-manager)、
[Document updates](https://docs.yjs.dev/api/document-updates)。固定依存13.6.33の実装と試験で保護動作も確認する。

## テスト・バンドル

`collaboration.test.ts` は2–5文書、逆順、重複、遅延、欠落後state-vector再送、
同時移動、remote／echo、単一・146人部分Undo、Redo、既存匿名fixtureの正規化後往復を試験する。
`projects.json/large` の146人×18シーンを使い、初期化／1メンバーの1回移動／投影の実行時間と
`encodeStateAsUpdate` のバイト数を出力する。時間は参考値で、閾値テストではない。
バイト数はバイナリ状態の容量であり、JS heapの使用量ではない。

アプリは `index.ts` の `loadCollaboration()` だけを importする。型は `import type`で参照できる。
`runtime.ts` 以下の Yjs静的importはこの動的境界の内側。テストは直接importしてよい。
`node scripts/check-collaboration-bundle.mjs` は既存設定で通常 Vite buildと動的ロードprobe buildを作り、
通常mainの静的依存に共同編集／Yjsが含まれず、probeの静的依存に Yjsが入らないことを module graphで確認する。
通常mainと実際の追加chunkのraw/gzipバイト数を出力し、一時ディレクトリをfinallyで削除する。
第2回からRepository/coordinatorの条件付きdynamic importによって追加chunkは出力されるが、共有経路を呼ぶまでロードしない。

## 第2回への申し送り

- 文書snapshot＋journal＋durable outbox＋受信cursor＋同世代 Project投影を、一つの CAS付きRepository commitへ含める。
- ローカル Yjs更新イベントはメモリの編集を観測しただけ。commit完了前にネット送信／送信済み扱いをしない。
- 送信／ACKと受信cursorを区別し、重複・削除だけのupdate・クラッシュ・再試行・複数タブを試験する。
- `joinSharedDocument` は完全状態の読み込み用。以後の差分適用は `applyUpdate(doc, update, REMOTE_ORIGIN)`。
  未対応schema・不正参照・容量超過を受信境界／サーバーで検証し、不正更新を生きた文書に先に適用しない。
- Repository schema／IndexedDB／Swiftの不透明バイナリ保存契約、復旧・バックアップ検証も合わせて設計する。
- 正規化は取り込み時に済ませる。旧データの孤立座標がある場合、今回の作成APIは拒否するため、明示的な取り込み方針が必要。
- 最大8 distinct user、無料枠、ゲスト参加、アカウント削除時の共有文書削除、live drag方式の第10回判断は維持する。
