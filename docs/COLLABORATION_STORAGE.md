# 新しい共同編集 第2回：端末保存契約

第6回の documentSchema=2 / 全投影一致検査 / App 接続は
[COLLABORATION_PROJECT.md](COLLABORATION_PROJECT.md)。以下の schema 1 表記は第2回の記録。

第4回のprovider・任意transportBinding・snapshot受信保存APIの追加契約は
[COLLABORATION_PROVIDER.md](COLLABORATION_PROVIDER.md) を参照。第5回Swiftへ合わせて引き継ぐ。

編集担当はCodexのみ。App/UI・Swift・クラウド・Project型・ZIP形式は変更しない。
第1回と同じ座標だけの縦切りであり、全ProjectのCRDT化は第6回、UI接続は第8回。

## JSON契約と原子性

`ProjectRecord` / `CommitRequest` の `collaboration` は省略/nullが独立文書。
`sync` は個人同期の予約領域として引き続きnullを要求し、共同編集に流用しない。
共有中は毎commitに完全な付属データを明示する。黙ったdetachはCONFLICT。
独立コピーはProjectだけを新ID/create-only commitする。

```text
collaboration.schemaVersion: 1              保存付属データの版
sharedDocumentId: string | null             サーバー作成前はnull
documentSchema: 1                           第1回の座標schema
generation: 十進文字列                      文書世代、初期値"1"
base: canonical base64                      Y.encodeStateAsUpdateのV1完全状態
journal: [{updateId, bytes, source: local | remote}]
outbox: [{updateId, bytes, status: pending | sent}]
serverCursor: 十進文字列                    適用・保存済みseq、初期値"0"
```

ここでのsnapshotは再起動可能なstate update。`Y.snapshot()`は単独で復元できないため使わない。
bytesとIDは生成時に固定する。同じID/異なるbytes、ACKの巻戻し、cursorの減少、
既存共有ID/文書世代の変更、outboxの削除を拒否する。世代切替は第7回の明示手順へ残す。
journalのlocal更新には同じID/bytesのoutboxが必須。outboxの全bytesが復元状態に含まれること、
座標投影の一致、以前のCRDT状態を欠落させないことをYjsで確認する。
未知schemaはUNSUPPORTED_SCHEMA、不正入力はINVALID_ARGUMENT、不整合遷移はCONFLICT。
読込時はProjectと付属JSONをそれぞれUTF-8長/CRCで検査し、破損をCORRUPTにする。
CRCは認証ではない。サーバーでの認可・binary内容検証は第3回に必須。

IndexedDB DB versionは3、共有bodyだけschemaVersion=2。独立bodyは従来の1。
付属データをbodyへ格納するためProject・付属・前世代・summary・CAS版・receiptが同一transaction。
SHA-256要求digestに付属データも含め、transaction complete後だけreceiptを返す。
v1/v2→v3は不足storeを作成するだけで既存body・summary・receipt・移行台帳を再符号化しない。
共有の前世代には同世代の付属データも保持する。

## 上限とローカル圧縮

- 1 updateのdecoded bytesは256 KiB、baseは8 MiB、base+journal+outbox合計16 MiB。
- 付属JSONのUTF-8全体は24 MiB、journal/outboxそれぞれ4096件まで。sentも含む。
- canonical base64、ID規則、完全なフィールド集合を検証する。Swift bridgeはこのJSONを扱う。
- journalが128件またはdecoded 1 MiBで、完全に復元したY.Docを新baseへまとめ、journalを空にする。
- outboxはpending/sentとも圧縮で消さない。cursorと世代も変えない。
- 依存不足の更新を含む状態は圧縮/保存しない。第4回providerは欠落更新をpullしてからcursorを進める。

ドラッグ途中のlive通信をこのjournalへ高頻度保存する用途ではない。確定操作単位で保存する。
上限はQUOTA_EXCEEDED。既存保存と同じくcommit失敗時の編集・固定要求を保持し、同じoperationを再試行する。
入力受付の上限/不正データ拒否でも呼出元Y.Docを変更しない。UIが自身の編集を巻き戻してはいけない。
ACK tombstoneを無制限にためないための安全な回収・容量計測は第9回。今回自動削除しない。

## coordinator

既存SaveCoordinatorの同じ直列キューを使用する。共有は`editCollaboration`に固定更新と任意cursorを渡す。
自分の更新はjournalとoutbox、受信更新はjournalだけへ追加し、投影と一緒にcommitする。
共有でProjectだけの`edit`は拒否し、二つの編集正本を作らない。
CAS競合時は保存済みbase+journalを復元して手元のCRDT状態をapply、outboxをIDで併合、
durable sentと最大cursorを保持して再投影する。新しいCAS版/operation/localRevisionで再保存。
非座標フィールドは最新の保存済みProjectから保持する。未対応の構造変更を独自にマージしない。
競合は1flushにつき最大8回。超過/別世代/破損でも画面用投影・dirtyを保持し、手動再試行可能。
`projectProjection`で統合済み投影を取得できる。未接続UIの自動更新は今回行わない。

