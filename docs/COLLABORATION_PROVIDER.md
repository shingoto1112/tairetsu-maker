# 新しい共同編集 第4回：provider の縦切り

対象は schema 1 のメンバー座標。App/UI・Swift・旧クラウド・SQL/Edge は変更しない。
本番 Supabase は未適用・未配備のまま。全通信試験は使い捨てローカルモック。

## 入口と状態

`await loadCollaboration()` の後に `CollaborationProvider` と `createSupabaseTransport` を生成する。
設定は既存 `CloudConfig` の URL/anon key を引数で注入し、認証サービスが
`credential(signal) -> {accountId, accessToken} | null` を提供する。
provider は sessionStorage、Keychain、環境変数を読まない。旧 session/auth の読取・更新責任を移さない。
既存の期限確認・refreshSession・保存サービスを将来の呼出元が使い、更新完了後に `wake()` する。
異なるアカウントでは文書の pull も止める。refresh token は transport に渡さない。

```text
start -> durable attachment 読込 -> 認証・参加資格確認
      -> pull lane: ページ取得 -> 検証/適用 -> 端末commit -> cursor更新 -> 次ページ
      -> send lane: durable outbox取得 -> 参加資格確認 -> ingest -> ACK検証 -> ACK端末commit
network/429/503/HEAD_CONFLICT -> backoff -> 同じ要求
auth/permission/capacity/generation/validation/storage -> 該当lane保留 -> 明示wakeで再試行
offline/stop -> HTTP abort、購読解除、timer停止 -> 復帰/再起動でdurable stateから再開
```

2 lane は独立している。ACK待機中も受信・ローカル操作を続けられる。
`subscribe(listener)` は現在値も即通知し、解除関数を返す。
状態は `online`（端末ネットワーク状態）、`realtimeConnected`、`syncing`、
`pending`（commit済み未送信数）、`held`、`cursor`（端末commit済みseq）、`error:{kind,code}`。
online=trueはサーバー到達保証ではない。未commitの編集数はSaveCoordinatorのdirty表示で補う。
`error` は送信失敗優先、次に受信失敗を示す。正常なpullで送信エラーを消さない。
1 provider は1つの active coordinator session を所有する。文書切替時はstopして新しいproviderを作る。
listener例外は同期処理を中断しない。遅れたACK・購読callbackはepoch/active IDで無効化する。

## 送信と再送

`getSendableOutbox()` の保存済みpendingだけを使い、ID/bytesは生成し直さない。
送信元はY.Docのupdate eventではない。呼出元が確定操作を保存し、flush成功後にwakeする。
ACKはHTTP成功に加えdocumentId/generation/updateId/正の十進文字列seq/duplicateを検証する。
Realtime通知・Realtimeの送信ACKは永続ACKではない。ACK保存失敗時もdurable pendingを残す。
DB commit後の応答消失は、再起動して同じID/bytesを再送しサーバーreceiptで重複排除する。

HTTPは15秒でtimeout。ネットワーク断・429・503・HEAD_CONFLICTは、基準500msの指数backoff
（基準最大30秒、0.5〜1.5倍のjitter）とRetry-Afterの大きい方を待つ。
低頻度poll・追加wake・通知では予約済みbackoffを飛ばさない。
MISSING_DEPENDENCIESはpullを要求し、先行outbox順を維持して固定要求を再送する。
VALIDATION_BUDGET、未知schema、不正更新、容量、世代違いは自動無限再試行しない。
ローカル座標・dirty・pendingは削除しない。文書世代切替は第7回の明示手順へ残す。

## 受信・cursor・購読

第3回の `collab_v2_get_updates(p_document,p_generation,p_cursor,p_limit=32)` を使う。
bigintは十進文字列のまま扱う。pageのdocument/schema/generation/bytesとseq連続性を確認する。
通知の重複・順序逆転・古いACL/文書世代は無害なhintとして無視する。
headだけでcursorを進めず、snapshotのuptoSeq＋適用したページ最後のseqだけをcommitする。
投影・CRDT・cursor・outboxは同じSaveCoordinator/Repository transactionで保存する。
受信commit失敗時はdirty状態を保持し、明示retryで先にflushしてdurable cursorを読み直す。
snapshotは8MiBまであり、256KiBの通常update/journalへ入れず、
`receiveCollaborationSnapshot()` で既存CRDTへ統合してbaseを保存する。未送信更新を保持する。
同じsnapshotで状態/cursorが変わらなければ保存revisionを増やさない。
一回のpull処理は最大8ページで一度yieldし、残りは次turnへ渡す。

