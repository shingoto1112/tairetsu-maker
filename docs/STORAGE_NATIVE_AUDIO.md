# 保存方式の作り直し 第7回: iPad音源

## 保存・対応表の判断

- 実iPad（`getAppRuntime() === "capacitor-ios" && Capacitor.isNativePlatform()`）のみ新経路。Web/Windowsと開発用iPad再現は既存IndexedDB/Blob。Project型、AudioMeta型、音源ID、音声のエンコード、ZIP形式は維持。
- `Library/Application Support/TairetsuMaker/v2/audio/` に、不変の音源ファイルと `index.json`（ID → ランダムUUIDキー・拡張子・AudioMeta）を置く。ID、元ファイル名、絶対パスを保存ファイル名に使用しない。読み出し時もキーと拡張子を検証。絶対URLはその時の解決結果にだけ含める。
- SQLite新テーブルならインデックス検索・将来のGCに有利。ただし音源ファイルとSQLiteを単一ACIDトランザクションにはできない。今回は削除なし・不変の音源を先に確定してからProjectへ参照を付けるため、Projectとの同一トランザクションは不要。独立メタJSONを選択し、既存SQLiteのスキーマ/復旧コピーを変更しない。本文保存失敗や応答喪失時は孤立音源が残るが、既存の参照は壊さない。
- 対応表は毎回読取、更新は単一ネイティブworker上で直列化。ファイル数が増える際のJSON読取/書込コスト、対応表破損時の復旧、孤立ファイルのGCは第10/11回で検討。別インスタンス/複数プロセスによる同時更新は契約外。
- 許可する拡張子はmp3/m4a/wav/aac/aif/aiff/caf。対応MIMEはcoreの固定表、明確な不一致は拒否。不明MIMEは検証済み拡張子、拡張子なしの旧ZIPメタは既知MIMEで補完。aifの保存拡張子だけaiffへ正規化（音源・元のname/typeは変換しない）。
- 同じディレクトリ内の `.partial` へコピー → サイズとチャンク単位の全バイト比較 → synchronize → 原子的rename → 同期したメタJSON一時ファイルのreplace/move。ハッシュの代わりに完全比較を採用し、Foundationのみで検証できる。既存対応表を先に削除しない。
- 音源・対応表の保護クラスはSQLiteと同じ `completeUntilFirstUserAuthentication`。iCloudバックアップから除外しない。Info.plist、pbxproj、CapApp-SPM、依存パッケージの変更は不要。

## 取込み・再生・ZIP

