# iPad版 TestFlightセットアップ

最終更新: 2026-08-03

この手順はMacを所有していない前提です。アプリのビルド、署名、アップロードは
GitHub ActionsのmacOS runnerで行います。Appleアカウントの本人確認、契約、課金、
秘密鍵の発行、App Store Connect上の操作だけは本人が行います。

## 1. 先に決める値

- 表示名: `隊列メーカー`
- Bundle ID: `jp.tairetsu.maker`
- URL scheme: `jp.tairetsu.maker`
- 対象: iPadのみ
- 最低iPadOS: 15.0

`jp.tairetsu.maker` で確定し、2026-08-03にAppleのApp IDとApp Store Connectの
iOSアプリへ登録済み。TestFlight/App Storeで使用するBundle IDとして原則変更しない。

Bundle IDを変更する場合は、App Store Connectのアプリ作成前に
`capacitor.config.ts` とXcode projectの両方を変更する。

## 2. Apple側の準備

1. Apple Developer Programへ本人のApple Accountで加入する。（加入済み、現行契約への同意済み）
2. DeveloperのCertificates, Identifiers & Profilesで、Bundle ID
   `jp.tairetsu.maker` のApp IDを登録する。（2026-08-03登録済み）
3. App Store Connectの「マイApp」から新規アプリを作る。（2026-08-03作成済み）
4. プラットフォームはiOS、名前は「隊列メーカー」、上のBundle IDを選ぶ。（設定済み）
5. SKUは外部公開されない任意値にする。（`tairetsu-maker-ipad` で設定済み）

## 3. App Store Connect API key

1. 初回だけ、Account HolderがApp Store Connectの「ユーザとアクセス」→「統合」→
   「App Store Connect API」でアクセスを申請する。Appleの承認後に次へ進む。
2. Account HolderまたはAdminでTeam API keyを新規作成し、アプリのアップロードと
   TestFlight管理が可能な権限を与える。
3. Issuer IDとKey IDを控える。
4. `.p8` private keyをダウンロードする。再ダウンロードできないため安全に保管する。
5. Windows PowerShellでprivate keyをBase64化する。

```powershell
$path = "C:\path\to\AuthKey_XXXXXXXXXX.p8"
[Convert]::ToBase64String([IO.File]::ReadAllBytes($path)) | Set-Clipboard
```

private key、Base64文字列、Appleパスワードをリポジトリ、Issue、チャット、ログへ
貼らない。

## 4. GitHub EnvironmentとSecrets

GitHub repositoryの `ios-testflight` Environmentは作成済み。必要なら実行前の承認者を
設定し、同Environmentへ次のSecretsを登録する。

| Secret | 内容 |
| --- | --- |
| `APPLE_TEAM_ID` | Apple Developer Team ID |
| `APP_STORE_CONNECT_API_ISSUER_ID` | API keyのIssuer ID |
| `APP_STORE_CONNECT_API_KEY_ID` | API keyのKey ID |
| `APP_STORE_CONNECT_API_KEY_BASE64` | `.p8`をBase64化した文字列 |

`APPLE_TEAM_ID` は2026-08-03に `ios-testflight` Environmentへ登録済み。
残る3項目は、App Store ConnectでTeam API keyを発行した後に本人が登録する。

署名付き配布は `.github/workflows/ios-testflight.yml` の手動実行時だけ行う。通常の
pushとpull requestでは `.github/workflows/ios-build.yml` の署名なしビルドだけを行う。
Xcodeはローカルの配布証明書がない場合にクラウド管理証明書を利用する。Account Holder
以外の権限で運用する場合は、App Store Connectでクラウド管理証明書へのアクセスも
許可する。

公式資料:

- [App Store Connect APIを始める](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/)
- [クラウド管理証明書](https://developer.apple.com/help/account/certificates/cloud-managed-certificates/)

## 5. Supabase AuthのiPadコールバック

Supabase DashboardのAuthentication、URL Configurationを開き、Redirect URLsへ次を追加する。

```text
jp.tairetsu.maker://auth/callback
```

このRedirect URLは2026-08-03に本番Supabaseへ追加済み。

新規登録の確認メールをiPadで開いた場合、このURLからアプリへ戻る。アプリは受け取った
セッションを検証し、iOS Keychainへ保存する。publishable key以外の秘密鍵はアプリへ
入れない。

## 6. TestFlightへ送る

1. GitHubのActionsを開く。
2. `Upload iPad App to TestFlight` を選ぶ。
3. `Run workflow` からmain branchを手動実行する。
4. archiveとuploadが成功したら、App Store ConnectのTestFlightで処理完了を待つ。
5. 輸出コンプライアンスの質問が出た場合はアプリの実態に沿って回答する。
6. 内部テスターへ本人またはチームメンバーを追加する。
7. iPadへTestFlightアプリを入れ、招待から隊列メーカーをインストールする。

GitHub run numberをiOS build numberとして使うため、再実行しても同じversion内で重複しにくい。

## 7. 実機確認

- 横向きと縦向きでステージ/パレードを編集できる。
- タッチ移動、複数選択、長押し、ピンチズーム、オートスクロールが動く。
- ローカル保存と再起動後の復元が動く。
- JSON、`.tairetsu`、ZIP、PNG、PDFの入出力と共有シートが動く。
- 音源を読み込み、機内モードでも再生できる。
- 既存Supabaseアカウントでログインできる。
- ownerのクラウドプロジェクトだけが表示される。
- オフライン編集が端末へ残り、再接続時に勝手に上書きされない。
- iPadから書き出したデータをWeb/Windows版で再度開ける。

## 8. App Store公開前に追加で必要なもの

- App Store用スクリーンショット、説明、カテゴリ、サポートURL
- 公開されたプライバシーポリシーURL
- App Store ConnectのApp Privacy回答
- アカウント作成を提供する場合のアプリ内アカウント削除
- 課金方式、価格、税務・銀行契約
- 外部TestFlightを使う場合のBeta App Review情報
- 実機回帰テストとApp Review向けデモ手順
