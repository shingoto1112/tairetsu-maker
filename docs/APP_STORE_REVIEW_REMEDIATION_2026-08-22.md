# App Store 初回審査の修正記録

最終更新: 2026-09-24

現在の候補は1.0 (18)。Apple処理完了・内部テストグループへの提供を確認済み。
下の8月時点の配信記録は履歴であり、最新残件は `IPAD_RESUBMISSION_STATUS.md` を優先する。

## 対象

- Submission ID: `8eada55b-130c-4b98-bb66-1c1cd28f6927`
- 審査端末: iPad Air (第5世代)
- 審査OS: iPadOS 26.6.1
- 却下build: 12
- 指摘: Guideline 2.3.8（仮アイコン）、Guideline 2.1(a)（音源選択時のクラッシュ）

## 原因と修正

### App Icon

旧アイコンは方眼上の青い線だけで構成され、起動画面にも同じ小さな記号が使われていたため、完成前の仮素材に見える状態だった。

修正:

- 方眼、センターライン、5つのメンバーセルで隊列編集を表す完成版アイコンへ変更。
- App Icon、Web favicon、起動画面を同じ意匠へ統一。
- App Iconは1024 x 1024、アルファチャンネルなしのPNGとして生成。
- 起動画面のロゴを画面中央へ配置。

### 「Take Video」選択後のクラッシュ

旧実装はHTMLのファイル入力で `accept="audio/*"` を使用していた。iPadOSのファイル選択メニューがカメラ系の候補を提示し、アプリがカメラ・マイク利用目的を宣言していない状態で「Take Video」を選べる経路が残っていた。

修正:

- iPadアプリでは `UIDocumentPickerViewController` と `UTType.audio` を使うネイティブ音源ファイル専用ピッカーへ変更。
- カメラ撮影、動画撮影、写真ライブラリを音源選択経路から除外。
- Web/Windows版も `audio/*` を廃止し、対応拡張子だけを指定。
- 対応形式を MP3 / M4A / WAV / AAC / AIFF / CAF に限定。
- 空ファイルと200MB超の音源を読み込み前に拒否。
- 二重タップ中の再選択を無効化し、読み込みエラーを画面内に表示。

App Store Connectに添付された3件の `.ips` を取得して確認した。3件すべてが同じTCC強制終了で、
`NSCameraUsageDescription` がない状態でカメラへアクセスしたことを終了理由として明記していた。
スタックにも `UIImagePickerController`、`CameraUI`、`AVCaptureDevice` が含まれており、旧HTML
音源入力から `Take Video` を選んだ経路が原因だったことを確認した。現行実装はカメラ権限を
追加して回避するのではなく、音源専用Document Pickerへ置き換えてカメラ経路自体を除去した。

## 追加した予防策

- React Error Boundaryと、隊列表・氏名・メールアドレスを含めない端末内診断情報。
- ZIP / `.tairetsu` / JSON / 音源の容量、ファイル数、展開後サイズ上限。
- 画像、PDF、ZIPライブラリの遅延読み込みによる起動負荷削減。
- TestFlight workflowでdSYMと配布ログを30日保管。
- GitHub Actionsによる3日ごとの確認と、Codexによる毎日のSupabase・公開ページ到達確認。
- サポートページから公開前の仮文言を削除。
- Info.plistにカメラ・マイク・写真権限がなく、Swift側が `.audio` 専用Document Pickerで
  `UIImagePickerController` / `AVCapture` を含まないことを自動テストで固定。

## TestFlightと署名の現在地

2026-09-23更新: ユーザー承認済みのDevelopment証明書12件を固定ID・属性照合後に失効し、
run `35866099145`でbuild 17をアップロードした。17 files / 61 tests、Web build、archive、
uploadすべて成功。今回作成したDevelopment証明書1件もrunnerの署名identityと照合して
自動失効済み。Distribution証明書は対象外。Apple処理完了・実機QA・再提出はまだ未確認。

以下は8月時点の履歴:

- 修正版のTestFlight build 13はGitHub Actions run `32518204864`でアップロード済み。
- build 13はバイナリ検証済み、シンボルあり、iPad専用、内部テスト可能。ただし
  Store情報のローカリゼーションが英語のため、日本語宣言を含む次buildを使用する。
- 日本語を開発言語として宣言した最新commitのRelease Simulator buildはrun
  `32520142293`で成功済み。
- 新しいTestFlight uploadは、短命なGitHub macOS runnerが作成したDevelopment証明書が
  Apple Developer側へ残り、証明書上限に達したため停止中。
- 開始前の証明書一覧との差分から、そのCIで新規作成された `Created via API` の
  Development証明書1件だけを失効する安全スクリプトとテストを追加済み。
- 既存の12件を整理するまでは自動失効をworkflowへ接続しない。`Distribution Managed`
  証明書は失効対象外とする。
