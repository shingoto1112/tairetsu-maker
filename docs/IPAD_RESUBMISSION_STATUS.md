# iPad再審査準備の現在地

更新: 2026-09-24。ユーザーの承認回答を受けて作業再開。一般公開・審査送信・Web版公開は対象外。
旧記録の残件よりこの一覧を優先する。最終TestFlight実機確認までは準備完了としない。

## 完了済みと証拠

| 項目 | 確認した証拠 | 限界 |
| --- | --- | --- |
| 却下原因の修正 | AudioDocumentPickerPlugin.swiftは.audio専用。iosReleaseMetadata.test.tsでカメラ経路不使用を検査 | 実機の選択UIは最終buildで要確認 |
| 完成アイコン | AppIcon.appiconsetの1024px画像と参照設定。テストでサイズ・不透明度を確認 | 最終buildのホーム画面と起動画面は要確認 |
| build 17 | run 35866099145をAPIで再照合。archive/upload/署名後始末がsuccess | Apple処理・現在のテスター提供状態は未確認 |
| 最終候補build 18 | commit f6c639c、run 35922139370でarchive/upload成功。今回生成のDevelopment証明書1件のみ失効をログ確認 | Apple側処理完了・テスター提供・実機確認は未確認 |
| 旧証明書整理 | 同runの承認済み12件整理stepがsuccess、9/23の記録と一致 | 今回再実行しない |
| 音源読み込み | audioPicker.ts: 事前検証とfinally回収。異常・キャンセル・回収失敗テスト | Swiftのコピー前制限や実機メモリ測定ではない |
| 保存復元の追加修正 | storage.test.tsで4失敗を再現し修正後成功。書き戻し失敗でも復元データを返す | 容量不足の根本解消や新規保存成功を保証しない |
| 削除キャンセル | CloudAccountModal.test.tsxで削除callbackを呼ばないことを確認 | 本番アカウント削除は実施していない |
| iPad個人クラウド方針 | runtime.ts/test.ts、App.tsxのowner・collaboration判定 | ログイン後の実機操作は未確認 |
| 起動構成 | Info.plist/SceneDelegate、Xcode Sources登録、最低OS15を検査 | iPadOS27実機起動の証明ではない |
| 現在の自動検証 | build18 CIで17 files / 76 tests、型チェック込みbuild、cap sync、iOS archive/upload成功。変更前の独立typecheckも成功 | ネイティブ機能の多くはモック |
| バックエンド | cloud:check成功。未認証の変更・削除RPCは拒否応答 | メール到達、認証済み保存、削除の成功は未確認 |
| 公開ページ | /、/privacy.html、/support.htmlはHTTP200 | サポート窓口は現時点でGitHub Issuesのみ |
| 監視 | supabase heartbeatはACTIVE、毎日9時。GitHub workflowにも定期チェック | 一時停止防止や24時間稼働の保証ではない |

## Codexが続けること

- [x] 専用ブランチの署名なしSimulator Releaseビルドを確認。commit 1621322、run [35920235183](https://github.com/shingoto1112/tairetsu-maker/actions/runs/35920235183)成功。
- [x] 既存TestFlight手順で最終候補build18をarchive/upload。run [35922139370](https://github.com/shingoto1112/tairetsu-maker/actions/runs/35922139370)成功。
- [x] 使用Xcode/SDKをログで確認。Xcode26.6 (17F113) / iPhoneOS26.5.sdk。iPadOS27対応をビルドだけで判定しない。
- [ ] Apple処理完了・内部テスターへの提供を確認。
- [ ] 実機チェック結果で見つかった重大問題を修正・再検証。
- [ ] 確認済み事実だけでApple返信文を確定。

Simulator runのログ: Xcode 26.6 (17F113)、iPhoneSimulator26.5.sdk、BUILD SUCCEEDED。
iPadOS 27ランタイムでの起動・操作確認ではない。最終TestFlight archiveもXcode26.6 / iPhoneOS26.5.sdkを使用。
build18のアップロード完了は2026-09-24 06:27 JST。ログは「Uploaded package is processing」「Upload succeeded」。Appleの処理完了を示す証拠ではない。

## ユーザー確認待ち

1. 今回生成したDevelopment証明書1件だけの後始末はユーザー承認済みで完了。旧12件整理はfalseでスキップ。既存証明書・Distribution証明書は対象外。
2. サポートメールはユーザー指定の tairetsu.maker@gmail.com に決定。support.htmlへ設定済み。公開ページだけの反映許可は別途質問中。受信確認は未実施。
3. 最終候補buildで `IPAD_RESUBMISSION_DEVICE_CHECKLIST.md` を実施。
4. App Store Connectの審査連絡先、審査用アカウント、現在のメタデータ・価格・カテゴリ・画像・App Privacyを確認。認証情報をGitやこの文書に書かない。
5. 本番SMTPと確認/回復メールが一般利用者へ届くことを確認。送信テストは本人が管理するアドレスで実施。
6. 本番アカウント削除の実行試験は専用アカウントで、削除直前の別承認が必要。キャンセル検証と混同しない。
7. App Store Connectのブラウザはサインイン画面。ユーザーにログインを依頼済み。Apple側のbuild18処理状況・内部テスターへの提供を確認する。

サポートページの公開修正が必要になった場合、今回のWeb公開除外と衝突するため、そのページだけの公開許可を別途確認する。

## 配信分離

- ブランチ: codex/ipad-resubmission-20260924。mainへpush/mergeしない。
- 直近mainのcommitがVercel Productionへ配信されたことをGitHub deploymentsで確認。
- vercel.jsonで上記ブランチだけgit.deploymentEnabled=false。他ブランチの挙動を変えない。
- 根拠: https://vercel.com/docs/project-configuration/git-configuration
- GitHub Environment ios-testflightには確認時点でブランチ制限なし。
- push後は対象commitのdeploymentsも確認する。PR・mainマージ・Web公開は行わない。
- commit 1621322のdeploymentsは空。build18対象のf6c639cのdeploymentsはios-testflightのみで、Vercelへの配信はない。

## 完了条件

- [x] 却下原因への対処がアップロード済み最終候補build18に含まれる（実機挙動は別途確認）。
- [x] そのコードの必要テスト、Webビルド、iOSビルドが成功。
- [ ] TestFlight提供済みで必須実機結果が揃う。
- [ ] 重大未解決障害がない。
- [ ] 審査情報、サポート、返信文が揃う。
- [ ] 再審査提出手順と残る制約を案内済み。

## 今回対象外

保存状態UIの刷新、全面的な大容量最適化、App.tsx分割、iPad共同編集、新機能、全面UI刷新。実害を再現した重大問題だけは上の残件へ移す。その他はIPADOS27_IMPROVEMENT_REVIEW_2026-09-24.mdに保管。