- ピッカーはサイズ/形式を確認後、ネイティブ一時コピー → AVFoundationによるduration取得 → store確定。JSへはAudioMetaのみ返す。コピー/検証/保存はmain thread外。duration取得はiOS 15で使える非同期 `loadValuesAsynchronously`（新OSではdeprecated）を採用。取得失敗時はdurationを省略し、既存audio要素のmetadata通知がUIの長さを補う。JS metadata方式もURLだけで可能だが、取込み確定前に別JS/メディア往復が増えるため不採用。
- 再生/復元は毎回IDから解決 → `Capacitor.convertFileSrc` → audio.src。`preload="metadata"`。JSによる全量fetch/base64/Blobは通常再生に使わない。Webでは既存object URL、解放はblob URLに限定。
- [Capacitor 8.5 asset handler](https://github.com/ionic-team/capacitor/blob/8.5.0/ios/Capacitor/Capacitor/WebViewAssetHandler.swift)の実装とローカルnode_modulesを確認済み。Rangeありは要求範囲をDataに読み、206を返す。RangeなしのmediaはmappedIfSafe。WebKitのRangeサイズはアプリから強制できず、`bytes=0-` 等で大きなネイティブDataになる可能性は残る。CAFはmedia拡張子リストに含まれず、Rangeなしでは通常Dataの全量読込。依存のasset handlerを改変せず、全形式の実機検証をリリース条件にする。
- ZIP書出しだけは解決URLを `Range: bytes=0-` で全量fetchしBlob化。HTTPエラー/サイズ不一致を拒否、status 0の完全なレスポンスは互換扱い。これは第10回までの全量メモリ経路。
- ZIP取込みは既存Blobを192KiBずつbase64にして順番/offset付きでネイティブ一時ファイルへappend、サイズ確認後storeへコピー確定。全量base64は作らない。現行Capacitor bridgeは文字列転送のため小分けのbase64は残す。任意パスを受け取るAPIや別のHTTP uploadサーバーは導入しない。失敗時はabort、クラッシュ時の残りは第10回のGC対象。

## 旧音源の引き継ぎ

- 再生/書出しでIDが新対応表にない時、Projectの既存AudioMetaを使って遅延移行。起動時の一括走査は行わない。旧IDをパスに使う時だけ英数字/ハイフン/アンダースコアのallowlistを通す。
- `@capacitor/filesystem` の `CAPPluginCall+Accelerators.swift` はencoding未指定をbyteBuffer扱いとし、`Data.capacitor.data(base64EncodedOrDataUrl:)` でデコードしてwriteへ渡す。このアプリの旧 `.data` は通常は生バイナリ（JSでbase64化した文字列そのものではない）。`Directory.Data` はDocumentsを指す。
- `.data` のサイズがAudioMeta.sizeと同じなら生データとしてコピー。不一致ならbase64テキストとして64KiBずつ厳密にdecode、出力サイズを確認。その後同じstore確定経路でサイズ/全内容を検証。旧 `.data` と `.json` は一切削除しない。ID、duration、Project参照は変更しない。
- コピー/配置後に失敗しても対応表は旧状態。次回は再実行可能。移行失敗時はプラグインの明示的legacy信号で既存Filesystem読取→Blob経路へ戻す。生バイナリはreadFileのbase64を1回、旧base64テキストは2回decode。サイズ不一致を拒否。フォールバックでは全量メモリが必要なので容量不足/移行障害時の救済に限定。

## 検証とClaudeへの申し送り

- Swift coreはFoundationのみ追加。新XCTestは13件。空/異種リテラルの型を確認し、XCTUnwrapへthrowing呼出しを直接入れていない。Swift compilerがこのPCにはなく、コンパイル/実行済みとは扱わない。
- macOS: `swift test --package-path ios/ProjectRepositoryCore`（既存全テスト含む）。特にFoundationのreplaceItemAtによる2件目以降の対応表更新、FileHandleのread/write/seek/synchronize、decodeチャンク境界、確定後の故障→再実行、旧ファイル保持を確認。iOS targetでAVFoundation/Capacitor bridgeもコンパイルし、OS標準frameworkのリンクと既存plugin登録を確認。coreへのAVFoundation/UIKit依存はない。
- Windows側の実行結果: 全Vitestを2回実行して549件（68ファイル）、552件（69ファイル）合格。最後のApp世代固定変更後は関連5ファイル53件の限定回帰も合格。audioPickerは15件を維持。`npm run typecheck`、`git diff --check`、`node scripts/check-native-repository.mjs` 合格。指定Repositoryブラウザ試験（既存音源IndexedDB/abort/CAS/移行30ケース/200・1000件計測）とApp保存ブラウザ試験a〜h合格。hでWeb・ネイティブなしiPadの匿名WAV保存/Blob URL復元/メタデータ読取/ZIP往復を確認。Vite最終メインチャンク487,715 bytes（500kB未満）、作業内一時出力は削除済み。制限下の初回Vitestはesbuildの親ディレクトリ参照で起動できず、承認済みローカル検証として権限調整して実行。サーバーは起動/停止していない。

変更ファイル: `ios/ProjectRepositoryCore/Sources/ProjectRepositoryCore/AudioStore.swift`、同Testsの `AudioStoreTests.swift`、`ios/App/App/AudioDocumentPickerPlugin.swift`、`src/platform/audioStorage.ts`・`audioPicker.ts` と各テスト、`src/utils/audioStorage.ts`・`audioStorage.test.ts`・`audioNativeRouting.test.ts`、`src/App.tsx`・`AppRoster.test.tsx`、`src/components/AudioFilePickerButton.tsx`・`AudioPanel.tsx`・`FormationLibrary.tsx`、`scripts/check-native-repository.mjs`・`test-app-storage-browser.mjs`、`docs/SPEC.md` と本書。合意からの範囲逸脱はない。小分けbase64、移行失敗時の旧Blob、ZIP書出し時の全量Blob、CAFのRangeなし全量Dataは明示した制約。

## 実機確認（未実施）

1. 200MiB級をFiles/iCloudから取込み、時間・空き容量・JS heap/ネイティブRSSの最大値をInstruments/Web Inspectorで測る。小分け転送のZIP取込みとも比較。
2. mp3/m4a/wav/aac/aif/aiff/cafの再生、先頭/中間/末尾シーク、連続シーク、ループ/速度変更。Rangeヘッダー/206/Content-Range、Rangeなしと全範囲要求のメモリを観察。CAFを必ず含める。
3. バックグラウンド→復帰、端末ロック/解除、初回ロック解除前、アプリ強制終了/再起動後の再生。音源選択/コピー中に画面遷移しても別Projectへ結果を付けないこと。
4. 生バイナリ/テキストの旧音源を再生/ZIP書出しで移行。途中強制終了・故障後の再試行、旧ファイル保持、複製Projectによる同じID参照を確認。
5. 空き容量不足を一時コピー、確定コピー、対応表更新、ZIP uploadの各段階で発生させ、旧再生/参照が残り、再試行できること。フォールバック時のメモリも観察。
6. 音源込みZIPの書出し/再取込み（200MiB級含む）、ZIP音源なし、再起動後の再生、長さ/名前/typeの維持。
7. iCloudバックアップ/別コンテナへの復元後、IDだけでURLを再解決できること。対応表と音源のバックアップ対象/保護クラスを確認。

## 第8回への申し送り

共同編集8bの対応表はAudioStoreのID→ファイル対応とは別にRepository付属JSONへ原子的に保存する。既存AudioStoreへパスを返さないメタ一覧APIを追加。GCは共有文書/前世代/復旧DBがあれば延期を維持。詳しくは [COLLABORATION_AUDIO.md](./COLLABORATION_AUDIO.md)。

音源本体/ネイティブパスはSupabaseへ送らない。ローカル音源確定とProject CASは独立し、本文競合時も音源を削除しない。第8回のSQL案では既存AudioMeta/共同編集versionを維持し、CAS・snapshot・排他・再送receiptを設計する。本番SQL/RPC適用と新同期有効化は今回の範囲外。第10回で音源GC/対応表復旧/ZIPメモリ対策を合わせて設計する。
