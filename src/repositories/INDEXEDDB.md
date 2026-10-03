# IndexedDB Repository（第2回）

Appの保存経路・移行は未接続。Web/Windowsの選択境界で将来
`await import("./repositories/indexedDbRepository")` して使用する。
実装のbarrel exportやAppへの静的importは追加しない。

## DB / schema / store

DB名は `tairetsu-maker-projects`、IndexedDB schema versionは **2**（第4回で台帳 store を追加）。
version 1 からは既存4 storeを変更せず `migration_items` だけ追加する。
旧localStorage、音源DB `tairetsu-maker-audio`、Project.versionとは独立。
新DBを空で作ることは既存データの移行完了を意味しない。

| store | keyPath | 内容 |
|---|---|---|
| project_bodies | id | schemaVersion=1、コンパクトjson、UTF-8 byteLength、crc32、repositoryRevision、localRevision、sync=null |
| project_summaries | id | summaryと索引用sortTime / sortId。本体なし |
| project_previous | id | 更新直前に検証できた正常な本体envelopeを1世代保持 |
| operation_receipts | operationId | kind、要求SHA-256 signature、commit/renameの元receipt。removeはreceiptなし |
| migration_items | id | 移行のbatch / item、JSON、UTF-8 byteLength、crc32。判定・中断再開・復元候補 |

第4回の移行規則・原子性・bootstrap gate は [STORAGE_MIGRATION.md](../../docs/STORAGE_MIGRATION.md) を参照。

commit/rename/removeは4 storeを同一readwrite transactionで扱う。
touchOpenedは本体・summary・previousを同一transactionで扱う。
CASとlocalRevision比較はreadwrite transaction内で、書込み前に行う。
重なるstoreへのreadwrite排他はIndexedDBが行い、別接続でもCASの勝者は1件。
不一致・失敗ではpreviousやreceiptを含め変更しない。
request成功では確定を返さず、transaction.oncompleteだけで成功を返す。
request errorの原因を保存し、abort後にrejectする。ネットワーク・digest等を
transaction内でawaitしない。対応環境ではdurability=strict。
options自体をTypeErrorで拒否する古いエンジンだけ通常transactionへfallbackする。

previousはcommit/rename/touchOpenedごとに更新する。破損したcurrentをpreviousへ
昇格させない。新規はpreviousを持たない。removeは本体・summary・previousを削除し、
receiptは残す（旧要求の再送が削除済みデータを復活させない）。
削除tombstoneや同期用削除状態は後続の同期回で設計する。

receiptは**期限なし保持・GCなし**。原要求全文を繰り返し保存せずSHA-256で照合し、
exact retryは元の結果、異なる要求で同じoperationIdはCONFLICT。
キー順も含むJSON.stringifyした要求を識別する（共通メモリ実装と同じ意味）。
同じJSON値でもプロパティ順が違えば別要求。論理要求を再構成する送信側は、
同じ順序のsnapshotを保持すること。本文サイズに比例してreceiptが肥大化しない。
保持期限・応答喪失の照会APIは後続回で定義し、勝手にGCしない。
現段階でsyncの書込みAPIはなく、保存envelopeはsync=nullのみ許可。
同期を接続する際にはsync検証・原子的更新API・schema方針を先に追加する。

## 保存形式の判断

| 方式 | 主な利点 / コスト |
|---|---|
| Projectをstructured clone | JSでJSON.parseが不要。一方、大量の入れ子オブジェクトのclone・JSON互換検査が必要で、SwiftのTEXT保存との対応が複雑 |
| **コンパクトJSON文字列（採用）** | serializeProjectを使用、未知フィールドを維持、音源はmetadataだけ。Swift/SQLite TEXTと対称。1件取得時にparse・構造検証が必要 |

envelope自体はIndexedDBのstructured cloneで保存する。本体はcodecの
serializeProjectが返すJSON文字列。getはchecksum・JSON・構造・ID・revisionを検証し、
保存時のsnapshotを返す。ここで再正規化して欠損・破損を補完しない。
旧データの正規化・安定ID補完は移行coordinatorの責務。

