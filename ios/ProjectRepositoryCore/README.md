# iPad ProjectRepository（第3〜4回）

App の保存先はまだ切り替えていません。既存の localStorage、IndexedDB、ZIP、音源、クラウドは変更していません。

## 構成・判断

- Foundation と OS 内蔵 SQLite3 のみ。Swift tools 5.7 / Swift 5 言語モード、iOS 15 / macOS 12 以上。外部 package はゼロ。
- App.xcodeproj から `../ProjectRepositoryCore` を local Swift package としてリンク。App に core のソースを重複登録する方法と比べ、App と XCTest が同じモジュールを使え、コンパイル設定の分岐を避けられる。CapApp-SPM は変更しない。
- `ProjectRepositoryPlugin` は既存 BridgeViewController で instance 登録。任意 SQL、任意パス、復元 API は JS に公開しない。
- bridge の10操作は `{ json: string }` を受け、`{ json: string }` を返す。第4回で `readMigration` / `writeMigration` を追加。commit の本文は request 内の `json` 文字列、read の本文は response 内の `json` 文字列。巨大な Project オブジェクトや base64 を渡さない。エラーは固定メッセージと code / retryable。
- native adapter は将来の runtime 選択地点から動的 import する。現在 App / barrel への import はない。

## 保存・整合性

保存先は `Library/Application Support/TairetsuMaker/v2/repository.sqlite`。Documents のファイル共有対象にせず、`isExcludedFromBackup` は設定しない。

iOS のディレクトリ・DB・backup・復元候補には `completeUntilFirstUserAuthentication` を設定する。再起動後の初回アンロックまでは保護し、それ以降のロック中にも保存を継続できるため、画面ロックによる保存中断を減らせる。`complete` よりロック中の保護は弱い。この選択は個人情報の機密性と保存継続の両立の判断であり、実機確認が必要。iCloud バックアップの有効化・成功をアプリだけで保証するものではない。

各 instance は単一接続と専用直列 queue。`journal_mode=DELETE`、`synchronous=EXTRA`、`foreign_keys=ON`、`fullfsync=ON`、`trusted_schema=OFF`、`temp_store=MEMORY`、busy timeout 3秒。主要 PRAGMA は読み返す。別 instance の write も `BEGIN IMMEDIATE` の SQLite ロックで直列化する。

`application_id=0x544d5632`、SQLite `user_version=1`。v2 ディレクトリ名、Project.version、ZIP formatVersion、Repository schema は別物。0→1 の schema 作成のみ実装し、既存ファイルの version 0 や NOTADB を空 DB に作り直さない。将来 version は `UNSUPPORTED_SCHEMA`。

テーブルは bodies / summaries / previous / operation_receipts と、未使用の最小枠 personal_sync / migration_items。同期更新の API や sync_operations は今回は作らない。revision は桁数制限のない10進 TEXT、比較と increment は文字列で行う。

CAS・localRevision 検査・再送照合・previous 保持・本文／summary 更新・receipt 記録を同一 transaction に入れる。`COMMIT` が SQLITE_DONE になってから返す。途中エラーでは rollback、rollback 自体が終了しなければ接続を捨てる。再送は古い版の receipt を返し、削除後でも再作成しない。receipt の期限・削除は将来の応答喪失／同期仕様と一緒に決めるため、今は保持する。

commit は TS codec が生成したコンパクト JSON の文字列をそのまま TEXT に保存する。native が summary を生成・検証するため対象1件は Foundation で解析する（設計 B の「native で辞書展開を避ける」からの変更）。rename / touch は対象1件を再シリアライズし、未知フィールドを維持する。構造検証は `src/project/codec.ts` と対応させる。今後 codec を変えるときは native 検証も更新する。

CRC-32/ISO-HDLC と UTF-8 長を本文、summary、receipt に付ける。TS と同じ検出方式で、認証・改ざん防止ではない。再送識別には SHA-256 を使い、本文全体を receipt に二重保存しない。依存制約のため純 Swift の SHA-256 を実装し、既知ベクトルを XCTest に置いた。

