# iPad再審査準備の現在地

更新: 2026-10-02。ユーザーの承認回答を受けて作業再開。一般公開・審査送信・Web本体公開は対象外。別途許可を得たサポートページだけ公開済み。
旧記録の残件よりこの一覧を優先する。最終TestFlight実機確認までは準備完了としない。

## 完了済みと証拠

| 項目 | 確認した証拠 | 限界 |
| --- | --- | --- |
| 却下原因の修正 | AudioDocumentPickerPlugin.swiftは.audio専用。iosReleaseMetadata.test.tsでカメラ経路不使用を検査 | 実機の選択UIは最終buildで要確認 |
| 完成アイコン | AppIcon.appiconsetの1024px画像と参照設定。テストでサイズ・不透明度を確認 | 最終buildのホーム画面と起動画面は要確認 |
| build 17 | run 35866099145をAPIで再照合。archive/upload/署名後始末がsuccess | Apple処理・現在のテスター提供状態は未確認 |
| 最終候補build 18 | commit f6c639c、run 35922139370でarchive/upload成功。新規Development証明書1件のみ失効。App Store Connectで処理完了・チーム内テスト（内部1名）への登録を確認 | 端末へのインストール・実機結果は未確認 |
| 旧証明書整理 | 同runの承認済み12件整理stepがsuccess、9/23の記録と一致 | 今回再実行しない |
| 音源読み込み | audioPicker.ts: 事前検証とfinally回収。異常・キャンセル・回収失敗テスト | Swiftのコピー前制限や実機メモリ測定ではない |
| 保存復元の追加修正 | storage.test.tsで4失敗を再現し修正後成功。書き戻し失敗でも復元データを返す | 容量不足の根本解消や新規保存成功を保証しない |
| 削除キャンセル | CloudAccountModal.test.tsxで削除callbackを呼ばないことを確認 | 本番アカウント削除は実施していない |
| iPad個人クラウド方針 | runtime.ts/test.ts、App.tsxのowner・collaboration判定 | ログイン後の実機操作は未確認 |
| 起動構成 | Info.plist/SceneDelegate、Xcode Sources登録、最低OS15を検査 | iPadOS27実機起動の証明ではない |
| 現在の自動検証 | build18 CIで17 files / 76 tests、型チェック込みbuild、cap sync、iOS archive/upload成功。変更前の独立typecheckも成功 | ネイティブ機能の多くはモック |
| バックエンド | cloud:check成功。未認証の変更・削除RPCは拒否応答 | メール到達、認証済み保存、削除の成功は未確認 |
| 公開ページ | サポートメールをmainの4c2a34fで公開。Production deployment 6625245500成功。/と/support.htmlのHTTP200・mailto・旧GitHubフォーム除去を確認。Web本体のJS/CSSアセット名は公開前後一致 | 実際のメール受信は未確認 |
| 監視 | supabase heartbeatはACTIVE、毎日9時。GitHub workflowにも定期チェック | 一時停止防止や24時間稼働の保証ではない |

## Codexが続けること

