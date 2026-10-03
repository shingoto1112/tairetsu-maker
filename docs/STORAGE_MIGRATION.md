# 保存方式 第4回: 古いデータの引っ越し

App未接続。旧localStorage・iPadミラー・本人下書き・音源・ZIP・Project型・クラウド・本番SQLには書き込まない。旧データを削除しない。編集担当はCodexのみ。commit / push / install / workflow実行なし。

## 変更ファイル

| 場所 | ファイル |
|---|---|
| src/storage（新規） | bootstrap.ts、legacyReaders.ts、migrationPlan.ts、migrationCoordinator.ts、migration.test.ts、legacyReaders.test.ts、testing/MemoryMigrationRepository.ts、testing/migrationContract.ts |
| src/repositories | migrationTypes.ts（新規）、indexedDbFormat.ts、indexedDbRepository.ts、nativeSqliteRepository.ts、nativeSqliteRepository.test.ts、INDEXEDDB.md、contract/testing/indexedDbBrowserSuite.ts |
| ios | App/App/ProjectRepositoryPlugin.swift、ProjectRepositoryCore/Sources/ProjectRepositoryCore/ProjectRepository.swift、ProjectRepositoryCore/Tests/ProjectRepositoryCoreTests/RepositoryTests.swift、ProjectRepositoryCore/README.md |
| scripts | check-native-repository.mjs、test-indexeddb-browser.mjs |
| docs（新規） | STORAGE_MIGRATION.md |

## 入口と読取り

`src/storage/bootstrap.ts` の `runStorageBootstrap({ onProgress, signal })` が runtime を判定して Repository と移行処理を動的importする。第5回では旧hydrate、sample作成、通常保存より先にawaitする。テスト用にrepository / readersを注入できる。通常呼出しはsingle-flightで、同時呼出しのoptionsは最初の呼出しが採用される。戻り値はcompleted / canContinue / migratedCount / recoveryCount / duplicateCount / failures / audioMigration="deferred"。

Repository初期化失敗は続行不可。移行の容量不足・中断・IO失敗では確定分を保持し、部分データでの続行可否を返す。旧ソースの破損は失敗情報を残した上で正常項目を利用できる。canContinue=trueでもcompleted=falseの場合は未移行項目が残るので、空一覧を初期データで埋めたり旧保存先へ戻したりしない。

読取りAPIの注入能力はgetItem / readText / draftNamesだけ。Capacitor FilesystemはreadFile / readdirだけ使用し、absenceはインストール済みプラグインの `OS-PLUG-FILE-0008` だけから判断する。他のアクセス失敗を「存在しない」に変換しない。iOSのDirectory.DataはDocumentsに対応し、既存保存先と一致する。

全件キー・直近1件・updatedAtキー、projects primary / pending / backup、personal-cloud-draftsディレクトリと各primary / pending / backupを収集する。正常な空配列、不存在、破損、アクセス失敗を区別する。部分的に構造が壊れた一覧はunreadableと報告し、JSONとして読める正常項目は回収、不正項目は復元候補として保存する。正常な全件一覧がある場合はそちらを優先する。クラウド下書きファイル名は旧encodeURIComponent形式のみ、固定ディレクトリ内の通常ファイルだけ対象とする。

## 判定規則

| 状況 | 採用・保持 |
|---|---|
| 正常な全件一覧が複数 | 比較可能なsavedAtで新しいスナップショット。時刻不明・同時刻はlocalStorage → primary → pendingの順を基準にし、他の差分を保持 |
| 全件一覧がない・破損だけ | 正常な直近1件を回収。部分一覧しかなければ正常項目を回収 |
| 同一ID・同一の正規化内容 | 本体を重複作成しない。候補の出典を統合 |
| 同一ID・異内容 | 基準一覧のID所属を維持し、両版の有効なupdatedAtが比較可能なら新しい版。比較不能・同時刻差分は復元候補 |
| 同じ一覧内に同一IDの異内容 | 所属は分かるが版を断定できないため、両方を復元候補 |
| 基準一覧にないID | 他一覧の内容を勝手に追加しない。復元候補 |
| 直近1件のIDが一覧にない | そのupdatedAtが全件savedAtより確実に新しければ部分保存失敗として回収。根拠がなければ復元候補 |
| 空の最新一覧と古いbackup | 空を正常として採用。backupのみのIDを自動復活させない |
| backupしかない | 復元候補だけに保存。primaryとpendingの読めない理由も残す |
| IDなし旧データ | 元JSONのSHA-256から安定IDを作り、台帳へ永続化。補完されるframe/path/plan IDも固定。欠落日時は1970-01-01の固定値で、移行時刻を新しさの根拠にしない |
| 新保存先に同じIDがある | 同一内容はduplicate、異内容はrecovery。既存本体を上書きしない |
| 移行後の編集・削除 | written台帳が元の原子的確定を証明。編集・削除を戻さず、移行を再送しない |
| 本人下書き | cloud ID単位の独立したdraft-<SHA256>コピー。savedAtでprimary/pendingを選び、backupのみは復元候補。cloudProjectId / baseUpdatedAt / savedAt / status=pendingを台帳で保持 |

