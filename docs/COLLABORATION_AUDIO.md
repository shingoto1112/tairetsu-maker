# 共同編集 第8回-3（8b）：共通曲・端末音源・持出し

2026-10-04 / `codex/ipad-release-20261002` / 開始 HEAD `9a792e4`。編集担当 Codex 1人。
consult13 の8b受入条件、SESSION/UI/STORAGE/NATIVE_AUDIO/RECOVERY_BACKUP文書を確認。
commit/push/install/新依存/workflow/本番接続なし。Project型・PrintPreview・ZIP形式・dist・未追跡HTTPS設定は変更しない。

## 判断と保存契約

- 共通曲は従来の `settings.song={name,type,size,duration?}` のまま。ファイル本体・端末ID・対応表・パスは共有CRDT/transportへ入れない。
- Repository の `CollaborationData.audioBindings=[{song,audio:AudioMeta}]` に端末対応表を保持。文書ごとの完全descriptor識別（固定順のJSON tuple、中央のID/hash追加なし）。別localStorageや別DBの非原子的な正本は作らない。
- 音源対応表を持つ付属JSONはローカル `schemaVersion:2`。旧付属schema 1も読み込める。schema 1→2は通常commit、2→1は拒否。旧クライアントは新付属schemaをUNSUPPORTED_SCHEMAとして拒否し、破損扱い/黙った対応表消失を避ける。共有の `documentSchema:2`、IndexedDB version 3、SQLite schema 2、ブリッジ版、共有schema/Edge/SQLは変更しない。
- body・付属データ・CRC・前世代・summary・CAS revision・receiptは従来と同じ原子保存。ローカル保存失敗時は編集・固定要求・新対応表を保持して再試行。初期化/upgradeで全件補完や不正行の書き換えを追加しない。1件の破損は個別復旧へ渡す。
- 複数タブのCASでは最後の保存済み対応表を基準に、このwriterが変更した曲だけを統合する。別タブが別の曲に選んだ対応を古い配列で巻き戻さない。競合時の端末Project.audioも現在descriptorの統合済み対応へ揃える。ファイルピッカーは開いた時点のcallback/descriptorを保持し、選択中の曲変更を拒否する。
- IDB音源レコードへAudioMetaを追加保存。新規音源の一覧はBlobをJSのバイト列にせずメタだけ取得。旧音源はRepositoryの参照から補う（1件ずつ）。iPadは既存AudioStore/workerにメタ一覧APIだけ追加し、パス/ファイル本体をブリッジへ返さない。
- 自動対応は曲名・type・サイズ・取得済みの長さが完全に一致する候補が1つだけの場合。長さ不明、複数一致、欠落は明示選択。保存済みの明示対応は別エンコード/異なる名前も許容し、元descriptorは変えない。再開時とdescriptor変更時にファイル実在を確認。非同期の古い結果は文書/descriptor世代で拒否。
- hashを追加しない理由：別エンコードで一致せず、曲の意味上の同一性を証明しない。閉じた共有schema、Edgeと旧クライアントの更新が必要。メタデータが同じ別曲の識別は保証できず、利用者が同じ曲を用意する前提の限界として残す。
- 毎フレーム/画面再描画時にCRDTを複製しない。再生可否は対応表だけの小さな投影を使い、候補探索はdescriptor変更/再開時に限定する。

## UIと安全境界

- 「曲を変更（全員に反映）」と「この端末の曲ファイルを選ぶ（自分だけ）」を別操作にする。保存済み音源の選択も可能。共通曲/端末曲/未対応を音源タブで表示。8a-1の一時window.confirmは除去。
- descriptor変更で旧audio要素のsrcを直ちに外す。対応が確定するまで再生しない。URLの非同期解決後にも対応を再確認する。選び直しは共有update/outbox/Undo項目を作らない。
- 全件バックアップ画面に「この端末に保存された文書のみ」「まだ取得していないクラウド文書を含まない」「復元は独立文書」を表示。
- V2 ONの旧CloudHelp/旧CloudShare表示と入口を非表示。旧アカウント画面は旧cloud props経路だけに残り、V2は共通認証を使う専用画面へ。旧draft・移行・共通認証・V2 OFFを残す。コードの物理撤去は第11回。
- 状態pillは縮小による省略をやめ、幅上限内では折り返す。日本語の状態文言を保ち、共有前後のtoolbar高さは維持する。利用者向けaria-labelの「V2 アカウント」は「アカウント」へ統一。

