# iPad再審査準備の現在地

## 2026-10-03〜04: 方針更新（この節を最優先。以下の古い節より優先する）

確認日: 2026-10-04。対象ブランチ `codex/ipad-release-20261002`、HEAD `821606e`（この節を追加したコミットの直前）。

### ユーザー決定
- **審査は急がない。アプリを完全な状態にしてから出す。** 保存方式の作り直しと、**共同編集の作り直し（ロックなし・ローカル同等の操作感・iPad 前提＋アプリのない人は Web から参加）**まで全部できてから審査に出す（選択肢 B）。
- **途中の TestFlight は出さない。** 残りの作業（共同編集・使い方ページ・保存の第11回）を終えた最後の全体確認で、まとめて1回アップロードする。
- 今のクラウド機能は使われていない。旧ロック式共同編集は新方式で置き換えて停止する。新スキーマは現在の Supabase プロジェクトに旧スキーマとは別テーブルで新設してよい（SQL は利用者が SQL Editor に貼る。適用直前に確認）。旧クラウドの隊列表は可能なら一方向取り込みで残す。

### 完了（保存方式の作り直し）
| 回 | commit | 内容・証拠 |
|---|---|---|
| 1 | `18f5efb` | Repository 契約・codec・JSON 契約 fixture |
| 2 | `afb9bc8` | Web/Windows 用 IndexedDB（実ブラウザ契約試験） |
| 3 | `e34004f` | iPad 用 Swift＋SQLite（macOS XCTest・simulator build 合格） |
| 4 | `ccb59fa`・`df86e2b` | 旧データの移行部品（macOS XCTest 14件合格） |
| 5（6を統合） | `fd3831f` | App の保存・読込を Repository に切替（保存 E2E a〜g） |
| 7 | `4b7cda2` | iPad 音源のネイティブ保存・ファイル URL 再生（XCTest 27件合格） |
| — | build 22 | TestFlight run [37125367552](https://github.com/shingoto1112/tairetsu-maker/actions/runs/37125367552)（`4b7cda2`、2026-10-03 22:15 JST アップロード成功、内部テスターのみ） |
| 10 | `0a48b4b`・`101a4dc`・`d67e308` | 復元候補・iPad 破損復旧・全件バックアップ・音源 GC・旧データ整理（XCTest 32件合格。GC のパス表記差による誤削除の恐れを XCTest で検出して修正） |
| build 22 指摘 | `821606e` | 画面全体のずれ、パレードのピンチ（指の扱いをステージと同じに・慣性）、パレード最大6倍、名簿は最初から1枚画像、ホーム・共有に文字、メインJS 453.65kB |

第8回（旧ロック式の整合性強化）と旧方式の安全修正は**本番未適用・リリースブランチ外**で、ローカルブランチ `codex/cloud-revision-cas-parked`（`3ee3d38`）と `codex/cloud-authorization-hotfix-parked`（`f162df9`）に保管。第9回（本人同期）は新しい共同編集に置き換え。

### 残り（順番）
1. 新しい共同編集: 設計（Claude 草案＋Codex 相談）→ 段階的実装（写像と差分バインダー → 端末保存の拡張 → 新スキーマ（Linux CI で試験 → 承認後に本番適用）→ 通信 → UI（共有・招待・プレゼンス・live drag・共有中の Undo・履歴）→ 旧クラウド取り込みと旧方式停止 → 性能・安全確認）。
2. 保存方式の第11回（性能計測・旧書き込み関数の整理）。
3. 使い方ページ（三本線メニューから。下書きをユーザーに確認）。
4. 全体確認 → **最後の TestFlight（まとめて1回）** → ユーザーの実機確認 → 審査提出（提出直前にユーザー確認）。

### 最後の TestFlight で重点的に確認すること（実機でしか確かめられない）
- 旧データの新保存方式への移行（一覧・保存・再起動後の保持）、音源の再生・シーク・大きな曲の取込み、ZIP 読込/書出し、全件バックアップ（ファイル・AirDrop）。
- パレードのピンチと1本指スクロール（慣性）の滑らかさ・無反応がないこと、長いパレードを6倍にした時の重さ。
- メンバー・道具をタップしても画面全体がずれないこと（横向き含む）。
- 共同編集（5人程度・iPad と Web の混在・一時切断）。

## 2026-10-02 午後: 方針更新と再審査ロードマップ（10-03〜04 の節が優先）

ユーザー方針: 「画像の保存・ファイルの共有がスムーズにできる、完璧な状態で審査に出したい」。そのため、審査には build 18 ではなく、新しいリリースブランチから作る build 19 以降を出す。

### 審査ビルドの構成

- ブランチ: `codex/ipad-release-20261002`。土台は build 18 系の `76aa6b1`（実機確認「問題なし」の報告済み）。
- 追加した変更: `1f280a8` 三本線メニュー、`8cbec67` 名簿・道具割当・パネル整理・スマホ向け書き出し、`3b12e84` 共有・保存の操作感と写真保存。以降の仕上げもこのブランチに積む。
- 含めないもの: iPadOS 26 Liquid Glass のネイティブ移行（`codex/ipad-liquid-glass-ui` の `8625273`）。Swift の実機検証が無く、審査リスクになるため。移行は審査後にこのブランチへ載せ替えて再開する。
- `vercel.json` でこのブランチの Vercel デプロイを無効化済み。push後の commit `3b12e84` に deployment が無いことを確認。

### 写真保存のクラッシュ要因（重要）

- build 18 系・main とも `Info.plist` に `NSPhotoLibraryAddUsageDescription` が無かった。一方でステージのスクリーンショット等のPNGを iOS の共有シートで渡している。共有シートの「画像を保存」を選ぶと、説明キー欠如でアプリが強制終了し得る（初回審査のカメラ権限クラッシュと同種）。実機での再現は未確認。
- リリースブランチでは説明キーを追加し（「書き出した隊列表や名簿などの画像を写真アプリに保存するために使用します。」）、メタデータテストで検査する。
- PNG はアプリ内プラグイン `ExportSharePlugin.swift` で画像として共有シートへ渡し、「画像を保存」・LINE・AirDrop を確実に選べるようにした。PDF・ZIP はファイルとして渡す。

### 完了済み（リリースブランチ）

| 項目 | 証拠 | 限界 |
| --- | --- | --- |
| Web・単体テスト | 44 files / 287 tests、typecheck、build（メインJS 約484kB、500kB警告なし） | 実機・クラウド権限の動作は未確認 |
| Swift のコンパイル | `Build iPad App` run [36961449931](https://github.com/shingoto1112/tairetsu-maker/actions/runs/36961449931) 成功（Xcode 26.6、`ExportSharePlugin.swift` を含む） | Simulator ビルド。共有シートの実挙動は実機で要確認 |
| 書き出しの軽量化 | 24人・3シーンの fixture で A4 隊列表PDF 1,010,627 → 346,836 bytes。スマホ向け名簿・割当表・隊列表は数百KB | LINE 経由の再圧縮後の画質は未確認 |

### 2026-10-02 夕方の進捗

- gpt-6.1-sol の提出前レビュー（結論「修正後に提出可」、P0なし・P1 3件）を全件採用し `0c2af96` で修正: 書き出しで前シーンからの継承状態を解決（スマホ向け・A4）、モーダル表示中の背景ショートカット停止、Web共同編集の割当保存失敗を成功扱いしない。46 files / 298 tests、typecheck、build（メインJS 484.41kB）成功。
- iPad（capacitor-ios）横向きでメンバー/道具パネルが空白になる回帰を発見・修正（`d9d9c06`）。基準版 `76aa6b1` と Playwright で比較済み。
- **TestFlight build 19 配信完了（2026-10-02）。** run [36970279355](https://github.com/shingoto1112/tairetsu-maker/actions/runs/36970279355)、source `0c2af965c5c6e42d85cfc03ef161326f8167eb19`。初回と再実行2回目は契約APIエラーで停止。ユーザーによる更新契約同意（同意日2026-10-02）と反映待ち後、attempt 3が成功。同じrunの再実行なのでbuild番号19を維持。46 files / 298 tests、Web build、Capacitor sync、iOS archive/uploadが成功（Xcode26.6 / iPhoneOS26.5.sdk）。アップロード完了17:51 JST、今回runnerが作ったDevelopment証明書1件のみ後始末済み。Apple側の処理完了と「チーム内テスト」内部1名への登録を画面で確認。外部テスト・App Store審査提出・一般公開は行っていない。最新Web `4414317` との `src` / `public` / package / Capacitor設定差分はテスト2ファイルだけで、アプリ実装は一致。build19の実機確認はこれからであり、旧buildの実機合格を引き継がない。
- Web本番へ反映済み: `main` を `c64343d` → `4414317` に fast-forward（同じ変更を main 上へ cherry-pick、302 tests・build 成功）。Vercel Production deployment 6802197243 success。本番URLで新UI（名簿ボタン、スマホ向け書き出し）とページエラー0を確認。

### 2026-10-02 夜〜10-03 の進捗

- build 19 の実機確認でユーザーが指摘: (1) iPadアプリで音源が読み込めない（「音源ファイルの読み込みに失敗しました」）、(2) スマホ向け隊列表の書き出しが見にくい、(3) 縦持ちのUIが崩れている。
- (1) 原因: Capacitor の asset handler が Range なしの音声ファイルに非HTTP応答を返し、WebKit の fetch が status 0 を返していた。**build 18・19 にも存在した不具合で、前回の実機合格を引き継がない理由になる。** `0db535e`・`24c9b8c` で Range 付き読込とサイズ一致確認に修正。**build 20 の実機でユーザーが音源読み込み成功を確認（2026-10-03）。**
- (2) `12a79b6` で A4 隊列表PDFを build 18 と同一の描画・JPEG方式に復元（実データでサイズ・ページ数・画像寸法一致）。Web `main` にも即日反映（`c1aebd6`、Vercel Production success）。
- ツールバー変更（編集補助撤去、ホームアイコン、共有ボタン、共有と書き出しに名簿・割当表）`0db535e`。
- 縦持ちの作り直し `8071939`、お知らせのオーバーレイ化 `03e7808`、縦持ちの名前リストを横スクロールの札に `c146798`（13" 4段・11" 3段・mini 2段、高さ変更と記憶、☑と名前タップの分離は全レイアウト）。
- **TestFlight build 20**（run #20、`8071939`）2026-10-02 20:02 アップロード成功。**build 21**（run [#21](https://github.com/shingoto1112/tairetsu-maker/actions/runs/37091254427)、`c146798`）2026-10-03 11:55 アップロード成功。内部テスターのみ。審査提出はしていない。
- 未反映: ツールバー・縦持ち・名前リストの変更は Web `main` に未反映（ユーザー確認後に反映）。iPad横向きの初期175%表示による左右の切れは未対応（ユーザー判断待ち）。

### 提出までの手順と受入条件

1. **仕上げ（Claude/Codex）**: iPad（capacitor-ios）でメンバー/道具タブが空白・重なる回帰の修正、全パネルの見出し重なり、書き出し・共有ダイアログの統一。受入: Playwright で iPad 横/縦・Web を確認、テスト・ビルド成功。
2. **TestFlight（Claude、ユーザー承認済み）**: リリースブランチで `Upload iPad App to TestFlight` を実行し build 19 以降をアップロード。内部テスターのみ。受入: run 成功、App Store Connect で処理完了。
3. **実機確認（ユーザー）**: 下のチェックリスト。受入: 全項目OK、または不具合を修正して再ビルド。
4. **App Store Connect の準備（ユーザー＋Claude）**: 審査対象 build を新しい番号へ差し替え。UI が変わったので iPad 13インチのスクリーンショットを最新の画面に更新することを推奨。審査メモ・返信文（`APP_STORE_REVIEW_REMEDIATION_2026-08-22.md`）の build 番号と操作説明を更新。写真への追加は端末内の保存であり、App Privacy の収集データには当たらない想定（最終判断はユーザー）。審査用アカウント・連絡先は従来の残件どおり。
5. **審査提出（ユーザーの最終承認後）**: Claude は提出操作の直前に確認を取る。
6. **Web 反映**: 同じ変更を main へ反映（Vercel 本番）。審査とは独立。

### 実機確認チェックリスト（build 19 以降）

- 共有: 名簿・道具割当表・隊列表（スマホ向け）の画像/PDF、A4 PDF、ステージのスクリーンショット、隊列表ZIPで「共有・保存」→ 共有シートが開く。LINE、AirDrop、「画像を保存」（画像のみ）、「"ファイル"に保存」が選べる。
- 写真保存: 初回の「写真へ追加」許可ダイアログに日本語の説明が出る。許可後に写真アプリへ保存される。**許可しない を選んでもアプリが落ちない。**
- 取消: 共有シートを閉じてもアプリが落ちず、完成画面から再共有できる。
- 名簿・割当: ＋追加、×削除、道具割当（タップで割当）、各タブの名簿ボタン。
- 既存機能の回帰: 音源選択（前回却下理由）、保存・再読み込み、縦横回転、ステージ/パレード。
- 端末: iPad の機種名・iPadOS バージョン・build 番号を記録する。

更新（以下は build 18 時点の記録）: 2026-10-02。ユーザーの承認回答を受けて作業再開。一般公開・審査送信・Web本体公開は対象外。別途許可を得たサポートページだけ公開済み。
旧記録の残件よりこの一覧を優先する。ユーザーは2026-10-02に「実機確認が終了しました。問題なしです」と報告。確認したbuild番号・正確なOSと審査情報の照合までは、提出準備完了としない。

## 完了済みと証拠

| 項目 | 確認した証拠 | 限界 |
| --- | --- | --- |
| 却下原因の修正 | AudioDocumentPickerPlugin.swiftは.audio専用。iosReleaseMetadata.test.tsでカメラ経路不使用を検査 | 実機の選択UIは最終buildで要確認 |
| 完成アイコン | AppIcon.appiconsetの1024px画像と参照設定。テストでサイズ・不透明度を確認 | 最終buildのホーム画面と起動画面は要確認 |
| build 17 | run 35866099145をAPIで再照合。archive/upload/署名後始末がsuccess | Apple処理・現在のテスター提供状態は未確認 |
| 最終候補build 18 | commit f6c639c、run 35922139370でarchive/upload成功。新規Development証明書1件のみ失効。App Store Connectで処理完了・チーム内テスト（内部1名）への登録を確認 | 実機確認終了・問題なしの報告は受領。確認した番号が18であることの照合待ち |
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
| 公開方法・配信対象 | 2026-10-02の承認後、App Store Connectで手動リリースを保存。Mac・Apple Vision Proの配信チェックを外し「保存済み」を確認 | 審査への再提出・一般公開は行っていない |
| ユーザーによる実機確認 | 2026-10-02に実機確認終了・問題なしの報告を受領 | build番号・正確なOS・個別項目の結果は未提示。別機種の合格や実際のアカウント削除成功は推定しない |

## Codexが続けること

- [x] 専用ブランチの署名なしSimulator Releaseビルドを確認。commit 1621322、run [35920235183](https://github.com/shingoto1112/tairetsu-maker/actions/runs/35920235183)成功。
- [x] 既存TestFlight手順で最終候補build18をarchive/upload。run [35922139370](https://github.com/shingoto1112/tairetsu-maker/actions/runs/35922139370)成功。
- [x] 使用Xcode/SDKをログで確認。Xcode26.6 (17F113) / iPhoneOS26.5.sdk。iPadOS27対応をビルドだけで判定しない。
- [x] Apple処理完了・内部テスターへの提供を確認。build18の詳細画面で内部グループ1件（1名）を確認。外部testグループには追加していない。
- [x] 実機結果を受領。ユーザーから問題なしの報告があり、この報告に起因する修正は不要。
- [ ] 実機確認したbuild番号と正確なiPadOSを照合。
- [x] build18の却下理由別返信と日本語UIラベル付き審査操作説明の下書きを準備（APP_STORE_REVIEW_REMEDIATION_2026-08-22.md）。
- [ ] 実機結果と審査用アカウントを確認してApple返信文を送信可能な最終版として確定。

Simulator runのログ: Xcode 26.6 (17F113)、iPhoneSimulator26.5.sdk、BUILD SUCCEEDED。
iPadOS 27ランタイムでの起動・操作確認ではない。最終TestFlight archiveもXcode26.6 / iPhoneOS26.5.sdkを使用。
build18のアップロード完了は2026-09-24 06:27 JST。ログは「Uploaded package is processing」「Upload succeeded」。Appleの処理完了を示す証拠ではない。

## ユーザー確認待ち

1. 今回生成したDevelopment証明書1件だけの後始末はユーザー承認済みで完了。旧12件整理はfalseでスキップ。既存証明書・Distribution証明書は対象外。
2. サポートメールはユーザー指定の tairetsu.maker@gmail.com に決定。追加承認を受け公開ページへ反映済み。受信確認は未実施。
3. 実機確認は終了・問題なしとの報告を受領。確認したTestFlight build番号と正確なiPadOSを質問済み。個別チェック未実施があれば補足してもらう。
4. App Store Connectの審査連絡先、審査用アカウント、現在のメタデータ・価格・カテゴリ・画像・App Privacyを確認。認証情報をGitやこの文書に書かない。
5. 本番SMTPと確認/回復メールが一般利用者へ届くことを確認。送信テストは本人が管理するアドレスで実施。
6. 本番アカウント削除の実行試験は専用アカウントで、削除直前の別承認が必要。キャンセル検証と混同しない。
7. 2026-10-02に再ログインを確認。審査連絡先の電話番号・メールは入力済み。サインイン必須OFF・審査用アカウント未設定は継続。専用アカウントの提供と入力はユーザー側で行う。連絡先の実際の到達性は未確認。
8. 2026-10-02にユーザーが「手動公開・iPadのみ」を承認し、変更・保存まで完了。手動リリース選択と保存ボタン無効化、Mac/Apple Vision Pro配信のチェックOFFと「保存済み」を画面で確認。価格・地域・審査選択buildは変更していない。

## App Store Connectの現状確認

2026-09-24に読み取り専用で確認。審査へ送信していない。
2026-10-02の再確認では審査連絡先の電話番号・メールは入力済み、選択buildは引き続き旧12。承認された公開方法とMac/Vision Pro配信対象だけ変更・保存した。

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