下書きには旧形式でaccount IDもserver revisionも存在しない。架空のbaseServerRevisionを設定しないため、ProjectRecord.syncはnull、summary.syncStatusはlocalのままにする。pendingの意味は移行台帳のdraft情報に保持する。第9回の本人同期ではアカウントと新server revisionの対応を確認してからsync情報を作る。同期済みとして扱わない。

## 台帳・原子性・schema

- IndexedDB: 同じ `tairetsu-maker-projects` DBの `migration_items` store、keyPath=id。新規schema 2。開発・テストで作成済みのversion 1も、既存4 storeを触らず台帳だけ追加して開ける。本文envelopeのschemaVersion=1は維持。
- SQLite: 同じDBの予約済み `migration_items(source_key,state_json)`。既存schema 1 / 6テーブル / 2明示indexを維持。新しいtable/column、任意SQL、任意パスAPIは追加しない。bridgeはreadMigration / writeMigrationの2操作だけ追加し計10操作。
- 両方で台帳はJSON + UTF-8長 + CRC。元ソース全体のSHA-256、項目のsourceHash、target ID、採用理由、出典、本文、状態、結果を保持する。CRCは偶発破損検出であり改ざん防止ではない。
- itemはdiscovered → validated → written → verified → completedの1段階ずつ。immutableなidentityとexpectedStateを照合し、同じ要求の再送・既に進んだ状態は既存結果を返す。逆戻りや異なる本文での同じitem IDは拒否。
- **writtenの本体新規作成 + summary + target receipt + 台帳は1トランザクション**。更新には使わずcreate-only。request成功やbridge応答生成では確定と扱わず、IDB complete / SQLite COMMITまで待つ。
- 台帳自体を移行要求のreceiptとして使う。さらに通常operation_receiptsの `legacy-target-<SHA256(targetId)>` を保持して、アクセス失敗からの再収集中に利用者が削除した本体が別候補から復活することを防ぐ。このoperation ID prefixは移行用予約。通常保存のreceiptと同じ形式でbackup検査できる。
- 再読込みで台帳・本体を検証後verified、completed。原子的なwritten後に本体が編集/削除された場合は尊重する。他bootstrapが先にverified/completedまで進んでも受け入れる。
- batchは全item登録後にsealする。アクセス/IOに失敗したソースがある間はsealせず、読めるitemだけ移行して次回収集を再試行する。完全なdiscoveryをsealした後はそのsnapshotから再開する。
- 全item完了後にbatchをcompletedにし、件数を保存。以後の起動はbatchだけを読み、旧ソースや全Project本文を読み直さない。

復元候補はitem.jsonとして新保存領域にあり、通常一覧には出ない。importした元snapshotも台帳に保持するため、概ね本文1世代分の追加容量を使う。台帳・旧ソース・target receiptの整理は第10回以降に明示的な保持方針を定める。移行コードは本体を1件ずつ書くが、旧一括JSONの読取りと判定はスナップショット全体をメモリに持つ。大量native旧データの実機ピークメモリは未計測。

## Swift改善とmacOS確認

