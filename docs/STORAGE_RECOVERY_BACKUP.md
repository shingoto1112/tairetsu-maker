# 保存方式 第10回：復元・手動全件バックアップ・端末の整理

編集はCodexのみ。共同編集・クラウドAPI/SQL・Project型・既存1件ZIPのformatVersion・CapApp-SPM・PrintPreview・distは変更していない。commit/push/install/workflow/配信は行っていない。

## 復元

- 一覧の「復元できる隊列表」は `legacy-projects-v1` の recovery disposition/outcome を持つ候補がある場合だけ表示。本文を1件ずつ読み、タイトル・日時・人数・シーン数・平易な出典を表示する。
- 「一覧に復元」は新ID/create-only commit。元の本体・候補は残す。失敗した操作は画面内で同じID/operationIdを保持し、応答喪失時の再送を重複作成にしない。
- 構造不正は調査用ZIP（recovery.json/README.txt）のみ。通常の隊列表ZIPを偽装しない。「確認しました」は候補の削除を意味せず、保守台帳に確認済みIDを記録する。
- 起動でCORRUPT・続行不可になったiPadは専用画面。`restoreRecoveryBackup` は空の引数だけを受理し、固定の検証済みDBを再検証→接続を閉じる→別接続があればBUSY→原本/sidecarを隔離して置換→開き直す。任意SQL/パスはない。復元成功後にbootstrapを再実行する。
- Web/Windowsは、本文が破損して一覧から開けない1件について `getPrevious(id)` を提供。前世代を新IDで救出し、破損した原本と前世代を上書きしない。IndexedDB全体の物理破損を空DBに作り直す機能はない。

## 全件バックアップと読み込み

- 対象はこの端末の通常一覧。1隊列表＝既存形式の1ZIPで、1000件でも1ZIPのentry数を増やさない。生成・配布/Cacheへの退避を1件ずつ行い、保持する全件情報はsummaryとmanifestだけ。
- 独立ZIPを入れる外側の巨大ZIPは作らない。音源200MiB、Project JSON 24MiB、展開224MiB（manifest等に4KiB予約）、生成ZIP256MiBを個別確認。限界を超える1件、読めない本文、音源込み指定時の欠落音源は失敗数に記録し、残りを続行。
- `backup-*.manifest.json` は `fileType=tairetsu-backup-set/version=1`。作成日時、要求件数、成功件数、失敗件数、音源有無、成功した各ファイルの名前/サイズを記録。既存ZIP内部のmanifestとは別物。
- 音源込みサイズは事前に本文とメタ情報から見積もる。共有音源も独立ZIPごとに重複するので重複分を加算。読み取れない項目のサイズは不明として表示する。
- WebはZIP複数＋manifestを逐次ダウンロード。ブラウザの複数ダウンロード許可が必要な場合を画面に説明し、保存先の全ファイル確認を促す。自動ダウンロードの実保存完了はブラウザから保証できない。
- iPadは生成済みZIPを1件ずつCacheへ192KiB単位のbase64で書き、最終サイズをstatで確認。全量Blob配列を保持せずURL一覧を共有シートへ渡す。終了/中断/エラー時は今回のCacheを削除する。
- 既存ファイル選択は複数選択対応。1件単独の既存フローは維持。複数/manifest選択では件数を確認し、1件ずつ新IDで取り込む。欠落、サイズ不一致、途中失敗を件数表示し、正常項目を続行。manifestを選ばなければ独立ZIPだけでも取り込める。
- 制約：既存JSZipは1件の音源Blob/ArrayBuffer/圧縮バッファを必要とする。全件分のメモリ蓄積は避けたが、200MiB級1件のピークはiPad実測が必要。新規依存を追加せずnative ZIP独自実装は行っていない。

## バックアップ・GC・削除条件

- `device-maintenance-v1` を既存migration_itemsの固定キーに保存（UTF-8長/CRC付き）。完了確認日時・正常起動回数・候補確認済みID・最終GC日時を保持。Project型とSQLite schemaは変更なし。
- 自動全件ZIPは作らない。起動の移行完了後、編集操作を解放する前に、iPadのSQLite Backup APIで復旧用DBを作る。最後の作成から24時間以上、DB×2＋16MiBの空き容量を条件とする。検証成功後だけ旧バックアップを置換する。既存の無引数native core呼出しは強制作成として維持し、App adapterは `ifDue:true` を送る。
- GCは同じ起動時点で移行完了後のみ、成功した実行は1日1回。現在の本体、前世代、復元候補、未完了移行/取り込みを参照。iPadでは検証済み復旧DBと、移行対象外の既存本人下書きprimary/pending/backupも読み取りだけで保護する（同期変更なし）。completed/importedの使われない移行原文は永続的な音源参照にしない。
- 新規音源はpendingを永続化。Project commit receipt後に解除し、解除失敗なら保持。未完了のpublished音源は保守的に残す。nativeの活動中uploadは別storeインスタンスからのGCでも保護する。
- WebはWeb Locksで両DBの参照走査/削除と書込みを排他。編集中タブがある場合GCをスキップし、未保存のメモリ内参照も保護。Web Locksなしでも通常保存は可能だがGCは行わない。
- nativeは共通NSRecursiveLockでRepository/audioのworkerを排他。カタログを検証して保持版を原子的に先に公開し、その後で未参照ファイルを削除。台帳にない既知形式のUUIDファイル/.partial/.upload等も対象。未知ファイル・symlink・判断不能な参照は残す。内部ログは削除件数/bytesだけ。
- 旧データ整理は既定で無操作。移行completed、全項目completed/移行元に未検証問題なし、全候補確認済み、完了確認から30日、正常起動2回以上、現在/前世代の再検証、iPadで検証済み復旧DBが条件。既存端末に完了日時がないため、今回版での最初の完了確認から30日を数える。
- 確認ダイアログ後に再判定。iPadでは現在/前世代/候補/取り込み/バックアップが参照する旧音源のcopyを先に検証し、失敗なら削除を始めない。固定の旧ミラー3ファイル、旧音源の通常 .data/.json、旧localStorage3キーだけを削除。本人クラウド下書き、現在の本体、前世代、候補/台帳は保持。旧ディレクトリの再帰削除はしない。
- ACCESS_DENIED等で保存に失敗した場合はZIP退避を先に勧め、確認後「保存せずに一覧へ戻る」。保存中は選べず、coordinatorの明示discardだけで未保存セッションを解放する。

