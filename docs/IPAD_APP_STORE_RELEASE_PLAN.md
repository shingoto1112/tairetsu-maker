# iPad App Store公開計画

最終更新: 2026-08-13

## 目的と固定方針

- Web / Tauri / iPadで同じ `Project` 保存形式を維持する。
- iPad初期版は、同一アカウントの本人専用クラウド保存だけを提供する。
- iPadでは招待、共有管理、連絡先、presence、Realtime、セルロック共同編集を起動しない。
- service role keyはアプリ、GitHub、Vercelへ置かない。
- ローカル隊列表はログアウトやアカウント削除で消さない。

## Release Gate 0: クラウド復旧とアカウント削除

### 実装済み

- iPadはWeb版と同じSupabase API/RPCを使用し、ownerの隊列表だけを表示する。
- Keychainセッション、端末下書き、オフライン保持、競合確認を維持する。
- TestFlight buildへSupabase URL / publishable keyを渡すworkflowを追加する。
- パスワード再確認と「削除」入力を伴うアカウント管理画面を追加する。
- アカウント削除RPCを追加する。唯一所有するクラウド隊列表は完全削除し、共同所有は
  別ownerへ引き継ぎ、参加情報・連絡先・認証ユーザーを削除する。
- ローカル隊列表は残す。

### ユーザー操作

- Supabase Dashboardで既存projectが一時停止、削除、またはURL変更になっていないか確認する。
- 復旧不能なら新しいSupabase projectを作り、Project URLとpublishable keyを取得する。
- SQL Editorで最新migrationを適用する。
- GitHub `ios-testflight` Environmentへ次を登録する。
  - Variable: `VITE_SUPABASE_URL`
  - Secret: `VITE_SUPABASE_ANON_KEY`
- Vercelにも同じ値を登録し、Web版とiPad版の接続先を一致させる。
- Auth Redirect URLに `jp.tairetsu.maker://auth/callback` があることを確認する。

## Release Gate 1: 認証・プライバシー

### Codex実装

- パスワード再設定、確認メール再送、パスワード変更、期限切れリンクの画面を追加する。
- アプリ内にプライバシーポリシー、問い合わせ、利用規約への導線を追加する。
- App Store ConnectのApp Privacy回答とPrivacy Manifestの整合性を検査する。
- 認証・削除エラーを利用者向けの日本語へ統一する。

### ユーザー操作

- プライバシーポリシーとサポートページを公開URLで用意する。
- Supabase Authへ本番用custom SMTPを設定し、送信元ドメインを認証する。
- App Store ConnectのApp Privacy、年齢区分、サポートURLを入力する。

## Release Gate 2: データ消失・ファイル安全性

### Codex実装

- 内部プロジェクト、音源、クラウド下書きをFilesアプリへ露出しない保存領域へ整理する。
- バックグラウンド移行と強制終了直前の保存待機を改善する。
- 音源、JSON、ZIP、`.tairetsu`へ容量・展開量・ファイル数上限を追加する。
- 空き容量不足、破損ファイル、保存失敗時の復旧UIを追加する。
- Web / iPad / Windows間の往復互換テストを拡充する。

### ユーザー判断

- Filesアプリから内部データを見せず、書き出したファイルだけ共有する方針を正式承認する。
- Supabase Freeを継続するか、一般公開時にProへ変更するか決める。

## Release Gate 3: 性能・操作・アクセシビリティ

### Codex実装

- PDF、画像、共有、クラウド管理を遅延読み込みし、初回JSを分割する。
- 大人数・大量シーン・長距離パレード・大容量音源の負荷テストを追加する。
- 44pt未満のタップ領域、小さい文字、focus表示、VoiceOverラベルを監査する。
- 小型iPad、縦横回転、Split View、Stage Manager、キーボード表示中のレイアウトを検証する。
- Error Boundaryと、個人情報を含めない診断情報の書き出しを追加する。
- `App.tsx`の責務を段階的に分割し、主要操作の回帰テストを増やす。

### ユーザー操作

- TestFlightで実機チェック表に沿って確認し、端末・iPadOS・build番号・再現手順を記録する。
- クラッシュ収集サービスを導入するか、端末内診断だけにするか決める。
- 最低対応iPadOSを15のまま維持するか、引き上げるか決める。

## Release Gate 4: App Store提出

### Codex実装

- App icon、launch screen、バージョン表示、審査用操作説明を最終確認する。
- ArchiveのSDK、Privacy Manifest、entitlements、署名、build番号を検査する。
- リリース候補buildで全自動テストとiOS simulator buildを通す。

### ユーザー操作

- 買い切り有料か、無料 + アプリ内課金かを決める。
- App Storeの説明、カテゴリ、キーワード、価格、スクリーンショットを登録する。
- 審査用アカウントを用意し、審査期間中もSupabaseを稼働させる。
- 税務・銀行契約を完了し、最終的に審査へ提出する。

## 公開判定

次をすべて満たすまで一般公開しない。

- Supabase接続、ログイン、個人クラウド保存、競合、アカウント削除が実機で成功する。
- 強制終了、オフライン、容量不足、破損importで隊列表を失わない。
- ステージ/パレードの主要操作と全書き出しが小型・大型iPadの縦横で完了する。
- プライバシーポリシー、サポート、App Privacy、SMTP、審査アカウントが揃う。
- リリース候補buildで自動テスト、Web build、Capacitor sync、iOS archiveが成功する。
