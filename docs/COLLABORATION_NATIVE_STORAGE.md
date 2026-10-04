# 共同編集 第5回：iPad SQLite 保存

第7回の [貼付け参加・終了・救出 API](COLLABORATION_LIFECYCLE.md)は既存 bridge を利用する。
Swift・保存形式・共通 fixture は変更なし。新しい端末 alias の commit/再読込は macOS/iPad で確認する。

第6回の最小 Swift 差分（documentSchema=1/2、未来 schema=99 の拒否試験、
raw sqlite3 テスト接続の foreign_keys=ON）と macOS 確認事項は
[COLLABORATION_PROJECT.md](COLLABORATION_PROJECT.md)を参照。byte 上限・bridge は変更していない。

基準は [保存契約](COLLABORATION_STORAGE.md) と
[provider の binding 契約](COLLABORATION_PROVIDER.md)。App/UI、Project 型、ZIP、
サーバー、旧クラウド、依存、Info.plist、CapApp-SPM は変更しない。

## schema 2 と移行

SQLite `user_version=2`。body の `schema_version=1` は従来の Project JSON の
符号化版として維持する。IndexedDB の body envelope の版とは独立した実装詳細。
`project_bodies` / `project_previous` に次の nullable 列を追加する。

```text
collaboration_json          完全な付属 JSON（base/journal/outbox は canonical base64）
collaboration_byte_length   JSON の UTF-8 長
collaboration_crc32         JSON の CRC-32
```

独立文書では3列とも NULL。読み出し時に長さ・CRC・形式を検査する。
共有情報を個人同期へ混ぜないため、`sync_json IS NULL` と空の `personal_sync` の
検査は維持する。バックアップの schema 検査には追加列も含める。

`BEGIN IMMEDIATE` 内で schema 1 の構造を検査し、両テーブルに ALTER TABLE、
`user_version=2`、schema 2 検査、COMMIT の順。新規 DB は同じ transaction で
0→1→2 とする。失敗は DDL・version とも rollback。旧本文・前世代・summary・
receipt・移行台帳を再符号化しない。音源には触れない。古い復旧 DB も同じ移行を
通して検査・復元する。未知の DB schema は開き直しや上書きをせず拒否する。

TEXT/base64 を採用したのはテーブル再構築・BLOB 分割を避け、既存 transaction と
前世代コピーを再利用するため。base64 は約33%増で、bridge の文字列コピーもある。
上限近辺の iPad 実メモリ・時間は未測定。第9回の容量計測で BLOB 化を再評価する。

## 保存とブリッジ

固定18操作のみ。任意 SQL、HTTP、パスを受け取る操作はない。
request/response は `{ json: string }`。本文は内部 `json` 文字列、付属データは
内部 `collaborationJSON: string | null`。base/journal/outbox は不透明な base64。
read は同じ付属文字列を返し、TS adapter が Repository の `collaboration` へ戻す。

ネイティブでも update 256KiB、base 8MiB、decoded 合計16MiB、付属 JSON 24MiB、
journal/outbox 各4096件を検査する。Project JSON は24MiB。
外側 request は文字列の再エスケープ分を含む128MiBまで。plugin と core の両方で
解析前に拒否する。これは各 payload の上限を引き上げるものではない。

Swift は形式・ID/bytes・UUID binding・cursor・世代・ACK/outbox 遷移を検査する。
UUID は accountId と membershipGeneration の2フィールドだけ。共有済み attachment に
binding の追加・変更・削除は不可。旧 field 省略 fixture は読めるが自動資格付けしない。

Foundation/SQLite3 だけでは Yjs の内容・投影・依存・状態継承を検証できない。
TS adapter が IndexedDB と同じ既存 Yjs validator を dynamic import して検査する。
現在の CAS 版で読んだ状態の継承を確認し、Swift が transaction 内で CAS を再検査する。
競合時は拒否し、SaveCoordinator が保存済み base/journal/outbox/cursor/sent を読んで
統合・新 operation で再試行する。Swift に独自 CRDT マージは作らない。

Project・前世代・付属データ・summary・revision・receipt を一つの COMMIT で保存。
付属データも SHA-256 要求 digest に含め、キー順の違いは正規化する。
独立文書の付属省略/nullは既存要求 digest を維持する。COMMIT 成功後のみ返答する。
rename/touch は付属データを保持してメタデータを変更する（既存 Web 契約と同じ）。

追加固定操作 `readCommitReceipt` は commit と同じ要求を照合し、保存済み receipt
または null を返す。書き込みはしない。共有 adapter は現在の本文検査より先にこれを
使い、後の本文破損・削除が応答喪失後の idempotent retry を壊すのを防ぐ。
旧 schema 1 plugin は独立文書のみ互換利用でき、共有 commit は呼出前に拒否する。

