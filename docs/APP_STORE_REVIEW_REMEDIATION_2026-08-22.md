# App Store 初回審査の修正記録

最終更新: 2026-08-22

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

クラッシュログが未入手のため、旧build 12の終了理由の完全なsymbolicateは未完了。ただし、審査手順で到達したカメラ・動画経路そのものを新buildから除去した。

## 追加した予防策

- React Error Boundaryと、隊列表・氏名・メールアドレスを含めない端末内診断情報。
- ZIP / `.tairetsu` / JSON / 音源の容量、ファイル数、展開後サイズ上限。
- 画像、PDF、ZIPライブラリの遅延読み込みによる起動負荷削減。
- TestFlight workflowでdSYMと配布ログを30日保管。
- GitHub ActionsとCodexによる3日ごとのSupabase到達確認。
- サポートページから公開前の仮文言を削除。

## 再提出前のRelease Gate

- [ ] GitHub ActionsのiOS Simulator Release相当buildが成功。
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

```text
Hello App Review Team,

Thank you for the review. We addressed both issues in a new build.

1. Guideline 2.3.8
We replaced the placeholder-like icon with the finalized formation-grid icon and updated the launch artwork to use the same visual identity.

2. Guideline 2.1(a)
The previous audio input could expose a system media-capture option on iPadOS. We replaced it with a native audio-document picker limited to audio files. Camera and video capture are no longer presented or used. We also added file validation, double-selection protection, and error recovery.

We tested the new TestFlight release build in portrait and landscape, including creating a new stage formation with and without an audio file.

Review path:
Launch the app > Add > New stage formation > Audio > Select audio file.

No camera, microphone, or video-capture permission is required by the app.
```

## ユーザー側で必要な作業

1. App Store Connectの却下メッセージから添付クラッシュログ（`.ips`または`.crash`）を取得し、この作業環境へ添付する。
2. 新TestFlight buildで上記Release Gateを実機確認する。
3. 審査用アカウントのメールアドレスとパスワードをApp Review Informationへ設定する。リポジトリには保存しない。
4. GitHubアカウント不要のサポート用メールアドレスを決め、公開ページへ反映する。
5. App Reviewへ返信案を送り、新buildを選択して再提出する。

## 参照

- https://developer.apple.com/app-store/review/guidelines/
- https://developer.apple.com/documentation/xcode/testing-a-release-build
- https://developer.apple.com/documentation/uikit/uidocumentpickerviewcontroller
- https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/reply-to-app-review-messages
