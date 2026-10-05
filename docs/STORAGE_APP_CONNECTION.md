# 保存方式の作り直し 第5回（第5・6回統合）

## 第11回：反復計測と旧書込みの撤去（2026-10-05）

反復計測・前後比較・iPad実機項目は [STORAGE_PERFORMANCE.md](./STORAGE_PERFORMANCE.md)、依存を変更しない監査は [STORAGE_DEPENDENCY_AUDIT.md](./STORAGE_DEPENDENCY_AUDIT.md) を参照。下記の単発435/1,203/656msは過去の記録で、今回のp95として使わない。

一覧→本文1件のRepository接続と正規化は維持し、画面外のシーン小窓SVGを遅延描画、可視SVGをmemo化する。全シーンの固定サイズのボタン・ラベル・presenceは維持する。Project/ZIP/PrintPreview/座標/保存・復旧の形式は変更しない。性能目標の判定は開発サーバーと実機の違いを明記した上記記録で行う。

旧 `utils/storage.ts` の通常保存と書き戻すhydrate、`platform/projectStorage.ts` の旧ミラーwriter/queueは通常Appにも救出にも参照がないため撤去した。現在の移行・救出はread-onlyの`storage/legacyReaders.ts`に一本化済み。読取不能1件で保存領域全体を開けなくする検証は追加しない。利用者の旧原本は自動削除しない。

旧本人クラウドdraftのwriterも第11回-2で撤去済みで、下記第5回の「既存下書き保存を維持」は過去の記録。現行の明示取込み・救出は [STORAGE_MIGRATION.md](./STORAGE_MIGRATION.md) の第11回-2を参照。

第11回の最終確認：Vitest 99ファイル/834件×2、typecheck、一時build、bundle/nativeチェック、指定browser全試験成功。build22と追加小窓試験はDEV条件で各2回、待機前提を直したhistory/presenceも各2回。main JSは371,369 B（基準から+1,294 B）。開く1秒/一覧300ms/フレーム落ちなしは全条件では未達で、V2 ON後半の遅延変動とiPad実機は申し送りに残す。詳細・失敗した試験環境の修正経緯は性能記録を参照。

## 接続と判断

- ローカル隊列表の正本はWeb/WindowsではIndexedDB、iPadアプリではSwift SQLite Repository。Appから旧localStorageの3キーと `projects/*.json` ミラーへの通常保存・hydrateを呼ばない。旧データは削除しない。旧ビルドへの戻りは保証しない。
- 起動はRepository選択 → `runStorageBootstrap` 完了待ち → summary一覧 → 操作解放。待機・進捗・種類別エラーを既存一覧に表示する。`canContinue=false` では操作を止め、trueなら移行済みデータを利用できる。内部の空ProjectはReactの表示用だけで、保存・sample生成・旧データ復元には使わない。
- Webは起動時に一度だけ `navigator.storage.persist()` を試し、結果をconsoleに記録する。拒否・非対応でも保存方式やUIは変えない。永続化許可はバックアップの代替にはならない。
- 一覧は現行の全件カード表示を維持。`ProjectSummary` を100件ずつcursorで取得し、IDを重複排除する。本文取得なし。cursorはliveなので、他のウィンドウが並べ替える間の完全な一覧snapshotは保証しない。次回一覧取得で更新する。
- 開くときだけ対象1件を `get` + `touchOpened`。途中に別ウィンドウの更新があれば対象1件を再読込し、古い本文に新しいCAS revisionを付けない。開いた直後はclean。名前変更・削除は一覧で見たrevisionをCAS照合、複製・取込み・独立ローカルコピーは新ID/create-only commit。
- 新規作成・ZIP/JSON取込みは音源保存 → 本文1件commit → 編集画面。正常時に本文を二重保存しない。本文commitに失敗した場合も作成・取込み済みのProjectを編集画面に保持し、再試行とZIP退避を可能にする。既存の音源保存失敗時の「音源なしで開く」は維持。

## coordinatorと失敗時

- `SaveCoordinator` は隊列表ごとの直列キューと固定snapshotを持つ。localRevisionは編集操作ごとに増加し、persistedRevisionは確定したsnapshotのrevisionまで進む。dirtyは両者の比較。r保存中のr+1は同じflushで続けて確定する。保存済みの非アクティブなProjectをcoordinatorが蓄積しない。
- 800msの編集停止、まとめ編集終了後250msの既存待機値を維持。手動保存、一覧へ戻る、別隊列表を開く、pagehide、beforeunload、visibilitychange(hidden)、Capacitorの非アクティブ化はflush。
- 保存receiptが遅れても、別のProjectの画面・dirtyを変更しない。読込の世代番号で古い読込・音源復元結果も排除する。
- 失敗してもProjectとdirtyを保持する。応答喪失を考慮し、失敗した固定snapshotとoperationIdを再試行してから後続の編集を保存する。エラー表示は通常のお知らせから独立して継続する。
- 容量不足では編集中ProjectのZIPを書き出せる。通常のZIP書き出しにも保存成功を前提にしない。CONFLICTは自動上書き・自動再送を止め、「別の隊列表として保存」「読み込み直す」を表示する。再読込は未保存編集の破棄を確認し、読込失敗時や待機中の追加編集では画面を保持する。コピーの保存中に編集が増えた場合も元の編集を保持する。
- pagehide等で始めた非同期処理の完了はブラウザ/OSが保証しない。hiddenとnative非アクティブ化でも早めにflushするが、強制終了の確定性はiPad実機で検証する。

## 下書き・音源・クラウド