## ZIP・救出・バックアップ・GC

- 通常ZIPと手動全件バックアップは従来のmanifest/project.json/audio構成・formatVersion 1。現在のProjectとこの端末の音源だけを書き出す。token/account binding/参加資格/journal/outbox/Yjs/対応履歴を含めない。
- 音源なしZIPは従来どおり `audio:null`。共通descriptorを残すための新フィールドやZIP版変更は採用しない。再取込みは新ID・新音源IDの独立文書であり、元共有へ参加しない。既存ZIP/`.tairetsu`との互換性を維持する。
- 救出・前世代コピー・全件ZIPは現在descriptorに対応する端末参照をProject.audioへ取り出す。救出コピーでは共通曲変更前の古い音源を持ち出さない。独立文書には対応履歴を持ち越さず、現在曲のProject.audioを独立文書の参照契約とする。
- ネイティブ復旧DBは付属JSONを丸ごと含み、CRDT/outbox/全対応表/前世代/receiptを保持。復旧後のprovider資格再確認は既存の仕組みを維持し、bindingを送信許可として扱わない。
- IDB/Swiftのcurrent/previous/復旧DB参照走査に対応表音源も加える。共有付属データがある場合のGC全体延期を**維持**。旧共有・不透明な履歴・全救済経路を含む完全性の解除試験が未完了であり、今回対応表だけを根拠に解除しない。不正参照/不明データ/未完了移行/保存待ち/編集中タブの保護も維持。
- Swift変更理由は対応表の閉じた検証・原子保存/復旧の互換性・参照走査・メタ一覧のため。テーブル/列/バージョン/新worker/任意パスAPIは追加しない。既存fixtureは変更しない。

## 試験・画像

追加E2E：`node scripts/test-device-audio-app-browser.mjs`。実App V2 ON＋環境ファイルなしの独立Vite、2ブラウザー、loopbackモック、匿名の合成WAV。本番外ネットワークを遮断。
共有開始後の曲設定・自動対応して再生・曖昧な候補・別エンコードの明示対応・ローカルファイル選択・descriptor/outbox不変・再起動・曲変更後停止・ZIP/全件復元/救出・GC延期・旧UI・端末バックアップ範囲を検査。