本体のCRCは **CRC-32/ISO-HDLC、UTF-8、8桁小文字hex**。
標準ベクトル `123456789 → cbf43926` をunit testで確認。
同期的に検査できるため、CAS transaction内でも前世代の正常性を確認できる。
CRCは偶発的な破損検出用であり認証・改ざん防止ではない。
SHA-256要求識別子はWebCryptoでtransaction開始前に算出する。
本文の暗号学的hashを必須にする場合は、transactionを失活させない同期検証方式を
別途検討する。任意SQL・任意パス・本文ログのAPIは追加していない。

## 一覧 / cursor / 接続

- sortTimeは `-(Date.parse(lastOpenedAt ?? updatedAt ?? createdAt))`、不正日時は0。
- sortIdはIDの各Unicode scalarを6桁hexにした連結文字列。IndexedDBのUTF-16文字列順を
  そのまま使うと、例えばU+E000とU+1F600が契約と逆順になるため変換する。
- unique複合索引 `by_order=[sortTime,sortId]` と
  `by_mode_order=[summary.mode,sortTime,sortId]`。
- filterなし / modeありの両方でkey rangeからgetAll(limit+1)する。
  cursorはversion・mode・最後のtime/idに結び付き、次のページは境界を除外する。
  不正cursor・異なるfilterはINVALID_ARGUMENT。ページ間はlive一覧。
- listはsummary storeだけ。取得した値と索引用フィールドは検査するが、
  initialize/listで全件本体の整合性走査はしない。索引に現れない壊れたsummaryの
  検出・再構築は後続の復旧処理の範囲。
- onversionchangeでclose。無効化されたinstanceはBUSYを返す。
  新instanceのinitializeで新schemaを検出する。異常closeもinstanceを無効化する。
- openのblockedはBUSY。後から開けた接続はcloseし、遅れたupgradeはabortする。
  close中に初期化が完了しても接続を取り残さない。
- constructorの `{ factory?: IDBFactory, dbName?: string }` が依存注入点。
  本番コードに故障注入モードは持たせない。

## エラー分類

| 原因 / 検査 | RepositoryError | 判断 |
|---|---|---|
| QuotaExceededError | QUOTA_EXCEEDED | 空き容量 / quota不足。全store rollback |
| blocked、InvalidStateError、TransactionInactiveError、versionchange後 / 異常close後のinstance | BUSY | 接続・競合状態。新接続 / 再試行が必要 |
| AbortError（原因不明のabort）、UnknownError、その他I/O | IO_ERROR | 原因を容量不足と断定せず再試行可能 |
| SecurityError、NotAllowedError、IndexedDBなし | ACCESS_DENIED | 保存領域を利用できない |
| VersionError、新しいDB / 本体schema | UNSUPPORTED_SCHEMA | downgradeせず停止 |
| checksum / JSON / 本体・summary・receiptの構造不正、schema内store / index欠損、DataError / DataCloneError | CORRUPT | unreadableをnullにしない |
| CAS不一致、localRevision非増加、operationIdの異なる要求への再利用 | CONFLICT | 書込み前に拒否 |
| 更新 / 削除対象なし | NOT_FOUND | getだけは欠損ならnull |
| 不正ID / revision / query / cursor等 | INVALID_ID / INVALID_ARGUMENT | 共通契約の入力検証 |