一覧は summary のみを `(sort_time DESC, id COLLATE BINARY ASC)` の索引で読む。UTF-8 BINARY は有効な Unicode の scalar 順と一致し、Swift の正規化同値な String 比較には依存しない。cursor は version / filter / 最後の時刻と ID を持ち、削除された bookmark からも続行する。日時は epoch milliseconds、無効な日時は0。標準 ISO 日時・日付のみ・ローカル日時を扱う。JS Date.parse のブラウザ固有な非標準日時表現の全網羅は未確認。

## エラー分類

extended result code は下位8bitの primary code に分類し、sqlite3_system_errno と保護状態を補助にする。Foundation の NSError / POSIX ENOSPC / 権限エラーも分類する。本文や生パス・SQL・NSError は bridge に渡さない。

| 条件 | code | retryable |
|---|---|---|
| SQLITE_FULL / ENOSPC / Cocoa out-of-space | NO_SPACE | false |
| SQLITE_BUSY / SQLITE_LOCKED | BUSY | true |
| SQLITE_CORRUPT / SQLITE_NOTADB / CRC・長さ・構造不一致 | CORRUPT | false |
| CANTOPEN / PERM / AUTH / READONLY / EPERM・EACCES | ACCESS_DENIED | false |
| 上のアクセス失敗かつ保護データ unavailable | DEVICE_LOCKED | true |
| 未対応 schema | UNSUPPORTED_SCHEMA | false |
| CAS / localRevision / operationId の再利用不一致 | CONFLICT | false |
| その他 SQLite / ファイル I/O | IO_ERROR | true |
| 対象なし | NOT_FOUND | false |
| ID 違反 | INVALID_ID | false |
| request / revision / query / 日時の不正 | INVALID_ARGUMENT | false |
| QUOTA_EXCEEDED | native では使わない（Web 用契約コード） | false |

`isProtectedDataAvailable` は bridge が main thread で取得し、core に probe として注入する。ロック中という理由だけで一般 I/O エラーを DEVICE_LOCKED に変えない。

## 検証済み backup と復元手順

`createRecoveryBackup` は SQLite Backup API で UUID 付き候補 DB にコピーする。step が DONE、finish が OK であること、schema / quick_check / foreign_key_check / 全本文 CRC・構造 / previous / summary と本文の一致 / receipt を検証し、close 後に `recovery/repository.backup.sqlite` へ置換する。失敗した候補は削除し、従来の検証済み backup は残す。本文検査は1件ずつ走査し、全件本文をメモリに集めない。

復元 UI は未実装。native で次を行う。

1. 保存キューを止め、対象 DB を使う全 Repository を close する。
2. 対象 instance の `restoreRecoveryBackup()` を呼ぶ。破損 DB の initialize を成功させる必要はない。
3. backup 自体を検証し、Backup API で別候補にコピーしてもう一度検証する。
4. 他 instance の open が残っていれば BUSY。プロセス内の lifecycle lock で、置換中の新規 open を止める。外部プロセス／将来 extension の接続も停止することが前提。
5. 原本と journal 等を `repository.quarantine-<UUID>.sqlite` へ保持し、検証済み候補で原本を置換する。置換失敗時は移した sidecar を戻す。古い hot journal を新 DB に適用しない。
6. initialize / read で復元結果を確認し、UI と保存キューを再開する。復元直後の revision はバックアップ時点になるため、復元前の CAS 値で保存しない。

強制終了で残る候補／quarantine の整理とバックアップ頻度は将来の復旧 UI で決める。自動削除・自動復元は行わない。

## XCTest と Windows preflight

Tests は checkout の `src/repositories/contract/fixtures/{operations,commitProjects,ids}.json` を直接読む。複製した fixture は使わない。`#filePath` から5階層戻って checkout root を得る。孤立サロゲートの2負例は元の JSON オブジェクトを個別に読み、native の escape 検査で拒否する。