## macOS・実機で確認すること

macOS: `swift test --package-path ios/ProjectRepositoryCore`（必要に応じrelease）。Foundation/SQLite3のみのcore、新規の空/異種リテラルは型を明示。新規XCTUnwrapの内側にはthrowing呼出しを入れていない。固定復旧APIのBUSY/閉じる/再open、24hと空き容量境界、GCの現在/前世代/候補/未完了/復旧DB参照、別storeの活動中uploadと孤立ファイル、破損カタログの保持を確認する。既存iOS targetのplugin登録・simulator buildも確認する。

実機: CORRUPTから復旧と原本隔離、ロック/空き容量不足/強制終了、バックアップ作成途中の中断、1000件と200MiB音源のメモリ/Cache容量、Files/AirDrop共有（多数ファイル含む）と再取込み、iCloud復元後のDB/音源参照、旧データ30日条件と確認取消/コピー失敗時の保持。Windows ReleaseのWebView2でも複数ダウンロードとWeb Locks対応を確認する。

## Windows検証結果

- `npm test -- --maxWorkers 2` を2回：71ファイル/567件、71ファイル/568件成功。最終の削除前再検証を追加後、関連4ファイル32件を再確認し成功（全体のテスト定義は569件）。
- `npm run typecheck`、`npm run test:repository:browser`（契約50手順・移行30ケース・200/1000件）、`node scripts/test-app-storage-browser.mjs`（a〜l）、`node scripts/check-native-repository.mjs`、`git diff --check` 成功。
- App試験は全件バックアップのZIP複数ダウンロード→別コンテキストで音源込み復元、途中失敗の続行、GCの前世代/候補/取り込み/編集中タブ保護・不明参照時の保持、候補UI/確認記録、破損本体を残した前世代救出を追加。GCロックの解放完了待ちを修正し、全ケース再実行済み。
- 最終Vite build：`index-D4DvoXVA.js` = 494,175 bytes、500kB未満。出力先 `.tmp-storage10-build` を絶対パス確認後に削除済み。禁止ファイル/クラウド/SQL/既存ZIP実装/未追跡HTTPS設定に変更なし。
- Swiftは実行/コンパイル未実施。coreの自己レビューとSQL prepare検査のみ。macOSでRepository 17件＋AudioStore 15件（32 XCTest）、iOS target buildを確認する。実機/大容量メモリ/共有先の実保存/iCloud復元は未確認。

## 変更ファイル

- UI：`src/App.tsx`、`src/AppRoster.test.tsx`、`src/components/FormationLibrary.tsx`、`src/components/StorageTools.tsx`（新規）、`src/styles.css`。
- 保守処理：`src/storage/appRepository.ts`、`saveCoordinator.ts`。新規は `maintenanceTypes.ts`、`maintenanceLock.ts`、`audioReferences.ts`、`maintenance.ts`、`recovery.ts`、`bulkBackup.ts`、`maintenance.test.ts`、`bulkBackup.test.ts`。
- Repository：`src/repositories/indexedDbRepository.ts`、`nativeSqliteRepository.ts`、`nativeSqliteRepository.test.ts`。
- 音源/共有：`src/utils/audioStorage.ts`、`src/platform/files.ts`、`src/platform/files.test.ts`。
- Swift：`ios/App/App/ProjectRepositoryPlugin.swift`、`ios/ProjectRepositoryCore/Sources/ProjectRepositoryCore/ProjectRepository.swift`、`AudioStore.swift`、同Testsの `RepositoryTests.swift`、`AudioStoreTests.swift`。
- 検証/文書：`scripts/test-app-storage-browser.mjs`、`scripts/check-native-repository.mjs`、`docs/SPEC.md`、本書（新規）。

Swift自己レビューではserial queueへ入ってから保守ロックを取り、復旧はprivate処理を直接呼び、queue.syncの再入を避けた。復旧の置換時のlifecycle lockは再open前に解放する。OSのDocuments rootを先にcanonical化し、通常の `/var` → `/private/var` のaliasを拒否せず、子のsymlinkは拒否する。下書きは厳密なUTF-8/通常ファイルとして1件ずつ読み、読み取り不能なら音源削除を中止する。