operationIdがあるI/O・競合エラーにはそれを添え、本文・OSの生メッセージは返さない。
strictは対応環境で要求するdurabilityであり、全ブラウザの電源断耐性・origin削除への
耐性を同一保証とは扱わない。[IndexedDB仕様](https://www.w3.org/TR/IndexedDB-3/)

## 音源 / Appへの最小影響

DB名・version・store・id・Blob形式は変更なし。
共通runIdbTransactionでput/delete/readのtransaction完了を待つ。
onabort/onerrorと同期的なrequest作成失敗をrejectし、接続はfinallyでclose。
loadAudioBlobFromIndexedDbのnullは欠損だけ。不正record・アクセス失敗は例外。
deleteの掃除失敗を無視する既存の外部方針は維持（内部transactionはrejectする）。

App.tsxのrestoreAudioForProjectとZIP出力の音源取得だけでcatchし、従来どおり
「保存済み音源が見つかりませんでした…」および「音源が見つからないため音源なし」
へつなぐ。ZIP作成失敗などの別エラーは既存catchへ渡す。
音源読込 / 新規作成 / ZIP取り込み時の書込み失敗は既存catchが同じ通知を出す。
将来はUIでも不存在とアクセス失敗を分ける。今回の表示はコード上の呼出し追跡で確認。

## 実行と検証記録（2026-10-03）

既存サーバー http://127.0.0.1:5179 に対して
`npm run test:repository:browser`。起動・停止・ブラウザ導入・依存追加は行わない。
Playwright Chromiumの新しいcontextを作り、Appを読み込まない空ページにrouteして
必要moduleだけ動的importする。テスト名はrunごとのUUID。全接続をcloseし、
作成した名前だけをfinallyでdeleteDatabaseする。音源テストはglobal factoryを
一時的に差し替え、旧DB名へのopenを専用ランダムDBへ転送する。実音源DBは開かない。

実ブラウザで確認する内容:

- 契約fixture全2シナリオ / 50手順、Project全6素材（146人18シーン含む）。
- 4 store原子性、put時QuotaExceeded相当・request成功後abort、失敗したoperationId再試行。
- commit/rename/touch/removeの失敗時rollback、正常previous、破損currentによるprevious汚染防止。
- 再オープン後の本体・receipt永続、削除後retryが復活しないこと。
- 同一ページの2 connectionと2ページのCAS（1成功・1CONFLICT）。
- 実versionchange、実blocked→BUSY、遅れたopen/close、schema拒否。
- Unicode scalar順とmode cursor、summary-onlyのtransaction scope spy。
- 音源の未確定resolve防止、abort rollback、欠損nullとアクセス例外、実Blob永続と削除。

VitestはCRC標準ベクトル・scalar順・エラー分類・音源mockの確定境界と失敗処理を確認。
性能は匿名large fixture **111,126 UTF-8 bytes / 146人 / 18シーン**。
設計相談の実データ約238KBとは別。各操作5回warmup後50回、commitはserializeから
strict transaction完了まで。初期投入は新規200 / 1000件、測定対象1件には前世代あり。
全1000件に前世代がある最大容量状態の計測ではない。

Chromium 149.0.7827.55、Windows 10.0.26200 x64、AMD Ryzen 7 7735U。
最終コードでの2回の結果。単位ms、各欄は **p50 / p95 / max**。

| 実行 | 件数 | list先頭100件 | get 1件 | commit 1件 | 失敗 |
|---|---:|---|---|---|---:|
| 1 | 200 | 4.3 / 5.4 / 6.4 | 5.4 / 7.8 / 11.1 | 16.2 / 19.7 / 35.7 | 0 |
| 1 | 1000 | 3.4 / 4.3 / 4.8 | 3.8 / 5.0 / 8.1 | 11.3 / 38.9 / 40.3 | 0 |
| 2 | 200 | 4.0 / 7.0 / 7.4 | 5.1 / 11.7 / 17.0 | 15.0 / 23.5 / 30.9 | 0 |
| 2 | 1000 | 3.6 / 5.2 / 8.5 | 3.6 / 6.2 / 9.2 | 11.7 / 36.9 / 95.5 | 0 |

いずれも相談設計のlist p95 300ms / get 250ms / commit 500msの目安内。
1000件commitのp95変動は最大100msの許容幅内だが、本PCのwarm計測であり、
実データ238KB級・cold起動・WebView2・iPadの合格を意味しない。

最終確認:

- `npm test -- --maxWorkers=2` を2回：63 test files / 519 testsが両方合格。
  最初のデフォルト並列実行は既存SceneVisibilityPickerの300項目試験だけ5秒timeout。
  同試験・timeout設定は変更せず、worker数2で安定確認。
- `npm run typecheck` 合格。
- 実ブラウザ試験2回合格。各回14確認項目（契約50手順を含む）、2ページCAS、
  native blocked確認、200 / 1000件計測。各回13専用DBと2ページ専用DBを削除。
- 一時出力Vite buildと独立dynamic import build合格、出力削除。
- `git diff --check` と新規ファイルのno-index check合格。
  制約対象パスに差分なし、HEADは18f5efb、commit / push / installなし。

Appビルドのメインは **481,236 bytes（481.24kB）**、500kB警告なし。
Repositoryは未接続なので通常Appビルドには出力されない。
一時的なvirtual entryから動的importした独立ビルドではRepositoryが
**17,581 bytes（17.58kB、gzip 6.28kB）** のdynamic chunk、entryは1.19kB。
共通音源transaction helperのみメインに含まれることをchunkのmodule一覧で確認。
ViteのJS API / configLoader=runnerで一時フォルダへbuildし、両出力をfinallyで削除。
distは変更していない。

## 第3回の申し送り / WindowsでSwiftを検証できない場合

TS / Swiftはtypes.ts、ids.ts、contract/README.md、JSON fixtureを正本として共有する。
revisionは任意桁の十進文字列。SQLite INTEGERへ単純変換せず、比較 / incrementは
桁数・文字列で扱うか、上限を明示して共通契約を合意し直す。
SQLiteの時刻順はTSのepoch ms / 無効0と揃え、ID順もlocaleやUTF-16順にしない。
Date.parseの全曖昧入力をFoundationだけで再現しようとせず、既存の日付fixtureを
使い、必要ならTS adapterからvalidated sortTimeを渡す狭いbridge契約を検討する。
Swift側でProject全体の正規化を再実装せず、compact JSON / summary / revisionsを
同一COMMITで保持し、operationIdと期待版を照合する。

失敗の少ない進め方（今回はios/・workflowを変更していない）:

1. 保存coreをCapacitor非依存のローカルSwift package、例
   `ios/ProjectRepositoryCore/Sources/ProjectRepositoryCore/` に置く。
   XCTestは `ios/ProjectRepositoryCore/Tests/ProjectRepositoryCoreTests/`。
   SQLite3 / Foundationだけへ依存し、OS内蔵SQLiteをlink。専用直列queue、
   journal_mode=DELETE / synchronous=EXTRA、一時DB・rollback・再オープンを検証する。
   Capacitor CLI管理下のCapApp-SPM/Package.swiftへテストを直接足さない。
2. fixtureの正本はsrc/repositories/contract/fixtures。テストresourceへCIでコピーするなら
   byte一致をWindows側で検査し、別の期待値を手入力しない。ID表・codec素材・操作列、
   大きなrevision、CAS・exact retry・receipt永続・checksum・unsupported schema・
   SQLite FULL / BUSY / CORRUPT分類・rollback・backup復元を一括XCTestへ入れる。
3. **workflowの最小変更**は、既存macOS jobに
   `swift test --package-path ios/ProjectRepositoryCore` を1 step追加し、既存Release
   simulator buildを維持する形。coreの実SQLiteテストとpluginのiOSコンパイルを
   同じ1回のmacOS jobで確認できる。ただしこれはbridge呼出しの実行試験ではない。
   [SwiftPM test target](https://developer.apple.com/documentation/packagedescription/target/testtarget%28name%3Adependencies%3Apath%3Aexclude%3Asources%3A%29)
4. bridge実行も第3回の合格条件に含める場合は
   `ios/App/AppTests/ProjectRepositoryPluginTests.swift` とAppTests target / 共有schemeを
   追加する。既存workflowには具体的なavailable simulator UDIDの選択とXCTest stepを
   足す（generic destinationではtestは実行できない）。ビルド重複を減らすには
   Release buildをbuild-for-testingにし、同じconfiguration / derivedDataの
   test-without-buildingを続ける。Releaseで@testableを使うならtestability設定が必要。
   標準Xcode projectでtarget / scheme / Resources登録を明示し、Windows側でpbxprojの
   参照・ID重複・fixtureコピー・workflow構文・TS adapter契約を事前検査する。
   [Appleのbuild-for-testing / test-without-building](https://developer.apple.com/library/archive/technotes/tn2339/_index.html)
5. 1回のmacOS実行にcore XCTest、simulator plugin / bridge試験、Release build、
   fixture一致、ログとxcresultのalways artifact保存をまとめる。core失敗でも独立の
   build / 結果収集が動くようstatus条件を付け、後段の最終gateではどれか失敗したら
   job失敗にする。テストを再試行して失敗を隠さない。macOS実行前にWindows上の
   unit / 型 / Chromium契約 / 差分検査を全部済ませる。

macOS ActionsやSwift buildは今回未実行。simulatorが通っても実iPadの強制終了、
低空き容量、ロック、iCloud復元、WebView bridge応答喪失、TestFlightは別途必要。
WebKit・Windows Release版WebView2・実電源断・実quota枯渇・最大容量状態も未確認。
CRCは認証ではなく、前世代はDB全体破損からのbackupではない。復旧UI・検証済みDB
backup・receipt保持期限・同期 / tombstoneは後続回で扱う。