- [x] 専用ブランチの署名なしSimulator Releaseビルドを確認。commit 1621322、run [35920235183](https://github.com/shingoto1112/tairetsu-maker/actions/runs/35920235183)成功。
- [x] 既存TestFlight手順で最終候補build18をarchive/upload。run [35922139370](https://github.com/shingoto1112/tairetsu-maker/actions/runs/35922139370)成功。
- [x] 使用Xcode/SDKをログで確認。Xcode26.6 (17F113) / iPhoneOS26.5.sdk。iPadOS27対応をビルドだけで判定しない。
- [x] Apple処理完了・内部テスターへの提供を確認。build18の詳細画面で内部グループ1件（1名）を確認。外部testグループには追加していない。
- [ ] 実機チェック結果で見つかった重大問題を修正・再検証。
- [x] build18の却下理由別返信と日本語UIラベル付き審査操作説明の下書きを準備（APP_STORE_REVIEW_REMEDIATION_2026-08-22.md）。
- [ ] 実機結果と審査用アカウントを確認してApple返信文を送信可能な最終版として確定。

Simulator runのログ: Xcode 26.6 (17F113)、iPhoneSimulator26.5.sdk、BUILD SUCCEEDED。
iPadOS 27ランタイムでの起動・操作確認ではない。最終TestFlight archiveもXcode26.6 / iPhoneOS26.5.sdkを使用。
build18のアップロード完了は2026-09-24 06:27 JST。ログは「Uploaded package is processing」「Upload succeeded」。Appleの処理完了を示す証拠ではない。

## ユーザー確認待ち

1. 今回生成したDevelopment証明書1件だけの後始末はユーザー承認済みで完了。旧12件整理はfalseでスキップ。既存証明書・Distribution証明書は対象外。
2. サポートメールはユーザー指定の tairetsu.maker@gmail.com に決定。追加承認を受け公開ページへ反映済み。受信確認は未実施。
3. 最終候補buildで `IPAD_RESUBMISSION_DEVICE_CHECKLIST.md` を実施。
4. App Store Connectの審査連絡先、審査用アカウント、現在のメタデータ・価格・カテゴリ・画像・App Privacyを確認。認証情報をGitやこの文書に書かない。
5. 本番SMTPと確認/回復メールが一般利用者へ届くことを確認。送信テストは本人が管理するアドレスで実施。
6. 本番アカウント削除の実行試験は専用アカウントで、削除直前の別承認が必要。キャンセル検証と混同しない。
7. App Store Connectログイン済み。審査連絡先の電話番号・メールが空欄、サインイン必須OFF・審査用アカウント未設定。専用アカウントの提供と入力はユーザー側で行う。
8. 2026-10-02にユーザーが「手動公開・iPadのみ」を承認。手動公開に切り替え、Mac/Apple Vision Pro配信を無効にする。App Store Connectはログイン切れのため再サインインを依頼済み。承認の再確認は不要、保存・反映確認は未実施。

## App Store Connectの現状確認

2026-09-24に読み取り専用で確認。審査へ送信していない。

- バージョン1.0は却下済み、選択buildは旧12。実機QA後に18へ差し替える。
- 概要・キーワード・著作権は入力済み。サポートURLは公開ページと一致。
- iPad13インチのスクリーンショット1枚あり。最終buildとの見た目の照合は未完了。
- 主カテゴリは仕事効率化、副カテゴリはユーティリティ。主な年齢区分は4+（地域例外あり）。
- 日本価格は1,500円。価格は変更していない。
- App Privacyは公開済み、名前・メール・ユーザーID・その他ユーザーコンテンツの4種類。プライバシーURLと選択URLも一致。
- コンテンツ配信権は「サードパーティコンテンツなし」の登録。実装・配布素材との最終整合確認は別途必要。

## 追加で確認した依存関係リスク

2026-09-24のnpm auditは全依存9件（high2 / moderate7）、omit=devではfflateのmoderate1件。過去の「本番依存0件」を現在の結果として使わない。
fflate0.8.2はjspdf4.2.1の推移依存。GHSA-px8p-9vwx-vf98は不正ZIP64のunzipSyncで無限ループになる問題。現在のjspdf ES実装はzlibSyncのみimportし、アプリの隊列ZIP読み込みはJSZipを使用。srcにfflate/unzipSyncの参照なし。今回確認した経路に脆弱なAPI利用は見つからなかったが、ライブラリ全体の安全性を保証するものではない。
high2件は開発依存@xmldom/xmldomとbrowserslist。別途影響評価・更新候補に残す。supportページ限定公開に依存更新を混ぜず、build18にも変更はない。Capacitorメジャー更新を伴う一括audit fixは行わない。

## 配信分離

- iPadブランチ: codex/ipad-resubmission-20260924。その変更全体をmainへpush/mergeしない。
- 追加承認を受け、origin/mainのd8484f6から分離worktree/ブランチcodex/support-email-publication-20260924を作成。public/support.htmlとそのテストだけの4c2a34fをmainへpush。対象テスト6件・build・diff --check成功。アプリ実装やlockfileに差分なし。
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