Realtimeはprivate channelの `broadcast/update` を受信するだけ。
[private channelの公式契約](https://supabase.com/docs/guides/realtime/authorization)に従い、SDK購読をprivateに限定する。
RPCのtopic/ACLまたはaccess tokenが変わると再購読する。購読成立後にもpullして取得とjoinの隙間を埋める。
切断した購読を廃棄し、次pollで作り直す。通知欠落は30秒poll、online、foreground復帰で回復する。
head専用RPCは第3回にないため、低頻度確認も同じ認可済みpullを使う（変更なしなら小さい応答）。
auth失効は認証更新後のwake、permission失効は利用者の再参加・資格確認後のwakeが必要。

## 参加世代と保存互換性（第5回の重要事項）

第2回attachmentに任意のフィールドを追加した。Project/ZIPは変更しない。

```json
"transportBinding": {
  "accountId": "認証済みuser UUID",
  "membershipGeneration": "参加時のUUID"
}
```

フィールドなしの旧schemaVersion=1 attachmentは読めるが、自動送信しない。
共有作成/参加の成功後、**最初の共有attachment commit** に資格情報を含める。
作成前のsharedDocumentId=nullからは `bindSharedDocument(id,binding)` で原子的に設定可能。
既に共有済みのattachmentではbindingの追加/書換え/削除を拒否する。
この制限により、再参加で古いpendingに新しい資格を付け替えられない。
同じattachmentの新しい編集も保留する。再参加後の採用/独立コピーUIは第8回の明示操作へ残す。
旧データへの自動資格付けはしない。独立コピーを作るときは新ID・新Y.Doc・新attachmentにする。

get_updatesはmembershipGenerationを返さない。新SQLを変更する代わりに、
認可付き `collab_v2_members` SELECT（document_id/user_idで絞り、membership_generationのみ）で確認する。
認証済みcredentialとdurable bindingが一致し、現在の参加世代も一致するときだけ送信する。
確認とappendの間に解除される競合はEdge/DBの世代確認で拒否する。
同じuserの再参加では受信は可能、古いoutboxはheld。アカウント不一致/資格情報なしは受信も保留。
topic/ACL変更だけでは参加世代を付け替えず、現在世代一致なら通常送信を継続する。

Swiftは引き続き共有schema未対応。第5回は任意bindingのUUID検証・保存・前世代・CRC/digest・復旧backupを
base/journal/outbox/cursorと同じSQLite COMMITで扱う。binding不変条件と旧field省略fixtureも検証する。
ID/bytes、sent tombstone、cursor単調増加、同じY.Docへのsnapshot統合を保つ。
bridgeはHTTP/任意SQL/任意パスを受理せず、端末commit成功以降だけ送信可能にする。

第8回UIは、保存coordinatorのchanged通知からprojectProjectionを表示へ反映し、保存失敗を可視化する。
編集用の既存Y.Docへdurable CRDTをREMOTE_ORIGINでapplyし、Projectから作り直してUndoを失わないこと。
確定編集は固定update -> editCollaboration -> flush -> wakeの順とし、providerのpendingだけで
「端末保存済み」を判断しない。認証更新/招待再参加の成功後はwakeし、held時の内容採用/独立コピーを明示する。

## 試験と境界

`scripts/testing/mock-collab-server.mjs` はSQLのseq/MVCCページ/receipt/ACLを独立に模したoracle。
HTTP ingestは第3回の**実際のEdge handlerとYjs validator**をtranspileして使用する。
契約試験は同じappend入力に対するACK/duplicate/資格失効/容量/世代/ページ出力とSQLの対応式を確認する。
通知・遅延・逆順・欠落・429・切断・ACK消失はモックで制御する。
Realtimeの試験配送はSSEで、Supabase WebSocketのwire protocol/RLSを再実装するものではない。
モックは既存共有文書のappend/pull縦切り専用。create/invite UIは今回の試験対象外。

`node scripts/test-collaboration-provider-browser.mjs` は既存5179のViteを起動/停止せず使う。
2つの新規Chromium contextとランダムIndexedDBを使用し、モックHTTPは試験内でloopbackの空きportに起動する。
通信は5179とそのportのみ許可。本番URL/シークレット/本人browser profileを読まない。
試験用inert HTMLはPlaywright routeで提供し、harnessはDEV専用TSをdynamic importする。
Chromiumのlocal-network-access許可は隔離contextの5179 originだけに付ける。
通常production全chunkとdynamic probeをbundle検査し、harness/testingの混入を拒否する。

未確認：実Supabase JWT refresh/失効、RealtimeのRLS/認可cache/topic再join、gateway/CORS/Retry-After、
Edgeの実時間・メモリ、members SELECTの実サービス権限、iPad foreground/OS強制終了・Swift保存。
公開前は第3回の旧API匿名拒否、CAPTCHA既存ログイン対応も必要。今回は本番smokeを行わない。

## Windowsでの確認（2026-10-04）

- provider/契約追加試験19件成功。最終コードの全npm testを2回、各80ファイル/660件成功。
- 2ブラウザーの最終版を2回実行し、9シナリオすべて成功。各回2専用DB削除・モック停止を確認。
- typecheck、Repository実IndexedDB契約/移行/共有CAS、App保存回帰a〜l成功。
- bundle検査は通常buildとdynamic probeを一時フォルダへ作成し、削除。
  通常mainは456,313 bytes / gzip 134,736 bytes。共同編集/Yjsは通常起動graphに存在しない。
  dynamic graphは共有依存も含め315,670 bytes / gzip 89,334 bytes。
  内訳に既存Supabase SDKの依存chunk 204,358 bytes / gzip 53,189 bytesを含む（新依存追加なし）。
  provider/harnessはAppへ接続していない。旧src/cloud・SQL/Edge・Project/ZIP・ios/・依存を変更していない。
- Windows sandboxのesbuild親ディレクトリ探索エラーは、許可済みローカルテスト/buildを通常権限で再実行。
  本番接続、シークレット読出し、install、commit/push、gh/workflow実行は行っていない。