- 0 byte、またはuser_version=0・application_id=0・sqlite_masterが空のDBだけ新規扱い。短い不正ファイル、version 0でもユーザーtableのあるDB、NOTADBはCORRUPTで残す。NSErrorへbridgeされる前にRepositoryErrorを保持し、短い不正ファイルもCORRUPTに分類する。
- 起動のquick_check / foreign_key_checkは**維持**。Windowsでnative再open時間を測れないため、正常終了フラグを追加して検査を減らす判断は行わない。rollback journalの回復、CRCの読み取り時検査、backup全件検査に加え、起動時の物理検査を残す。macOSのreopen計測が起動目標を超えるなら、不完全終了時・定期・backup時の検査へ変更する案を次回検討する。
- 通常200件 × ~230KiB、`REPOSITORY_PERF=1`だけ1000件。seed / **reopen** / list100 / get / commitをログに出す。1000件は追加の常時テストではない。
- 新XCTest4件: 空DB/不正原本保持、全状態と応答喪失・編集保持・batch/backup、5地点NO_SPACEと全6table不変・再open、duplicate/recovery/draft/deletion receipt/台帳破損。
- Claude: 既存workflowのrelease swift testをそのまま実行し、合計14件成功、共通契約50手順、新migration契約ログ、reopen時間、simulator BUILD SUCCEEDED、警告なしを確認。workflow変更なし。1000件の数値が必要なら実行環境にREPOSITORY_PERF=1を設定する。
- コンパイル自己レビュー: Foundation / SQLite3のみ。新しいソースファイルやpbxproj変更なし。異種辞書は[String: Any]、空配列は[[String: Any]]()等で明示。sync queue内のtransactionを入れ子にしない。throwsのoptional map / UTF-8比較は外側tryで扱い、Int/NSNumberでstate/countを検査する。

## 第5回への申し送り

1. bootstrapを既存hydrate/保存/初期sampleより先に接続し、canContinueとcompletedを区別してUIへ反映。onProgressのcompleted/totalで「12／18件」を表示、failuresから容量不足・中断・旧ソース破損を案内する。音源は第7回待ち。
2. Appの一覧/開く/名前変更/複製/削除/ZIP取込みをRepositoryへ接続。FormationLibraryにはsummaryとID callbackだけを渡す。本体は開く1件、保存も対象1件。今回Appは未変更。
3. コピーとZIP取込みには新しいIDとoperationId。rename/removeにはexpectedRepositoryRevision、編集には増分localRevision。既存localStorage/mirrorへ二重保存を続けない。ZIPの形式や旧読込codecは維持する。
4. 旧hydrateや通常保存がbootstrapと競合しないようにする。旧ビルドへのrollbackは保証しない。復元候補UIは第10回、本人draftの同期情報設定は第9回。
5. migration_itemsとlegacy-target receiptを消さない。クラウド下書きのpending provenanceをsync済みと誤認しない。実機低容量/ロック/強制終了/大量旧snapshot/iCloud復元を別途確認する。

## Windowsでの確認結果（2026-10-03）

| 確認 | 結果 |
|---|---|
| npm test -- --maxWorkers 2、1回目 | 65ファイル / 526 tests成功 |
| 同コマンド、最終2回目 | 66ファイル / 529 tests成功。移行30シナリオはMemory oracleとnative JSON bridge mappingで実行 |
| npm run typecheck | 成功 |
| npm run test:repository:browser | 成功。移行30ケース、各状態でのclose/reopen、同時bootstrap、quota/abort/台帳失敗の4 store原子性、v1→v2、既存契約50手順、2ページCAS、200/1000件。48専用DBをcleanup |
| Vite build | workspace内一時フォルダに成功、削除済み。main index-DMsjFFOy.js = 481,236 bytes / gzip 138.69 kB。未接続の移行markerは本番assetsに0件 |
| node scripts/check-native-repository.mjs | pbxproj 51 UUID、10 bridge methods、旧fixture path、6 table / 2 index、mutation blocks + 37 SQL literalのprepareが成功 |
| git diff --check | 成功（GitのLF→CRLF案内のみ） |
| Swift / simulator / 実機 | Windowsでは未実行。上記14 XCTestとmacOSログをClaudeが確認する |

Vitestのsandbox内起動はesbuildの親ディレクトリ参照制限で失敗したため、承認された同じローカルコマンドを制限外で実行した。ブラウザは隔離プロファイルと既存127.0.0.1:5179のみを使用し、dev serverの起動停止・利用者DBの変更はしていない。

最終ブラウザの1000件warm p95: list100 7.3ms / get 9.7ms / commit 43.8ms。Vitest/typecheck/buildとの同時実行を含む参考値で、nativeの起動時間や移行の実機メモリの測定ではない。