画像は `C:\Users\shing\AppData\Local\Temp\claude\c--Users-shing-OneDrive--------ChatGPT-------\e5aa9c38-eb07-490c-ac06-62f047c4c161\scratchpad\shots-8b\`。
`audio-matched`、`audio-ambiguous`、`audio-selected`、`audio-missing`、`removed-audio` の各画面について
`-744x1133.png` / `-1133x744.png` / `-1032x1376.png` / `-1376x1032.png` の20枚。
`bounds.json`に文字範囲/要素範囲/scrollWidthを記録して切れを検査。縦画面は既存パネル高さ操作で音源状態まで表示する。実データ・個人名なし。

### 最終検証結果

Windows のローカル検証。環境ファイルを読まない Vite と loopback モックを使用。本番には接続していない。

| 検証 | 結果 |
| --- | --- |
| `npm test -- --maxWorkers 2` | 88ファイル・732テスト、2回合格 |
| 追加 `test-device-audio-app-browser` | 2回合格。2ブラウザー、再起動、曲変更中のファイル選択、ZIP・全件復元・救出・GC・4寸法 |
| `typecheck` / `git diff --check` | 合格 |
| `check-collaboration-bundle` | 通常・probe の Vite build と遅延読込検査に合格。一時出力を削除、dist未変更 |
| `test-collaboration-ui-browser` / `test-shared-session-app-browser` | 合格。旧API呼出し0、状態表示の切れなし |
| `test-collaboration-lifecycle-browser` / `test-collaboration-provider-browser` / `test-collaboration-app-browser` | 合格 |
| `test-build22-browser` | ステージ・パレード各12寸法と操作検証に合格 |
| `test-app-storage-browser` | a〜l合格、V2 OFFの既存音源・ZIP・バックアップ・GCを確認 |
| `test-indexeddb-browser` / `npm run test:repository:browser` | 合格。対応表の再起動・前世代・整合性と既存の不正レコード隔離を確認 |
| `check-collab-v2` / `check-native-repository` | 合格。後者は46 XCTestの構成・静的検査でありSwift実行ではない |
| `node --expose-gc scripts/bench-collab-v2.mjs` | 合格。146人×18シーン、履歴0: median 33.03ms / p95 49.90ms / heap 32.44MiB、履歴128: 135.28ms / 243.53ms / 50.00MiB |

メインJS: **473,569 B**（gzip 140,842 B、`index-B2ZhFhhN.js`）。基準470,691 Bから **+2,878 B / 約0.61%**。通常起動のchunkに共同編集・Yjsは入らない。ベンチ最終回はbuildと同時実行した観測値であり、単独環境の性能保証ではない。

### 変更ファイル

- 文書: 本書、`COLLABORATION_SESSION.md`、`COLLABORATION_STORAGE.md`、`COLLABORATION_UI.md`、`STORAGE_NATIVE_AUDIO.md`、`STORAGE_RECOVERY_BACKUP.md`。
- 共有/端末対応: `src/collaboration/deviceAudio.ts`・同test、`editorSession.ts`、`persistence.ts`、`sharedSessionController.ts`・同test、`src/repositories/audioBindings.ts`、`collaborationData.ts`、`types.ts`、`indexedDbRepository.ts`、`contract/testing/indexedDbBrowserSuite.ts`。
- 保存/音源/バックアップ: `src/storage/saveCoordinator.ts`、`deviceAudioProject.ts`、`bulkBackup.ts`、`recovery.ts`、`src/utils/audioStorage.ts`、`src/platform/audioStorage.ts`。
- UI: `src/App.tsx`、`src/components/AudioPanel.tsx`、`AudioFilePickerButton.tsx`・同test、`CollaborationSurface.tsx`、`FormationLibrary.tsx`、`StorageTools.tsx`、`collaboration.css`、`src/styles.css`。
- Native: `ios/App/App/AudioDocumentPickerPlugin.swift`、Coreの`AudioStore.swift`、`CollaborationValidation.swift`、`ProjectRepository.swift`、Testsの`AudioStoreTests.swift`、`CollaborationTests.swift`。
- 検証: `scripts/check-native-repository.mjs`、新規`test-device-audio-app-browser.mjs`。

合計40ファイル。`src/types.ts`（Project）、`PrintPreview.tsx`、`tairetsuFile.ts`、dist、SQL/Edge、依存関係、元の未追跡HTTPS設定を変更していない。

## Claudeへの確認・次回

- Linux：既存SQL/Edge/負荷CIを確認。今回SQL/Edge変更なし、Windowsのモック成功で実RLS/JWT/CORSの確認済みとはしない。
- macOS：`swift test --package-path ios/ProjectRepositoryCore`（46 XCTest）。9a792e4の2件に加え、対応表入りcurrent/previous/復旧DB/outbox/receipt不変、current/previous/backupだけの対応表参照に対するGC延期、メタ一覧を確認。iOS targetで新メタ一覧ブリッジもコンパイルする。
- Swift自己レビュー：型付き辞書・Data、同名変数なし、raw SQL helperのforeign_keys=ONを維持、throwing値をXCTUnwrapへ直接渡さない、/var比較追加なし。コンパイル/実行の代替として静的チェックを扱わない。
- 未確認：実iPad/WKWebView/Keychain、実共有シート・Files保存、実通信失効、大容量音源のメモリ/Range挙動、旧アプリへのダウングレード実行。本番へは接続していない。
- 第9回（履歴・控え・復元）：ローカルschema 2と対応表を保持。descriptorへUndoして戻ったとき既存対応を再評価。保持世代の対応表参照をGCへ含め、ACK/履歴回収と音源回収を別々に立証する。GC解除には旧共有/前世代/復旧候補/backup/保存待ちの完全性試験が必要。
- 第10回（プレゼンス・ドラッグ中表示）：端末対応付けはpresence/Realtimeへ出さない。音源候補探索や保存をpointermoveへ接続しない。provider状態とProject投影の分離を維持。
- 合意からの機能省略なし。許容されたGC延期・音源なしZIPの従来仕様を採用。ローカル付属schemaの明示更新は旧クライアントの誤破損判定を避ける互換策。