`getSendableOutbox`はRepositoryの読込だけを使い、共有IDが確定したdurable pendingだけ返す。
`bindSharedDocument`は作成APIの返した共有IDを同じキューで保存する。
`markOutboxSent`は保存済みID/bytesのみACKを受理し、その状態を再commitする。
送信処理はない。第4回はこのAPIの後に資格/世代を再確認し、固定ID/bytesを送る。
複数タブが同じoutboxを送る可能性はあるため、第3回サーバーの永続idempotencyが必須。
Realtime受領をACKとみなさない。再起動をまたぐUndo履歴は保存しない。

## 周辺の扱い

通常ZIP・手動全件バックアップは既存Project+音源だけの経路を維持し、付属データを含めない。
復元候補/前世代救出/複製は新IDのProjectだけを保存し、元の付属データを引き継がない。
音源GCはcurrent/previous/移行・復元候補を従来どおり検査する。
ただし共有CRDTの不透明な履歴にはまだ端末音源参照契約がないため、currentかpreviousに共有付属データがあれば
GC全体を延期する。内容をID文字列の推測で解析して誤削除しない。第6/8回でdescriptorと端末対応表の参照範囲を定義する。

第5回でSwift schema2のJSON bridge・SQLite原子保存・前世代・復旧DBバックアップの検査を実装した。
詳細とmacOSの検証引継ぎは [COLLABORATION_NATIVE_STORAGE.md](COLLABORATION_NATIVE_STORAGE.md) を参照。
旧schema1 pluginへの共有commitは引き続きUNSUPPORTED_SCHEMAで拒否する。
復旧DBバックアップは通常ZIPとは異なりCRDT/outboxを保持し、復旧後の資格確認前に送らない。
任意SQL/任意パスを受理するAPIは追加しない。旧3種fixtureは変更せず、
`contract/fixtures/collaboration.json`をSwift schema2用の追加fixtureとする。

## 検証と次回

共通runnerはVitest/実IndexedDBでCAS統合・cursor・ACK・再読込・圧縮・上限・不正schemaを検証。
ブラウザはprevious/body/summary/receipt/access故障注入で全store不変、v2→v3の全record不変、
2接続/2ページで双方の座標/outbox保持も検証する。非共有の既存契約・App保存回帰も実行。
第3回は新SQL/ingest・seqを文書ロック内で採番・ID/bytesの永続重複判定・Linux Postgres試験へ進む。
最大8人・無料枠・ゲスト参加・作成者のみ削除の既決定を維持する。
上限近辺のメモリ/実WebView2・iPad・強制終了・実ネット通信・Swift XCTestは今回の試験範囲外。

## Windowsでの検証記録（2026-10-04）

- 最終コードの `npm test -- --maxWorkers 2` を2回：各77ファイル/616件成功。
- `npm run typecheck`、`git diff --check` 成功。
- `npm run test:repository:browser` 成功。契約50手順、移行30ケース、共有15シナリオ、
  原子性故障注入、2接続/2ページCAS、v2→v3不変と破損DB拒否、200/1000件計測。
  52専用DBと2ページ用DBを削除。1000件の非共有warm commit p95=48ms（50試行）。
- `node scripts/test-app-storage-browser.mjs` はa〜l成功。従来の非共有保存・音源・ZIP・全件バックアップ・GC・復元を維持。
  試験内の旧DB version=2固定を外した。既存dev serverの起動/停止はしていない。
- `node scripts/check-collaboration-bundle.mjs` は既存設定の通常Vite buildとprobe build成功。
  main=455,791 bytes、gzip=134,629 bytes。mainの静的module graphに共同編集/Yjsなし。
  probe追加chunkはsaveSession=1,632 / persistence+Yjs=89,774 / runtime=2,734 bytes。
  一時フォルダを削除し、distを変更していない。
- `node scripts/check-native-repository.mjs` 成功。既存Swift fixture/SQLite SQLの事前検査と
  新しいbase64 fixture・schema1の共有保存拒否を確認。Swift実行/コンパイルではない。
- App.tsx・Canvas・Project型・ios/・旧クラウド・依存・workflowに差分なし。
  commit/push/install/本番操作はしていない。既存未追跡 `.tmp-vite-https.config.mjs` は変更していない。
