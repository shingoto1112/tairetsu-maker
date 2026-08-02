# iPadOS 移植監査レポート

最終更新: 2026-08-03

## 結論

現在の React/Vite 実装は Capacitor で再利用できる。キャンバス編集、タッチ、
ピンチズーム、長押し、画像/PDF生成は Web 標準 API が中心であり、全面的な
Swift 書き直しは不要である。

一方、保存・共有・音源・Supabase共同編集が `App.tsx` とブラウザ API に直接
結び付いている。iPad対応は、画面を複製するのではなくプラットフォーム境界を
先に作り、既存 Web/Tauri の実装をフォールバックとして残す方法が安全である。

## 現状と移植判断

| 領域 | 現在 | iPad対応 | リスク |
| --- | --- | --- | --- |
| プロジェクト保存 | `localStorage` の同期 API | native file mirror + 既存fallback | 中 |
| 音源保存 | IndexedDB Blob | native Filesystem + IndexedDB fallback | 高 |
| ZIP/.tairetsu | JSZip + Blob | 処理は共通、保存先だけnative化 | 低 |
| PDF/画像 | DOM画像化 + jsPDF | 生成は共通、共有シートへ渡す | 中 |
| ファイル保存 | File System Access / download | Filesystem + Share | 高 |
| ファイル読込 | `<input type=file>` | 初期はWebView picker、必要時native picker | 中 |
| タッチ編集 | Pointer/Touch events | 実機回帰確認が中心 | 中 |
| 長押し | 独自500ms処理 | 維持、iPad context menu競合を確認 | 中 |
| Fullscreen | Browser Fullscreen API | iPadでは専用表示状態へ抽象化 | 中 |
| Auth | Supabase + Web Storage | native session persistence/deep link対応 | 高 |
| クラウド | 共同編集を含む大規模state | personal cloud modeで機能境界を明示 | 高 |
| レイアウト | 横長デスクトップ中心 | portrait上部トレイを追加 | 高 |
| iOS build | なし | Capacitor + macOS GitHub Actions | 高 |

## 既存資産としてそのまま使える部分

- `Project`、`FormationFrame`、メンバー、道具、割当などの型
- 座標計算とスナップ処理
- `StageCanvas` / `ParadeCanvas` の描画とPointer操作
- 印刷用 `PrintPreview`
- JSZipによる共有ファイル形式
- PDFとPNGの生成ロジック
- SupabaseのRLS、owner権限、クラウドデータ構造

## 最初に分離する直接依存

1. `src/utils/fileSave.ts` と `src/utils/exportImage.ts` のdownload処理
2. `src/utils/storage.ts` の `window.localStorage`
3. `src/utils/audioStorage.ts` の `window.indexedDB`
4. `src/App.tsx` の `navigator.share` と object URL
5. `src/components/FormationLibrary.tsx` の共同編集UI
6. Browser Fullscreen APIを使う表示操作

## 保存戦略

プロジェクト保存APIは現在同期処理で広く呼ばれているため、一度にasyncへ変更しない。

1. Web/Tauriでは現在のlocalStorageを正式動作として維持する。
2. Capacitor iOSではlocalStorageへ即時保存し、native Filesystemへ非同期ミラーする。
3. 両保存先に保存時刻を持たせ、起動時は正常かつ新しい方を採用する。旧形式の
   localStorageが有効なら、意図した全削除を復活させないためlocalStorageを優先する。
4. native mirrorは保存を直列化し、一時ファイルから置換して世代バックアップを残す。
5. localStorageの破損・消失、または書き込み途中の終了時は、native本体・一時ファイル・
   バックアップのうち最新の正常データから復旧する。

音源は大容量になるためPreferencesやlocalStorageへ入れず、native Filesystemへ保存する。

本人専用クラウドの未同期下書きもnative Filesystemへ保存する。保存はプロジェクトごとに
直列化し、一時ファイルから本体へ置換して一世代のバックアップを残す。起動時は本体、
一時ファイル、バックアップのうち最新の正常データを採用する。iPadがバックグラウンドへ
移る時にも未保存下書きを書き出す。

## personal cloud mode

- `runtime.features.collaboration` を false にする。
- Authとクラウドproject APIは有効にする。
- project listは `role === "owner"` のみ表示する。
- share、invite、contacts、presence、preview購読を起動しない。
- 保存競合では既存versionを利用し、上書きではなく選択UIへ進める。
- Web版では従来の共同編集機能をすべて維持する。

## 検証マトリクス

| 機能 | Web | Tauri | iPad横 | iPad縦 | Offline |
| --- | --- | --- | --- | --- | --- |
| ローカル保存 | 必須 | 必須 | 必須 | 必須 | 必須 |
| ステージ編集 | 必須 | 必須 | 必須 | 必須 | 必須 |
| パレード編集 | 必須 | 必須 | 必須 | 必須 | 必須 |
| ZIP/.tairetsu | 必須 | 必須 | 必須 | 必須 | 必須 |
| PDF/画像 | 必須 | 必須 | 必須 | 必須 | 必須 |
| 音源 | 必須 | 必須 | 必須 | 必須 | 必須 |
| 本人クラウド | 必須 | 必須 | 必須 | 必須 | 接続時のみ |
| 共同編集 | 必須 | 必須 | 非表示 | 非表示 | 対象外 |

## 外部依存の未確定事項

- Bundle ID `jp.tairetsu.maker` の最終承認
- App Store Connectのアプリレコード作成
- App Store Connect API keyと署名付きTestFlight upload
- App Store向けアイコン、説明、プライバシーポリシー
- 実機TestFlight確認

Apple Developer Programへの加入と現行契約への同意、SupabaseのiOS Redirect URL、
GitHub `ios-testflight` EnvironmentとTeam ID secretは設定済み。

これらが未完了でも、署名なしiOS buildとアプリ本体の実装・テストは進められる。