- App StoreのiPad 13インチ用スクリーンショットは1枚登録済み。
- 再提出対象はまだ旧build 12。新build選択時にApp Review連絡先の電話番号・メールも入力する。

## 再提出前のRelease Gate

- [x] GitHub ActionsのiOS Simulator Release相当buildが成功。
- [ ] 新しいTestFlight buildをiPad Air (第5世代相当を優先)へインストール。
- [ ] 「新しいステージ隊列を作成」から音源選択を開き、「Take Video」が表示されない。
- [ ] MP3、M4A、WAVの選択、再生、再起動後の復元が成功。
- [ ] 音源なしの新規ステージ/パレード作成が成功。
- [ ] 縦向き、横向き、オフライン、バックグラウンド復帰を確認。
- [ ] Supabaseログイン、本人クラウド保存、ログアウト、アカウント削除を確認。
- [ ] PNG、PDF、ZIP / `.tairetsu`の書き出しと再読み込みを確認。
- [ ] App Store Connectの審査用アカウントが有効で、バックエンドが稼働中。
- [ ] Support URL、Privacy Policy URL、スクリーンショット、アイコンが新buildと一致。

## App Reviewへの返信案

以下はbuild18向けの未送信下書き。実機チェックを完了し、審査用buildを18に差し替えてから使用する。
未実施のテストを実施済みと記載しない。現在の残件は `IPAD_RESUBMISSION_STATUS.md` を参照。

```text
Hello App Review Team,

Thank you for the review. We addressed both reported issues in version 1.0, build 18.

1. Guideline 2.3.8
We replaced the placeholder-like icon with the finalized formation-grid icon and updated the launch artwork to use the same visual identity.

2. Guideline 2.1(a)
All three attached crash reports show the same TCC termination caused by opening the camera without an NSCameraUsageDescription. The previous audio input could expose that system media-capture option on iPadOS. We replaced it with a native audio-document picker limited to audio files. Camera and video capture are no longer presented or used. We also added file validation, double-selection protection, and error recovery.

Review path (Japanese button labels):
Launch the app > Add (追加) > Create new (新しく作る) > Stage formation (ステージ隊列) > Select audio file (音源ファイルを選択).
This opens the native audio-document picker. You can cancel the picker and return to the creation form, or select a supported audio file. Audio is optional when creating a formation.

No camera, microphone, or video-capture permission is required by the app.
```

## App Reviewのメモ欄用下書き

以下も未送信。ローカル操作はログイン不要だが、個人クラウドは審査用アカウントで確認できるようにする。
実際の認証情報はこの文書に書かず、App Store Connectの専用ユーザー名・パスワード欄へ入力する。
審査用アカウントでログインできることと保存・再読込をユーザーが確認してから使用する。

```text
The app interface is in Japanese. Local formation editing does not require an account.

Create a formation:
On the formation list, tap 追加 > 新しく作る > ステージ隊列 (stage) or パレード隊列 (parade). Enter a title and tap 作成する. Audio is optional.

Audio picker regression path:
追加 > 新しく作る > ステージ隊列 > 音源ファイルを選択.
The app uses a native audio-document picker, not a camera or video recorder.

Personal cloud storage:
Use the review account entered in the sign-in fields to log in through the クラウド section on the formation list. The menu on a saved local formation card provides クラウドへアップロード. Open the uploaded formation from the cloud list.
The iPad app provides personal cloud storage only; collaborative editing and invitations are not available in this version. Audio files remain on the device and are not uploaded to the cloud.

Account deletion:
While signed in, open アカウント from the クラウド section on the formation list, enter the current password, then tap アカウントを削除. A final confirmation follows. Deleting the account removes the applicable cloud data; local formations on the device remain.

Support: https://tairetsu-maker.vercel.app/support.html
Contact: tairetsu.maker@gmail.com
```

操作ラベルの根拠: `FormationLibrary.tsx`、`CloudAccountModal.tsx`、`AudioPanel.tsx`。
送信直前に実機結果、審査用アカウント、選択ビルド、スクリーンショットを照合する。
この下書きには未実施の実機テストを成功したとする記述は含めていない。

## ユーザー側で必要な作業

1. 新TestFlight buildで上記Release Gateを実機確認する。
2. App Review Informationの連絡先電話番号とメールアドレスを入力する。
3. ログインを審査対象として説明する場合は、審査用アカウントを設定する。認証情報はリポジトリへ保存しない。
4. GitHubアカウント不要のサポート用メールアドレスを決め、公開ページへ反映する。
5. App Reviewへ返信案を送り、新buildを選択して再提出する。

## 参照

- https://developer.apple.com/app-store/review/guidelines/
- https://developer.apple.com/documentation/xcode/testing-a-release-build
- https://developer.apple.com/documentation/uikit/uidocumentpickerviewcontroller
- https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/reply-to-app-review-messages