共通 2 scenarios / 50 steps と、途中故障で全6テーブル不変、再 open、古い receipt、2接続の同時 CAS、NOTADB 原本保持、CRC 破損、backup 再置換・失敗保持・復元・無効 backup 拒否、error 分類、CRC/SHA ベクトルを確認する。通常200件 × 約230KiB の reopen / list100 / get / commit を計測し、`REPOSITORY_PERF=1` の時だけ1000件にする。時間はログのみで、速度を合否に使わない。

第4回の判定規則、同じ `migration_items` への台帳・復元候補の保存、原子的な written、空DBの再初期化と4件の追加XCTestは [STORAGE_MIGRATION.md](../../docs/STORAGE_MIGRATION.md) を参照。SQLite schema 1 の6テーブルは変更していない。

workflow は `swift test --package-path ios/ProjectRepositoryCore -c release -Xswiftc -enable-testing` を実行する（`@testable import` を release でも使えるようにするため）。純 Swift CRC/SHA の1000件計測を debug の低速なコードで回す消費時間を避け、App の Release と同じ最適化で検証するため。XCTest / 故障注入は Release でも実行する。

Windows では `node scripts/check-native-repository.mjs`（Node の内蔵 node:sqlite）で UUID、plugin の BuildFile / FileReference / Group / Sources、package 参照、fixture パス、SQL の prepare を検査できる。Swift の実行や iOS 版 SQLite の検査ではない。

コンパイル自己レビューの観点:

- SQLITE_TRANSIENT は `unsafeBitCast(-1, to: sqlite3_destructor_type.self)`。text のメモリは SQLite がコピーする。
- 接続／statement／backup は OpaquePointer、sqlite3_* の結果・bind index・UTF-8 byte count は Int32。revision は Int64 に変換しない。
- sqlite3_column_text の UInt8 ポインタを String(cString:) へ無理に渡さず、column_bytes の長さを使った Data → strict UTF-8 decode。NUL と不正 UTF-8 も検出する。
- nil 接続に sqlite3_system_errno を呼ばない。prepare 後は finalize、backup_init 成功後は finish をちょうど1回、失敗 open の接続も close。
- FileProtectionType は `#if os(iOS)` 内。core に UIKit / Capacitor / 新しい concurrency API はない。XCTest は macOS でコンパイルする。
- fixture path、pbxproj の5つの追加 UUID、OS library の linkerSettings と import SQLite3、Swift 5 言語モードを確認した。

## Claude の macOS 1回実行時の確認

この作業では commit / push / gh / workflow 実行をしていない。`ios-build.yml` は push トリガーを削除し、dispatch / PR を維持。同じ ref の重複実行を cancel する。

Swift test と simulator build は `!cancelled()` 条件により、一方が失敗しても他方を実行し、ジョブ自体は失敗のままにする。Summary に両 outcome、artifact `ipad-native-check-logs` に両ログ（3日保持）。cancel 時は無駄な追加 build をしない。

ログで見る箇所:

- `repository-swift-tests.log`: 最初の compiler error、`Repository contract: 2 scenarios, 50 steps`、全 XCTest 成功、`Repository timing ...`。
- `ipad-simulator-build.log`: ProjectRepositoryCore の resolve / compile / link、ProjectRepositoryPlugin と Bridge 登録の compile、最後の BUILD SUCCEEDED。
- テスト失敗時は compile / module import → fixture path・Foundation bridge 型 → schema と PRAGMA → rollback・CAS → backup / FileManager 置換の順に切り分ける。ビルドのみ失敗なら local package 参照 → SQLite3 module / link → Capacitor plugin API / UIKit の順。

Swift build / XCTest / simulator は Windows では未実行。実機の iOS 15、ロック・低容量・強制終了、iCloud バックアップからの実復元、実機速度は未確認。macOS の成功だけで実機確認の代わりにはしない。