## 復旧・GC・次回接続

復旧 DB は現行・前世代の CRDT、pending/sent、cursor、binding、receipt を保持する。
復元は既存の候補 DB 検証・接続排他・原本隔離・置換経路を使う。通常 ZIP は変更しない。
binding は履歴上の送信者識別であり、認証済み資格ではない。
資格や送信許可フラグを DB に保存せず、第4回 provider の各 send lane および各 append 前の
credential/accountId/membershipGeneration 確認が成功するまで送信しない。
旧 binding なし・別アカウント・参加世代変更は従来どおり held。

第8回の復元 UI 接続では、復元前に provider を stop し、古い coordinator/Y.Doc/Undo
セッションを破棄すること。復元後は Repository を再読込して新セッションを activate
し、provider を start して資格を再確認する。復元前の CAS 要求を再利用しない。
今回は App に provider を接続しておらず、ネイティブ bridge 自体は送信しない。

音源 GC と旧データ整理は、現行・前世代・保護する復旧 DB のいずれかに付属データが
ある間は保留する。不透明な履歴から音源 ID を推測しない。バックアップだけにある
履歴も保護するため、Web の current/previous 保護より保守的。

第6回は並び順 slot・墓標・Y.Text・割当・移動計画を含む全 Project 写像と App の
編集入口を整える。documentSchema を増やす場合は TS/Swift の許可 schema と fixture
を同時更新する。音源 descriptor と端末対応表の参照範囲は第6/8回で定義する。
schema/文書世代変更、sent tombstone 回収、旧 binding の再資格付けは今回行わない。

## 検証・macOS 引継ぎ

Swift XCTest は既存32件＋共同編集11件＝**43件**を期待する。
`swift test --package-path ios/ProjectRepositoryCore` と既存 ios-build の simulator build を
Claude が確認する。Windows の事前検査は実際の Swift SQL の prepare、ALTER の
rollback/retry、fixture・上限・binding・bridge・試験件数を確認し、Swift コンパイルの
代用にはしない。新規試験の schema 1 作成はテスト内だけ DROP COLUMN を用いる。

自己レビュー：新規の異種辞書と空配列/辞書は型を明示。例外を投げる処理を XCTUnwrap
内部へ入れず、既存 helper の3箇所も分離した。新規試験に全パス文字列比較はない。
Swift core の import は Foundation / SQLite3 のみ。実機の OS 強制終了、保護状態、
上限近辺のメモリ、iCloud バックアップは未確認。

Windows 回帰では provider 試験の初回が並行試験中に ACL 切替後の値確認で失敗した。
単独再実行で全9シナリオ成功、専用2 DB 削除・mock 停止を確認。provider とその試験は
変更していない。この試験は state の cursor/pending を待つため、値反映確認の待機に
改善余地がある（原因の確定は今回の範囲外）。

## 変更ファイル

- `ios/ProjectRepositoryCore/Sources/ProjectRepositoryCore/ProjectRepository.swift`
- `ios/ProjectRepositoryCore/Sources/ProjectRepositoryCore/CollaborationValidation.swift`（追加）
- `ios/ProjectRepositoryCore/Tests/ProjectRepositoryCoreTests/RepositoryTests.swift`
- `ios/ProjectRepositoryCore/Tests/ProjectRepositoryCoreTests/CollaborationTests.swift`（追加）
- `ios/ProjectRepositoryCore/README.md`
- `ios/App/App/ProjectRepositoryPlugin.swift`
- `src/repositories/nativeSqliteRepository.ts`
- `src/repositories/nativeSqliteRepository.test.ts`
- `scripts/check-native-repository.mjs`
- `docs/COLLABORATION_STORAGE.md`
- `docs/COLLABORATION_PROVIDER.md`
- `docs/COLLABORATION_NATIVE_STORAGE.md`（追加）

Windows（2026-10-04）：最終コードの `npm test -- --maxWorkers 2` を2回、各80ファイル・
663件成功。`npm run typecheck`、一時フォルダの Vite build（削除確認）、
`git diff --check`、`node scripts/check-native-repository.mjs` 成功。
`npm run test:repository:browser` は保存50手順・移行30ケース・共有15シナリオ、
故障注入・2接続/2ページ CAS・200/1000件計測に成功（1000件 warm commit p95=36.7ms）。
provider は上記の単独再実行で全9シナリオ成功。esbuild の sandbox 親ディレクトリ
探索拒否は、承認済みのローカル試験/build を制限外で再実行した。
commit/push/install/gh/workflow 実行なし。既存 `.tmp-vite-https.config.mjs` は未変更。
