# iPadOS アプリ版仕様

最終更新: 2026-08-03

## 1. 目的

既存の React + TypeScript + Vite 実装を共通基盤として、隊列メーカーを iPadOS
向けアプリとして提供する。初期配布はチーム内 TestFlight とし、将来の有料
App Store 公開に耐えられる構造を維持する。

初期版は共同編集を提供しない。ただし共同編集用の Supabase テーブル、RPC、
保存形式は削除せず、iPad 版では共有・招待・連絡先・Realtime 購読の導線だけを
無効化する。

## 2. 採用技術と公式要件

- ネイティブコンテナ: Capacitor 8.5 系
- Web ランタイム: WKWebView
- Node.js: 22 以上
- iPadOS deployment target: 15.0 以上
- Xcode: 26.0 以上
- iOS 依存管理: Swift Package Manager を基本とする
- Auth セッション: iOS Keychain (`whenUnlockedThisDeviceOnly`)
- Web assets: Vite の `dist` を `webDir` として同期する
- 暫定 Bundle ID: `jp.tairetsu.maker`
- 表示名: `隊列メーカー`

Bundle ID は App Store Connect のアプリレコード作成前にユーザーが最終確認する。

公式資料:

- [Capacitor Environment Setup](https://capacitorjs.com/docs/getting-started/environment-setup)
- [Capacitor iOS](https://capacitorjs.com/docs/ios)
- [Capacitor configuration](https://capacitorjs.com/docs/basics/configuring-your-app)
- [Apple TestFlight](https://developer.apple.com/testflight/)
- [Apple distribution](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases/)

## 3. 対象端末

- 主対象: iPad Air 13 インチ 2024 年モデル、最新 iPadOS
- iPad 専用アプリとして設定する
- 横向きを主操作方向とする
- 縦向きでも閲覧専用にせず、主要編集をすべて利用可能にする
- Split View、Stage Manager、ソフトウェアキーボード、Safe Area を考慮する

## 4. 初期版の機能範囲

### 含める

- ローカルプロジェクトの作成、編集、保存、複製、削除
- ステージモードとパレードモード
- メンバー、道具、割当、シーン、音源、メモ、設定
- タッチ移動、複数選択、長押しメニュー、ピンチズーム、オートスクロール
- Undo / Redo
- PDF、画像、JSON、ZIP、`.tairetsu` の読み込みと書き出し
- iPad のファイルピッカー、共有シート、ファイルへの保存
- 共有シート経由の画像保存
- 音源の読み込み、端末内保存、オフライン再生
- 既存 Supabase アカウントでのログイン
- 本人が owner のクラウドプロジェクトの保存と読み込み
- オフライン時のローカル編集

### 初期版では隠す

- 共同編集
- 招待、共有管理、連絡先
- 他ユーザー所有プロジェクト
- Realtime のロック、preview、presence、保存通知

## 5. 正式データと互換性

- `Project` JSON を Web / Tauri / iPad 共通の正式データとする。
- 既存の補完・移行処理を通し、iPad 固有フィールドを `Project` に混ぜない。
- ZIP / `.tairetsu` の `manifest.json` と `project.json` 形式を維持する。
- Web で作成したファイルを iPad で読み込み、iPad から書き出したファイルを
  Web と Tauri で再度開けることをリリース条件とする。
- 既存の localStorage / IndexedDB データを破壊しない。

## 6. プラットフォーム境界

画面コンポーネントはプラットフォーム API を直接呼ばず、次のアダプターを使う。

- runtime: Web / Tauri / Capacitor iOS の判定と機能フラグ
- files: ファイル保存、共有、インポート
- project storage: ローカルプロジェクトの永続化
- audio storage: 音源 Blob の永続化
- auth storage: Supabase セッションの安全な永続化
- display: Fullscreen、画面方向、Safe Area

Web/Tauri では既存実装へフォールバックする。iPad では Capacitor API を使用し、
ファイルや音源の大容量データを Preferences に保存しない。

iPad のSupabaseセッションは `sessionStorage` だけに依存せず、Keychainへ暗号化して
保持する。トークンは `UserDefaults`、localStorage、リポジトリ、CIログへ保存しない。

## 7. クラウド仕様

- Web 版と同じ Supabase project URL / publishable key を使用する。
- service role key はアプリ、GitHub、ビルド成果物に置かない。
- iPad 初期版では owner のプロジェクトだけを一覧表示する。
- 新規クラウド保存は本人を owner とする既存 RPC を利用する。
- 共有プロジェクトは削除せず、iPad 初期版の UI から隠す。
- オフライン編集はアプリのData領域にプロジェクト単位の端末下書きとして保持する。
- 下書きには同期元のクラウド更新時刻を保持し、再接続時に無条件上書きしない。
- クラウド側が更新済みなら競合として停止し、端末版を保持するか、確認後にクラウドを
  上書きするかを選ぶ。同期失敗時も端末下書きを削除しない。
- クラウド同期は既存のowner権限、project import lock、transactional RPCを再利用し、
  service role keyを使用しない。
- AuthコールバックURLは `jp.tairetsu.maker://auth/callback` とする。

## 8. UI の正式名称

- アプリヘッダー: 一覧、保存、アプリ名、プロジェクト名を含む上部領域
- メインワークスペース: アプリヘッダーより下の編集領域全体
- 編集サイドバー: 横向き時の左側編集領域
- 機能タブレール: シーン、メンバー、道具、割当、音源、メモ、ステージ、詳細の縦タブ
- タブ内容パネル: 選択中タブの編集内容
- シーンナビゲーター: シーンカードを並べる領域
- シーンカード: 各シーンの小窓
- モード操作パネル: ステージ/パレード固有操作の領域
- パレード操作パネル: パレードの前シーン反映、表示、移動操作の領域
- ステータス通知バー: 保存結果などを表示する通知領域
- 隊列ビューポート: 現在画面に見えているスクロール領域
- 隊列キャンバス: 方眼を含む配置面全体
- キャンバス空白部分: メンバーや道具がない方眼部分
- 方眼セル: 背景方眼の一マス
- メンバーセル: 円形のメンバー要素
- 道具セル: 矩形などの道具要素
- メートル目盛り: キャンバス周辺の距離数値
- 中央線: 横方向中央の基準線
- 基準線: 0m、5m、10m などの強調線
- キャンバススクロールバー: 隊列ビューポートのスクロールバー

縦向き専用の名称:

- 上部編集トレイ: 画面上部から展開する編集領域
- 機能タブバー: 横並びの機能タブ
- タブ内容ストリップ: 横スクロール可能な編集コントロール
- シーンストリップ: 横スクロール可能なシーンカード列
- モード操作ツールバー: 横並びのステージ/パレード操作

## 9. レイアウト仕様

### 横向き

- 左から編集サイドバー、シーンナビゲーター、モード操作パネル、隊列ビューポート
  の既存構成を基本とする。
- 編集サイドバー内部は縦スクロールする。
- 隊列ビューポートの面積を優先する。

### 縦向き

- 隊列ビューポートを画面中央の主要領域にする。
- 編集操作は上部編集トレイに展開する。
- 機能タブバー、タブ内容ストリップ、シーンストリップ、モード操作ツールバーは
  横スクロールできる。
- トレイを閉じても選択状態とスクロール位置を維持する。
- ソフトウェアキーボード表示中も選択対象と確定ボタンを見失わない。

## 10. 配布とCI

- Windows では TypeScript、Web、レスポンシブ UI を検証する。
- GitHub Actions の macOS runner で Capacitor sync と iOS Release build を行う。
- 署名なし simulator build を常時 CI gate とする。
- Apple Developer 登録後、App Store Connect API key と署名情報を GitHub Secrets に
  登録し、archive / export / TestFlight upload を有効にする。
- 秘密情報が未登録の fork や pull request では upload step を実行しない。
- FilesystemのRequired Reason APIはアプリのPrivacy Manifestで `C617.1` を宣言する。
- 詳細な準備と配布手順は `docs/IPAD_TESTFLIGHT_SETUP.md` に従う。

## 11. 完了条件

- Web と Tauri の主要操作が回帰していない。
- iPad 横向き・縦向きで主要編集が行える。
- iPad でファイル入出力、音源、画像/PDF、ログイン、本人専用クラウド保存が動く。
- オフラインで編集でき、再接続時にデータを無断で上書きしない。
- macOS CI で iOS build が成功する。
- TestFlight build を実機へインストールし、主対象 iPad で確認できる。