- 本番の `legacy-projects-v1` bootstrapはreaderに `includeDrafts:false` を指定する。`personal-cloud-drafts` の列挙・読取を行わず、draftコピーを通常一覧へ追加しない。台帳・draft判定の部品と既存契約試験は維持する。第9回は独立batch IDを用い、現在の本人クラウド下書きを重複移行しない設計が必要。
- 本人クラウドは `persistLocal:false`、既存下書きファイル、既存手動同期を維持。共同編集のセル/シーン/リソース保存もローカルcoordinatorへ流さない。ログアウトによってRepositoryを削除しない。
- **隊列表削除時に音源は削除しない。** 複製は同じaudioIdを参照するため、第10回のGCまで孤立音源が残る。取込みで音源保存後に本文commitが失敗した場合にも、孤立音源が残り得る。既存の音源形式・ZIP形式・Project型は変更しない。

## Windowsでの検証（2026-10-03）

- Vitest全体3回成功：初回68ファイル/538件、追加のApp起動ゲート・背景化・容量不足試験を含む2回は各68ファイル/541件。coordinatorは直列化、r/r+1（rの完了時にもr+1のdirtyを保持）、固定snapshot、応答喪失の同じoperation再試行、dirty保持、切替、CONFLICT、作成失敗後の再保存を確認。既存AppテストはMemory Repository注入へ変更。native TS adapterの既存テスト用JSON bridge契約も実行。
- `scripts/test-app-storage-browser.mjs`：既存 `http://127.0.0.1:5179` と毎ケース新規コンテキストでa〜g成功。旧5件＋直近キーの移行/旧キー不変、新規・自動/手動保存・再読込・再度開く、名前変更/複製/削除、許可された2 ZIP、quota注入/編集保持/ZIP退避/再試行、2タブ競合/コピー/確認付き再読込、50件とオフラインで開く。実ZIPの内容はログに出さない。
- 50件×422,685 bytesの匿名Project（200人/45シーン）、Chromium 149.0.7827.55、Windows 10.0.26200 x64、Ryzen 7 7735U。Repositoryの30回warm計測：

| 操作 | p50 | p95 | 最大 |
|---|---:|---:|---:|
| summary一覧50件 | 1.7ms | 9.7ms | 10.2ms |
| 本文1件取得 | 12.7ms | 21.5ms | 38.3ms |
| 本文1件commit | 36.9ms | 52.7ms | 59.2ms |

UI単発計測（Playwright操作・状態確認の時間を含む）：一覧435ms、開く1,203ms、手動保存656ms。開く時間は設計案の1秒目標を少し超えた。Repository I/Oは速く、45シーンの初回描画等を含むUI側は第11回でcold/warmの反復計測とプロファイルが必要。単発値をp95とは扱わない。

- `npm run typecheck`、一時フォルダへのVite build、`git diff --check`、`npm run test:repository:browser`、`node scripts/check-native-repository.mjs` 成功。Repositoryブラウザ試験は契約50手順、移行30ケース、故障注入・2ページCAS・200/1000件。mainは486,587 bytes（gzip 140.94kB）で500kB未満、Repository/移行実装は動的import、ビルドは警告なし、出力は確認後削除。
- dev serverの起動停止、install、commit/push、workflow実行、本番通信・SQL変更なし。Swift・Project型・ZIP形式・PrintPreview・dist等の禁止対象を変更していない。

## 未確認と次回への申し送り

- 本PCではSwift/SQLite実行、iPad実機、認証されたクラウドの実通信は未確認。既存クラウド変換・保存処理は変更していないが、本人クラウドの下書き保存/復元と共同編集のセル/シーン保存は実機/検証環境で回帰確認する。
- iPadでは旧ミラー移行/再起動/下書きが一覧に増えないこと、ホーム画面移行/ロック/非アクティブ化/保存直後の強制終了、低空き容量/DEVICE_LOCKED/IO_ERROR、保存中の追加編集、失敗後のZIP退避、音源付き取込み、オフラインで開く、ログアウト後のローカル一覧維持、iCloudバックアップ復元を確認する。
- 第7回：音源はまだ既存のネイティブBlob/base64経路。pickerのネイティブ直接コピーとファイルURL再生へ切り替える。既存audioId・複製共有参照を維持し、200MiB級のcopy/seek/再起動/欠落/中断を実機で検証する。孤立音源の削除は第10回GCへ残す。

## Claude レビュー時の追加修正（2026-10-03）

- 開発用の `?runtime=capacitor-ios`（ブラウザで iPad 画面を再現するモード）では native プラグインが存在せず、起動時の保存準備が失敗して一覧を操作できなかった。保存先の選択を「iPad 判定かつ `Capacitor.isNativePlatform()`」に変更し、ブラウザでの再現時は iPad 画面のまま IndexedDB に保存する。実機は常に Swift SQLite。
- `NativeSqliteProjectRepository` を作り直すたびに `registerPlugin("ProjectRepository")` が呼ばれ、Capacitor の二重登録警告が出ていた。登録はページ内で1回にした（2回目以降も同じ proxy が返るため動作は同じ）。
- Codex 作業は利用上限で最終報告の直前に停止したが、作業ツリーの状態で typecheck・vitest 541件・アプリ保存 E2E（a〜g）・Repository ブラウザ試験・native 事前検査・ビルド（main 486.89 kB）を Claude が再実行し、すべて合格。iPad 画面再現モードでの既存確認（6 サイズの縦横レイアウト、ステージのピンチとシーン別表示、名簿1枚画像、音源の保存と再読込）も合格。
