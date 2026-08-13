# iPad版 リリース監査

最終更新: 2026-08-13

## 判定

署名付きarchive、TestFlightアップロード、内部テストは実施済み。Supabase接続と
アカウント削除migrationは復旧・適用済み。ただしプライバシーポリシー、custom SMTP、
App Store Connectのメタデータと破損・容量不足時の実機確認が残るため、App Store公開可能とは
まだ判定しない。

## 自動検証済み

| 要件 | 証拠 | 判定 |
| --- | --- | --- |
| TypeScript | `npm run typecheck` | 成功 |
| Web production build | `npm run build` | 成功 |
| iPad・互換性ユニットテスト | `npm test`、11 files / 34 tests | 成功 |
| Capacitor同期 | `npx cap sync ios` | 成功 |
| Windows/Tauri build | `npm run desktop:build` | 成功 |
| production依存脆弱性 | `npm audit --omit=dev` | 0件（DOMPurify 3.4.13へ更新） |
| macOS iOS Simulator build | GitHub Actions run 30767209452 | 成功 |

ユニットテストは、Web/Tauri/iPad機能フラグ、iOS Auth callback、ローカルプロジェクト
復旧、本人専用クラウド下書きの世代復旧、Keychainセッション、音源Blob保存、共有シート
用一時ファイルと後始末を直接検証している。
加えて、JSON、ZIP / `.tairetsu`、音源付きアーカイブ、共有先で二重ZIP化された
アーカイブが同じProjectデータへ戻ることを検証している。

## 実装証拠

- Capacitor iPad target、iPadOS 15 deployment target、iPad専用設定
- Privacy Manifest、App Icon、非免除暗号化の申告設定
- Web / Tauri / Capacitorのplatform adapter
- iOS KeychainによるSupabaseセッション永続化
- owner本人専用クラウド表示と、共同編集UI・購読の無効化
- オフライン下書き、競合確認、失敗時の下書き保持
- 横向き編集サイドバーと縦向き上部編集トレイ
- GitHub Actionsの署名なしbuildとTestFlight upload workflow
- Supabase Redirect URL `jp.tairetsu.maker://auth/callback`
- パスワード再確認・最終確認モーダル付きのアプリ内アカウント削除UIと削除RPC migration
- パスワード再設定、確認メール再送、ログイン中のパスワード変更
- Web / iPadの回復リンク判定と期限切れリンクの日本語案内

開発依存にはCapacitor CLI内部の`xcode -> uuid`にmoderate警告が残る。`npm audit fix
--force`はCapacitor CLIのダウングレードを提示するため適用せず、Capacitor公式更新で解消する。

## Apple側の状態

- Apple Developer Program: 加入済み
- 現行契約: 同意済み
- GitHub `ios-testflight` Environment: 作成済み
- `APPLE_TEAM_ID` secret: 登録済み
- Bundle ID: `jp.tairetsu.maker` で確定
- App ID: `Tairetsu Maker` / `jp.tairetsu.maker` を登録済み
- App Store Connectアプリレコード: iOS「隊列メーカー」を作成済み
- App Store Connect APIアクセス: 申請・承認済み
- App Store Connect API key secrets: GitHub `ios-testflight` Environmentへ登録済み
- 対象iPad: Apple DeveloperのiPad端末として登録済み
- TestFlight upload: GitHub Actions run 31709533972でビルド10のアップロードに成功
- App Store Connect: バージョン1.0の内部テストを継続中
- 内部テスト: 「チーム内テスト」グループを作成し、本人をテスターへ追加済み

## TestFlight実機で必ず確認する項目

- iPad Air 13インチ 2024でインストール・起動できる
- 横向きと縦向きでステージ/パレードを編集できる
- Split ViewとソフトウェアキーボードでUIが重ならない
- タッチ移動、複数選択、長押し、ピンチズーム、オートスクロール
- Undo / Redo、シーン、メンバー、道具、割当、メモ、設定
- 音源読み込み、再生、アプリ再起動後の復元、機内モード再生
- PNG、PDF、JSON、`.tairetsu`、ZIPの読み込み・共有
- 既存Supabaseアカウントのログインとセッション復元
- owner本人のクラウドプロジェクトだけが通常表示される
- オフライン編集、再起動後の下書き復元、競合時の無断上書き防止
- iPad書き出しデータをWeb/Windows版で再度開ける

実機確認結果は、端末、iPadOS、TestFlight build番号、合否、再現手順をこの文書へ追記する。
