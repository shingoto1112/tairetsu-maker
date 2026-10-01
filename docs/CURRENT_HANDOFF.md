# CURRENT_HANDOFF.md

このファイルは、長くなったCodexチャットから新しいチャットへ作業を引き継ぐためのメモです。
新しいチャットでは、まず `AGENTS.md`、`docs/SPEC.md`、このファイルを読んでから作業してください。

最終更新: 2026-10-02

## 2026-10-02: 承認済み公開設定の保存完了

- ユーザーが「手動公開・iPadのみ」を明示承認。再ログイン後、App Store Connectで手動リリースへ切り替え、Mac・Apple Vision Pro配信を無効にして保存完了。手動選択と保存ボタン無効化、配信チェックOFFと「保存済み」を画面で確認。承認の再確認は不要。
- 審査連絡先の電話番号・メールは入力済みに変わっていた。実際の到達性は未確認。サインイン必須OFF・審査用アカウント未設定、審査選択buildは旧12のまま。
- build18実機結果、審査アカウント、認証メール到達の残件は継続。価格・地域を変更せず、審査再提出・一般公開・新build作成は行っていない。

## 2026-09-24: 再審査準備ゴール再設定

- ユーザーの承認回答を受けて再審査準備を継続。最新残件は `docs/IPAD_RESUBMISSION_STATUS.md`、実機手順は `docs/IPAD_RESUBMISSION_DEVICE_CHECKLIST.md` を参照。
- 音源読み込みの事前検証・一時ファイル回収修正を引き継いだ。
- 保存復元で、localStorage読み書きやミラー修復の失敗が復元一覧表示を妨げる問題を4件の失敗テストで再現し修正。
- 全17 files / 75 tests、typecheck、build、cap sync、cloud:check成功。公開3ページHTTP200。
- commit 1621322を専用ブランチへpush。Simulator Release run 35920235183成功（Xcode26.6 / Simulator SDK26.5）。iPadOS27実機確認は未実施。
- 専用ブランチcodex/ipad-resubmission-20260924で作業し、そのブランチのVercel自動デプロイを抑止。mainへのpush/mergeはしない。
- 新規Development証明書1件だけの後始末をユーザーが承認。commit f6c639cでTestFlight run 35922139370 / build18をアップロード済み。76 tests、build、archive/upload成功。新規1件の失効を確認、旧12件整理はfalseでスキップ。
- build18はXcode26.6 / iPhoneOS SDK26.5。Apple側処理完了、内部チーム内テスト1名への提供を画面で確認。iPadOS27を含む実機確認は未実施。審査選択buildは旧12のまま。
- サポートメールはtairetsu.maker@gmail.com。追加許可後、mainのd8484f6を土台にページ+テストだけの4c2a34fをpush、Vercel Production 6625245500成功。公開ページとmailtoを確認、Web本体JS/CSSのアセット名は公開前後一致。メール受信未確認。
- 9/24時点では審査電話番号・メールが空欄、審査用アカウント未設定、合格後自動公開とMac/Vision Pro配信がONだった。10/02に連絡先入力済みを確認し、承認済みの「手動公開・iPadのみ」へ変更・保存完了。価格1500円、カテゴリ・4+・iPad画像1枚・App Privacy4種類は9/24の確認。審査送信なし。
- npm auditは現在全依存9件、本番依存fflateのmoderate1件。jspdfはzlibSyncのみ利用し、指摘対象unzipSyncの呼び出しはsrcにない。詳細は残件文書参照。ページ公開へ依存更新は混ぜていない。
- build18向けApple返信・審査メモの未送信下書きをAPP_STORE_REVIEW_REMEDIATION_2026-08-22.mdに整備。実際のUIに合わせ「追加 > 新しく作る > ステージ隊列 > 音源ファイルを選択」を併記。実機合格や審査用アカウントの有効性は未確認で、送信可能とはまだ扱わない。
- 旧文書の「証明書12件の整理待ち」は解消済み。過去の一般公開計画をすべて新ゴールへ追加しない。

## 2026-09-23: 署名上限解消とTestFlight build 17

- ユーザーの明示承認後、固定IDのCI由来Development証明書12件をAPIで再照合・失効。
- Distribution証明書は対象外。既存12件の整理はworkflowの手動入力時のみ実行する。
- CI終了時は開始前との差分かつrunner内の署名identityとSHA-1が一致するDevelopment証明書1件だけを失効。
- 不完全な一覧、壊れたsnapshot、複数候補、runnerが秘密鍵を持たない候補では失効を拒否。
- commit `a00d49b` のTestFlight run `35866099145`が成功。build 17をアップロード済み。
- CIで17 files / 61 tests、型チェック込みWeb build、iOS archive、uploadが成功。
- ログで既存12件の失効、アップロード成功、今回生成の1件の自動失効を確認。
- Apple側の処理完了・内部テスト配信状態は未確認。実機QA、審査連絡先、再提出は未完了。
- 次はTestFlightで1.0 (17)を確認し、音源選択、再生、保存復元、縦横表示を実機確認する。

以下の8月の記録は当時の履歴。署名証明書の承認待ちは解消済み。

## 最新作業メモ: App Store初回審査の修正

初回審査build 12は、仮アイコンに見えるApp Iconと、「新しいステージ隊列を作成」で
`Take Video`を選んだ後のクラッシュにより却下された。

実装済み:

- iPadの音源選択をHTML `audio/*`入力から、`UIDocumentPickerViewController` /
  `UTType.audio`を使うネイティブ音源ファイル専用ピッカーへ変更。
- Web/Windows版も対応音声拡張子だけを指定し、撮影導線を除去。
- 方眼、センターライン、5つのメンバーセルで構成する完成版App Iconへ変更し、
  faviconと起動画面も同じ意匠へ統一。
- 音源200MB、隊列表ファイル256MB、JSON 24MB、ZIP 64ファイル・展開後224MBの
  安全上限を追加。
- React Error Boundaryと、個人情報・隊列表内容を含めない診断情報を追加。
- PDF、画像、ZIP処理を遅延読み込みし、初回JSを約1.15MBから約482KBへ削減。
- TestFlight workflowでdSYMと配布ログを30日保管。
- GitHub Actionsでは3日ごと、Codex heartbeatでは毎日9時にSupabaseと公開ページを確認。
- 詳細とAppleへの返信案を `docs/APP_STORE_REVIEW_REMEDIATION_2026-08-22.md` に記録。
- 修正版TestFlight build 13をrun `32518204864`でアップロード済み。
- 日本語ローカリゼーション宣言後のRelease Simulator buildをrun `32520142293`で検証済み。
- CIが新規作成したDevelopment証明書1件だけを判定・失効する安全スクリプトと4テストを追加。
- App Store Connectから旧build 12のクラッシュログ3件を取得。すべて
  `NSCameraUsageDescription`不足によるTCC終了で、旧 `Take Video` 経路が原因と確定。

検証済み:

- `npm run typecheck` 成功。
- `npm test` 成功、17 files / 57 tests。
- `npm run build` 成功、chunk size警告なし。
- `npm audit --omit=dev` 0 vulnerabilities。
- `npm run cloud:check` 成功。
- `npx cap sync ios` 成功、新規SwiftファイルのXcode登録を維持。
- ローカル実ブラウザで作成ダイアログ、音源拡張子限定、サポートページを確認。

残作業:

- Apple Developerに残ったCI由来Development証明書12件を、ユーザー確認後に失効する。
- TestFlight workflowへ、そのrunが作成した証明書1件だけを終了時に失効する処理を接続する。
- 日本語ローカリゼーション宣言を含む新しいTestFlight buildを作成し、iPad Air第5世代相当の実機で音源選択を確認する。
- GitHubアカウント不要のサポート用メールアドレスを決める。
- App Review Informationの連絡先電話番号・メールアドレスを入力する。
- 審査用アカウントを設定し、App Reviewへ返信して新buildを再提出する。

## 最新作業メモ: iPad本人専用クラウドとアカウント削除

2026-08-13時点で、App Store公開に向けた本人専用クラウド経路とアカウント削除を
追加しました。

実装済みの中心:

- iPadではowner本人のクラウド隊列表だけを扱い、招待・連絡先・Realtime・ロック共同編集を
  引き続き無効化しています。
- TestFlight workflowへ、Web版と同じSupabase URL / publishable keyをGitHub
  Environmentから渡す設定を追加しました。
- ログイン中のクラウド欄へ「アカウント」画面を追加し、現在のパスワード再確認と
  アプリ内の最終確認モーダル後だけアカウントを削除できます。
- `20260813000000_cloud_account_deletion.sql` を追加しました。唯一所有するクラウド
  隊列表は完全削除し、共同所有は別ownerへ引き継いでから本人の認証・参加情報・連絡先を
  削除します。ローカル隊列表は削除しません。
- 公開までの担当分担とRelease Gateを `docs/IPAD_APP_STORE_RELEASE_PLAN.md` にまとめました。

現在の本番状態:

- Supabase projectは復旧済み。
- Web版とGitHub Environmentに本番URL / publishable keyを設定済み。
- アカウント削除RPCを含む必要migrationを適用済みで、`npm run cloud:check`は成功。

## 最新作業メモ: iPad縦向きの横展開とキャンバス中央維持

2026-08-13時点で、上下分割の基本方針を維持しつつ、縦向きの編集カード内部とキャンバス位置を追加調整しました。

実装済みの中心:

- メンバー/道具の表示切替、管理、グループ、設定、割当など、カード内部の縦積み要素を縦向きだけ横展開にしました。
- 編集タブごとに横スクロール位置を記憶し、別タブから戻ったときに作業位置を復元します。
- 横送り可能な方向を端の影で示し、現在位置に近いカードを薄く強調します。
- 「編集を閉じる」で上段を62pxへ縮め、キャンバス優先表示へ切り替えられます。
- ステージは表示領域や向きが変わった後も実キャンバス中心を画面中央へ補正します。
- パレードは拡大操作の基準を画面中央にし、縦横を切り替えても中央表示を維持します。
- 横向きは従来の左サイド編集パネルと縦展開を維持しています。

検証状況:

- 縦向き `1024x1366` で、メンバー表示切替4件が同じ高さの横一列になることを確認済み。
- タブを往復しても横スクロール位置が復元されることを確認済み。
- 縦向き `1366x1872` で、ステージ中心と表示領域中心の誤差が1px未満であることを確認済み。
- パレードを拡大後、縦向きと横向きを往復しても横中央を維持することを確認済み。
- 横向き `1366x1024` で既存の左サイド配置と縦展開を確認済み。

注意:

- TestFlight実機では、指でカードを送る感触、縦横回転後の中央維持、編集パネル折りたたみを再確認してください。

## 最新作業メモ: iPad縦向きUIの再調整

2026-08-05時点で、上下分割の基本方針を維持したまま、iPad縦向きの編集画面を再調整しました。

実装済みの中心:

- 上側の編集領域を最大236pxへ縮め、下側の隊列キャンバスを広くしました。
- メンバー/道具の表示タブと追加先説明を1枚の操作カードへまとめ、空白だけを占有する横スクロール項目をなくしました。
- メンバー、道具、割当、音源、メモ、ステージ、詳細、シーンの全8タブを、縦向きでは横送りできる同一形式の操作カードに統一しました。
- シーン一覧も横送りへ統一し、選択シーンの詳細はカード内で縦スクロールできます。
- シーンサムネイル帯とパレード操作帯を低くし、キャンバス開始位置を上へ寄せました。
- 上部ツールバー、編集カード、ステージ/パレード操作の主要ボタンは、縦向きiPadで44px以上のタッチ領域を確保しました。
- 横向きでは既存の左サイド編集パネル配置を維持しています。

検証状況:

- iPad相当の縦向き `1024x1366` と `1366x1872` でステージ/パレードを確認済み。
- 縦向きの全8編集タブで、横送りと内部スクロールが機能することを確認済み。
- 横向き `1366x1024` で既存配置が崩れていないことを確認済み。
- `npm test -- --run`: 32件成功。
- `npm run typecheck`: 成功。

注意:

- 横スクロール帯の各カードは、内容がカード高を超える場合だけカード内を縦スクロールします。
- 最終的な指での送りやすさはTestFlight実機で再確認してください。

## 以前の作業メモ: iPad実機QA後の操作性改善

2026-08-04時点で、Capacitor iOS版の初回実機テストを受けたUI改善を実装しました。

実装済みの中心:

- iPad縦向きでは、編集タブ、編集内容、シーンナビゲーター、操作パネルを上側へ縦に並べ、各領域を横スクロールできる構成にしました。隊列キャンバスは下側に確保しています。
- iPad横向きでは、従来どおり左側の編集パネルを縦スクロールする構成を維持しています。
- パレードのピンチ操作中はReact全体を毎フレーム再描画せず、一時transformで追従し、操作終了時だけ正式な拡大率を保存する方式へ変更しました。
- メンバー/道具管理はモーダル風表示をやめ、縦横とも画面全体を使う管理画面にしました。終了は「隊列表へ戻る」で行います。
- ハンバーガーメニューの表示設定を「ステージ」タブへ移しました。
- 道具形状の表示名を日本語へ統一しました。
- カラーパレットを13列x8行の固定パレットへ変更し、任意色は「その他の色」から選択できるようにしました。

検証状況:

- iPad相当の縦向き `1024x1366` と横向き `1366x1024` をブラウザで確認済み。
- 縦向きの各上部領域が横スクロールでき、下側キャンバスと重ならないことを確認済み。
- メンバー/道具管理が両向きで表示領域全体を使うことを確認済み。
- ブラウザのconsole error/warningは0件。
- `npm test -- --run`: 31件成功。
- `npm run typecheck`: 成功。
- `npm run build`: 成功（既存のchunk size警告のみ）。
- `npm run ios:sync`: 成功。

注意:

- パレードのピンチ最適化はブラウザ上の通常拡大操作とレイアウト更新を確認済みです。2本指の最終的な感触はTestFlight実機で再確認してください。
- 初回TestFlight確認で、iPadの広い表示幅とポインタ判定によりデスクトップ縮小表示が適用され、縦向きレイアウトへ切り替わらない問題が見つかりました。iOSアプリをデスクトップ縮小の対象外にし、縦向き条件を幅1400pxまで広げて修正済みです。
- カラーパレットは各パネルの重なり順やoverflowの影響を受けないよう、React Portalで `document.body` 直下に表示します。104色すべてと最下段右端の選択をブラウザ・自動テストで確認済みです。

## 最新作業メモ: Phase 6 キャンバス上の複数選択ドラッグ

2026-05-15時点で、Phase 5 の隊列操作パネル/キーボード移動に続き、キャンバス上で複数選択メンバーをまとめてドラッグする操作を `member_position` の複数セルロック + patch保存へ対応しました。

実装済みの中心:

- ステージモードで、複数選択中のメンバーの1人をドラッグすると、選択メンバー全員の相対位置を保って同時移動します。
- パレードモードでも同じく、複数選択中のメンバーをキャンバス上で同時ドラッグできます。
- クラウド共同編集中は、ドラッグ開始時に対象メンバー全員の `member_position` leaseをまとめて取得します。
- すべて取得できた場合だけドラッグを開始し、ドロップ時に対象ごとにpatch保存・lease解除します。
- 取得に失敗した場合はドラッグを開始せず、取得済みleaseを解除します。
- 既存の単一メンバー移動、道具移動/サイズ変更/回転、Phase 5 のキーボード移動は維持しています。

検証状況:

- `npm run typecheck`: 成功。
- `git diff --check`: 成功（改行警告のみ）。
- `npm run build`: 成功。
- `npm run cloud:check`: 成功。
- `npm run cloud:smoke`: 成功。最新smoke project ID: `9eeaee87-e567-4d10-a319-526da64b48f9`。

未完了/注意:

- 複数選択ドラッグ中のlive previewは、対象メンバーごとに既存の `member_position` preview経路で送信されます。DB保存は引き続きドロップ後のpatch保存のみです。
- グループ表示、シーン名/時刻/順序は引き続きproject/sceneOrder側の扱いです。

## 以前の作業メモ: Phase 5 複数選択移動・キーボード移動のセル単位保存

2026-05-15時点で、Phase 4 のセル単位パッチ対象拡張に続き、複数メンバー位置をまとめて変える操作を `member_position` の複数セルロック + patch保存へ対応しました。

実装済みの中心:

- キーボード矢印移動は、選択中メンバー/道具に対応する `member_position` / `object_state` leaseを取得してから移動し、対象ごとに保存・解除します。
- 複数選択の矢印ボタン移動、左右反転、隊列テンプレート適用、整列/均等配置は、対象メンバー全員の `member_position` leaseを取得してから変更します。
- 複数セルのうち一部でもlease取得に失敗した場合は、変更を反映せず、取得済みleaseを解除します。
- 保存済みpatch同期の方針を維持し、ドラッグ中previewは追加していません。
- 既存のローカルUndo/Redoは維持し、クラウド共同編集中のUndo/Redo無効も維持しています。

検証状況:

- `npm run typecheck`: 成功。
- `npm run build`: 成功。
- `git diff --check`: 成功（改行警告のみ）。
- `npm run cloud:check`: 成功。
- `npm run cloud:smoke`: 成功。最新smoke project ID: `2f54f37f-eb27-45b5-9aaf-1fb522e5477f`。

未完了/注意:

- 複数選択メンバーをキャンバス上でドラッグして同時移動する専用UIは、今回の対象外です。既存の隊列操作パネルとキーボード移動のセル単位保存が対象です。
- グループ表示、シーン名/時刻/順序は引き続きproject/sceneOrder側の扱いです。

## 以前の作業メモ: Phase 4 セル単位パッチ対象拡張

2026-05-15時点で、Phase 0-3 の live preview / cell patch 基盤を維持したまま、クラウド共同編集中のセル単位パッチ保存対象を広げました。

実装済みの中心:

- `member_visibility`: メンバーのこのシーンでの表示/非表示をセル単位ロック後に `memberVisibility[memberId]` だけ保存します。
- `object_visibility`: 既存の `objectStates[objectId]` がある道具の表示/非表示を `objectStates[objectId].visible` だけ保存します。
- `object_assignment`: 道具割当を `objectAssignments[objectId]` だけ保存します。
- `notes`: シーンメモを `notes` セルとして保存します。クラウド共同編集中はメモ欄の入力をblur時にまとめて保存します。
- 一括表示/非表示や前シーン割当反映のように複数セルを同時に変える操作は、必要なセルロックをまとめて取得してから変更し、対象ごとにpatch保存します。
- `save_scene_cell_patch_with_lock` は既存の Phase 0 migration に含まれるpatch typeを利用し、追加migrationは不要です。
- `scripts/cloud-collab-smoke.mjs` に `member_visibility`, `object_visibility`, `object_assignment`, `notes` の保存確認を追加しました。

検証状況:

- `npm run typecheck`: 成功。
- `npm run build`: 成功。
- `npm run cloud:check`: 成功。
- `npm run cloud:smoke`: 成功。owner/editor/viewer、scene/cell/project lock、Phase 4対象patch保存、version conflict、project系操作が壊れていないことを確認。

未完了/注意:

- live preview は引き続き `member_position` と `object_state` が対象です。表示/非表示、道具割当、シーンメモは保存済みpatch同期のみです。
- グループ表示、複数選択移動、キーボード移動、シーン名/時刻/順序は今回のPhase 4対象外です。
- Web版へ反映する場合は、コミット/push後にVercel Productionの反映確認を行ってください。

## 以前の作業メモ: Phase 2 道具 state live preview

2026-05-15時点で、Phase 1 のメンバー移動previewに続き、道具 state の live preview を追加しました。

実装済みの中心:

- 道具の移動・サイズ変更・回転中に、`object_state` previewをRealtime broadcastで送信します。
- preview対象は `scene_cell:{sceneId}|object_state|{objectId}` です。
- preview値は `objectStates[objectId]` の完全な `ObjectState` で、保存データには混ぜず、受信側キャンバス用 `snapshot.objectStates` にだけ一時反映します。
- 送信側は対象道具の `scene_cell` lease取得後だけpreviewを送ります。
- 受信側は `leaseId`, `operationId`, `holderClientId` が現在の `edit_locks` と一致するpreviewだけ採用します。
- 同じoperationでは `seq` が古いpreviewを無視します。
- commit / 保存通知 / lock release / lock expired で道具previewを消します。
- メンバー位置previewと道具state previewは同じ表示専用snapshotへ重ねます。

検証状況:

- `npm run typecheck`: 成功。
- `npm run build`: 成功。
- `git diff --check`: 成功（改行警告のみ）。
- `npm run cloud:check`: 成功。
- `npm run cloud:smoke`: 成功。既存のscene/cell/project lock、object cell保存、cell version管理が壊れていないことを確認。

未完了/注意:

- Phase 2は「道具stateの見えるlive preview」までです。複数端末での実操作確認は未実施です。
- 表示/非表示、道具割当、シーンメモのlive previewは未対応です。

## 最新作業メモ: Phase 1 メンバー移動 live preview

2026-05-15時点で、Phase 0 の基盤を使い、クラウド共同編集中のメンバー移動 live preview を追加しました。

実装済みの中心:

- メンバー位置のドラッグ中だけ、Supabase Realtime broadcast `preview` を送信します。
- previewは `scenes.data` やローカル保存データには混ぜず、受信側のキャンバス表示用 `snapshot` にだけ一時反映します。
- 送信側は `scene_cell:{sceneId}|member_position|{memberId}` のlease取得後だけpreviewを送ります。
- 受信側は `leaseId`, `operationId`, `holderClientId` が現在の `edit_locks` と一致するpreviewだけ採用します。
- previewには `seq` を持たせ、同じoperationの古いpreviewは後から描画しません。
- ドロップ時は従来通り `save_scene_cell_patch_with_lock` でcell patch保存し、commit broadcast / audit log通知でpreviewを消します。
- Realtimeの送信上限を `eventsPerSecond: 15` に調整し、preview送信は約80ms間隔に抑えています。
- 対象はメンバー移動のみです。道具移動、表示/非表示、道具割当、シーンメモのlive previewは未対応です。

検証状況:

- `npm run typecheck`: 成功。
- `npm run build`: 成功。
- `git diff --check`: 成功（改行警告のみ）。
- `npm run cloud:check`: 成功。
- `npm run cloud:smoke`: 成功。既存のscene/cell/project lock、cell patch保存、version_conflictが壊れていないことを確認。
- `http://127.0.0.1:5173/` はHTTP 200。Playwright実ブラウザ確認は、この環境のbundled packageで `playwright-core` が解決できず未実施。

未完了/注意:

- Phase 1は「メンバー移動の見えるlive preview」までです。複数端末での実操作確認と、道具移動previewは次フェーズ候補です。
- previewは表示専用です。保存済みの正式データは引き続きドロップ後のcell patch保存だけで更新します。

## 最新作業メモ: Phase 0 live preview 基盤

2026-05-15時点で、リアルタイム共同編集へ進む前段として Phase 0 の live preview 基盤を追加しました。

実装済みの中心:

- Supabase migration `supabase/migrations/20260515002000_cloud_live_preview_foundation.sql` を追加。
- `scene_cell_versions` table を追加。既存全セル分のmigration生成はせず、保存時に lazy upsert します。
- `edit_locks` は新テーブルを作らず既存拡張。`lease_id`, `operation_id`, `holder_client_id`, `renewed_at` を追加。
- `acquire_edit_lock`, `heartbeat_edit_lock`, `release_edit_lock`, `save_scene_cell_patch_with_lock` は既存RPC名のまま、lease/client/operation metadataに対応。
- `save_scene_cell_patch_with_lock` は `p_expected_base_version` を受け取り、対象セルのversion不一致時は `version_conflict` を返します。
- フロントはタブ単位の `clientId`、操作単位の `leaseId` / `operationId` を生成し、セル保存時に渡します。
- フロントはクラウドプロジェクト読込時に `list_scene_cell_versions` を読み込み、未作成セルはversion 0として扱います。
- Realtime側に preview/commit/lock event 型、preview送信用のseq生成ヘルパー、preview/commit送信関数を追加。ただし Phase 0 ではドラッグ中座標の送信・表示反映はまだ行いません。
- `scripts/cloud-collab-sql.mjs`, `scripts/cloud-collab-check.mjs`, `scripts/cloud-collab-smoke.mjs` を Phase 0 migration / cell version に対応。

検証状況:

- `npm run typecheck`: 成功。
- `npm run build`: 成功。
- `git diff --check`: 成功（改行警告のみ）。
- `npm run cloud:check`: 成功。Phase 0 RPC、`list_scene_cell_versions`、cell version返却を確認済み。
- `npm run cloud:smoke`: 成功。owner/editor/viewerで、同一シーン内の別メンバーcell同時編集、object cell保存、`scene_cell_versions` lazy upsert、古いbaseVersionの `version_conflict` を確認済み。

未完了/注意:

- Supabase本番DBには Phase 0 migration 適用済み。SQLを再生成する場合は `node scripts/cloud-collab-sql.mjs | Set-Clipboard` を使うと、npmログ行を混ぜずにコピーできます。
- Phase 0 は「土台」までです。live previewのドラッグ中反映、lease整合チェック付きpreview受信、UI表示は後続Phaseで実装します。
- 既存のシーン単位ロックとセル単位ロックは互換用に残しています。

## 直前作業メモ: セル単位ロック移行 第1実装

2026-05-15時点で、クラウド共同編集をシーン単位ロックから `scene_cell` ロック + パッチ保存へ段階移行中です。

実装済みの中心:

- Supabase migration `supabase/migrations/20260515001000_cloud_scene_cell_locks.sql` を追加。
- `edit_locks.target_type` に `scene_cell` を追加。
- `save_scene_cell_patch_with_lock` RPC を追加。
- メンバー位置は `member_position` セルロックで `positions[memberId]` だけ保存。
- 道具移動/サイズ変更/回転は `object_state` セルロックで `objectStates[objectId]` だけ保存。
- 同じシーン内でも別メンバー/別道具なら同時編集可能な設計。
- クラウド共同編集中は Undo / Redo を無効化。ローカル編集では維持。
- 保存済みパッチ通知は、安全な場合のみ対象フィールドへ自動反映。自分が操作中/未保存の場合は更新通知へフォールバック。
- `scripts/cloud-collab-check.mjs` と `scripts/cloud-collab-smoke.mjs` にセル単位RPC検証を追加。

未完了/注意:

- Supabase本番DBには新migrationを適用する必要があります。`node scripts/cloud-collab-sql.mjs | Set-Clipboard` 済みなので、SQL Editorで実行後に `npm run cloud:check` / `npm run cloud:smoke` を再実行してください。
- 表示/非表示、道具割当、シーンメモ、複数選択移動、キーボード移動は第1実装では完全なセル単位保存対象外です。
- 既存の `scene:{sceneId}` ロックは互換用に残しています。

## 現在のリポジトリ

- アプリ名: 隊列メーカー
- 技術構成: React + TypeScript + Vite
- Windows版: Tauri
- 作業フォルダ: `C:\Users\shing\Documents\Codex\2026-04-29\react-typescript-vite-web-stageflow-json`
- GitHub: `https://github.com/shingoto1112/tairetsu-maker`
- 公開URL: `https://tairetsu-maker.vercel.app`
- ローカル開発URL: `http://localhost:5173/`
- 現在ブランチ: `main`

## 新しいチャットで最初に読むファイル

必須:

1. `AGENTS.md`
2. `docs/SPEC.md`
3. `docs/CURRENT_HANDOFF.md`

必要に応じて確認:

- `docs/CHATGPT_PRO_REVIEW_BRIEF.md`
- `docs/RECREATE_FROM_ZIP_REPORT.md`
- `docs/UX_AUDIT.md`
- `docs/QA_REPORT.md`
- `docs/UI_REDESIGN_PROPOSAL.md`
- `docs/WINDOWS_APP_RELEASE.md`

## 重要な開発方針

- 既存機能を壊さない。
- `dist/` やビルド済みファイルは直接編集しない。
- 保存データ互換性を壊さない。
- ステージモードとパレードモードの処理を混同しない。
- UI文言は日本語。
- 共有リンク機能は使わない方針。
- ZIP / `.tairetsu` 書き出し・読み込みを基本にする。
- 大きな設計変更は、先に方針確認してから段階的に実装する。
- 変更後は最低限 `npm run build` を実行する。

## 現在の未コミット状態

このハンドオフ作成時点で、作業ツリーには未コミット変更があります。
新しいチャットでは、最初に必ず以下を実行してください。

```powershell
git status --short
git diff --stat
```

確認時点の差分:

```text
 M src/App.tsx
 M src/components/FormationLibrary.tsx
 M src/components/ParadeCanvas.tsx
 M src/components/StageCanvas.tsx
 M src/components/StageSettingsPanel.tsx
 M src/components/AssignmentPanel.tsx
 M src/components/ColorPaletteInput.tsx
 M src/components/GroupToolsPanel.tsx
 M src/components/MemberPanel.tsx
 M src/components/ObjectPanel.tsx
 M src/components/Toolbar.tsx
 M src/components/AudioPanel.tsx
 M src/components/DetailsPanel.tsx
 M src/components/SceneNotesPanel.tsx
 M src/components/Timeline.tsx
 M src/styles.css
?? .env.example
?? docs/CLOUD_COLLAB_SPEC.md
?? docs/CLOUD_COLLAB_SETUP.md
?? src/cloud/
?? src/components/CloudShareModal.tsx
?? src/vite-env.d.ts
?? supabase/
```

`git diff --stat` の概要:

```text
 docs/CURRENT_HANDOFF.md               | 106 ++--
 package-lock.json                     | 100 ++
 package.json                          |   1 +
 src/App.tsx                           | 2169 +++++++++++++++++++++++++++++++--
 src/components/AssignmentPanel.tsx    |  21 +-
 src/components/AudioPanel.tsx         |   7 +
 src/components/ColorPaletteInput.tsx  |   9 +-
 src/components/DetailsPanel.tsx       |  44 +-
 src/components/FormationLibrary.tsx   | 241 ++++
 src/components/GroupToolsPanel.tsx    |  65 ++-
 src/components/MemberPanel.tsx        | 106 +++-
 src/components/ObjectPanel.tsx        | 124 ++++-
 src/components/ParadeCanvas.tsx       |  37 +-
 src/components/SceneNotesPanel.tsx    |   9 +
 src/components/StageCanvas.tsx        |  47 +-
 src/components/StageSettingsPanel.tsx |  29 ++
 src/components/Timeline.tsx           |  68 ++-
 src/components/Toolbar.tsx            |  72 ++-
 src/styles.css                        | 343 ++++++
 19 files changed, 3400 insertions(+), 198 deletions(-)
```

注意:

- これらの変更は直近要望に関係している可能性があります。
- 勝手に戻さないでください。
- `docs/CLOUD_COLLAB_SPEC.md`、`src/cloud/`、`supabase/` はクラウド共同編集の新規追加です。
- `.env.example` と `src/vite-env.d.ts` は Supabase 設定用です。

## 最近の大きな流れ

最近の主な実装・調整:

- Web版をVercelへ公開済み。
- Windows版Tauriビルドを作成済み。
- アプリアイコンを新しい隊列メーカー用アイコンに変更済み。
- パレードモードを追加。
- パレードの横方向表示、縦m目盛り、5m/10mライン、スクロール、ズーム、書き出しを継続調整中。
- ステージ画像保存・印刷・PDF・PNG書き出しを継続調整中。
- メンバー/道具の名簿管理モーダルを追加中。
- 色選択UIを、ブラウザ標準カラーピッカーではなく、明るい色中心のパレットUIへ改善中。
- メンバーアイコン内の文字サイズ・配置を、1〜4文字で見やすい方向へ調整中。
- ステージ/パレードのピンチズーム、パン、ロック挙動を改善中。
- Supabase Free を前提にしたロック式共同編集の初期実装を進行中。

## 直近タスクの状況

ユーザーが承認した直近方針:

Supabase Free 想定で、完全リアルタイムではなく「シーン単位のロック式共同編集」にする。

最新状況:

- ロック式共同編集の初期実装はWeb版で実際に共同作業できるところまで完了。
- 本番URL: `https://tairetsu-maker.vercel.app`
- 最新Vercel deployment: `dpl_DpgNMtHb8nRzz6QxVnsMLybciaao`
- 最新検証用クラウドプロジェクトID: `68db9080-6fa2-4ee7-9032-f174482c7491`
- `npm run cloud:check` 成功。
- `npm run cloud:smoke` 成功。owner/editor/viewerで、招待受領、同一シーンロック拒否、viewerのscene lock拒否、別シーン同時ロック、scene保存、ロック解除を確認済み。
- 本番UIで owner/editor/viewer のロール表示を確認済み。
- 本番UIで、ownerが `Smoke 1` を編集中に editor が同じ `Smoke 1` を編集しようとすると閲覧のまま拒否されることを確認済み。
- 本番UIで、ownerが `Smoke 1` を編集中でも editor が別シーン `Smoke 2` を編集できることを確認済み。
- 本番UIで、editorが `Smoke 2` を保存すると owner 側に `更新があります: Smoke 2` と `更新を再読み込み` が表示されることを確認済み。
- `docs/CLOUD_COLLAB_COMPLETION_AUDIT.md` に完了監査を記録済み。

実装済み:

- `docs/CLOUD_COLLAB_SPEC.md` にクラウド共同編集の設計メモを追加。
- `supabase/migrations/20260514000000_cloud_collaboration_foundation.sql` に主要テーブル、RLS、RPC の土台を追加。
- `src/cloud/` に Supabase API/Auth/session/lock token/project parts のクライアント層を追加。
- ライブラリ画面にクラウドログイン、クラウド一覧、ローカルからクラウド作成、クラウドを直接開く、ローカルへ複製を追加。
- クラウドプロジェクトはローカル保存と明確に分離し、開いた直後は閲覧モード。
- 「このシーンを編集」で scene lock を取得し、30秒 heartbeat、編集終了、現在シーンのクラウド保存まで実装。
- `StageCanvas` / `ParadeCanvas` に read-only 状態を追加し、閲覧中は直接ドラッグ・編集操作を止める。
- ツールバーとステージ/パレード設定パネルもクラウド閲覧中は編集不可にした。
- `MemberPanel` / `ObjectPanel` / `AssignmentPanel` / `GroupToolsPanel` に権限 props を追加し、クラウド閲覧中やロック未取得時の編集ボタンを無効化。
- `ColorPaletteInput` に disabled を追加し、クラウドで編集不可の色変更入口も閉じられるようにした。
- `Timeline` / `DetailsPanel` / `SceneNotesPanel` / `AudioPanel` に権限 props を追加し、シーン追加・削除・並び替え・名称変更はクラウドでは不可、メモや座標などのシーン内編集はロック取得時のみ可能に整理。
- クラウドプロジェクトで音源を読み込んだ場合は、この端末での再生用として扱い、クラウド側の音源情報は更新しないようにした。
- owner 向けに `project:settings` のロック取得、30秒 heartbeat、解除、`save_project_resource_with_lock` による保存をフロントから既存RPCへ接続。
- `project:settings` ロック中だけステージ/パレード設定パネルを編集可能にし、scene lock とはフロント/DB両方で排他にした。
- `supabase/migrations/20260514001000_cloud_collaboration_sharing_realtime.sql` を追加し、招待テーブル、招待作成/受取、権限変更、参加者削除、招待取り消し、Realtime publication 追加を実装。
- `@supabase/supabase-js` を追加し、`edit_locks` と `audit_logs` の Realtime 購読をフロントに接続。
- Realtimeクライアントは動的importにして、通常利用の初期バンドルから分離。Viteでは `realtime-*.js` の別チャンクとして出力される。
- owner向けの「共有管理」モーダルを追加し、招待リンク作成、参加者権限変更、参加者削除、招待取り消しを実装。
- ライブラリ画面に招待リンク/招待コード入力を追加し、招待されたユーザーがログイン後にクラウドプロジェクトへ参加できるようにした。
- 他ユーザー保存時に「更新があります。再読み込み」ボタンを出し、自動再読み込みはしないようにした。
- 保存競合やロック喪失時は、対象シーンまたはproject resourceをJSON退避する処理を追加。
- `docs/CLOUD_COLLAB_SETUP.md` にSupabase/Vercel設定手順を追加。

検証済み:

- `npm run build` 成功。project:settings ロック接続後も成功。
- 共有/Realtime接続追加後も `npm run build` 成功。
- `npx vercel build` 成功。ただしVercel環境変数は未設定。
- Realtime動的import後も `npm run build` / `npx vercel build` 成功。
- `git diff --check` は空白エラーなし。CRLF警告のみ。
- `npm audit --omit=dev` は production dependency 0 vulnerabilities。
- `http://127.0.0.1:5173` のローカル表示確認成功。
- Chrome headless でページタイトル `隊列メーカー`、クラウドパネル表示、コンソールエラーなしを確認。
- `node --check scripts/cloud-collab-check.mjs` / `node --check scripts/cloud-collab-smoke.mjs` 成功。
- `npm run cloud:check` は `.env` 未設定のため、想定通り `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` 不足で停止。
- `node --check scripts/cloud-collab-sql.mjs` 成功。
- `node --check scripts/cloud-collab-vercel-env.mjs` 成功。
- `npm run --silent cloud:sql` は、2 migration を順番通りに連結して出力することを確認済み。
- `npm run cloud:vercel-env` は `.env` 未設定のため、想定通り `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` 不足で停止。
- チェック導線追加後も `npm run build` 成功。

次に進める候補:

- owner 専用の project 系ロックを `members` / `objects` / `audio` / `sceneOrder` に段階的に広げる。特に `members` / `objects` は既存UIがシーンデータも同時に触るため、保存単位の設計に注意する。
- 実 Supabase 環境変数を入れた状態で、ログイン・クラウド作成・ロック取得・保存を実機確認する。
- Supabase SQL migration を実プロジェクトに適用し、Vercel に `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` を設定する。
- `npx vercel env ls` では `tairetsu-maker` に環境変数が無い状態だったため、Web版で共同編集を有効にするにはVercel env追加が必要。
- Supabase導入補助として `npm run cloud:check` を追加。`.env` の URL/anon key と SQL migration 適用状態をログインなしで確認できる。
- `npm run cloud:smoke` を追加。owner/editor の2アカウント情報を環境変数で渡すと、招待、同一シーンロック拒否、別シーン同時ロック、保存、解除のRPC経路を確認できる。任意で viewer 情報も渡すと viewer のscene lock拒否も確認する。
- `npm run --silent cloud:sql | clip.exe` を追加。Supabase SQL Editor に貼るSQLを2 migration 分まとめてコピーできる。
- `npm run cloud:vercel-env` を追加。`.env` の `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` を Vercel Production に反映できる。値はコマンド引数ではなくstdinで渡す。Preview/Developmentは `CLOUD_VERCEL_ENVIRONMENTS` で明示指定。
- `docs/CLOUD_COLLAB_SETUP.md` に、初回ログイン、GitHubリポジトリ選択スキップ、New project、Project URL/anon public key取得までの手順を追記。
- Supabaseの新UIに合わせ、`anon public key` だけでなく `publishable key` 表記でも迷わないように手順とエラー文言を更新。
- ローカル `.env` は `.gitignore` で除外されていることを確認済み。`VITE_SUPABASE_URL=https://jhpvdrdunyicrzptgtom.supabase.co` とユーザー提供の publishable key を入力済み。
- `npm run cloud:check` は Supabase へ到達したが、`public.projects` が無く `PGRST205` で停止。SQL migration はまだ実プロジェクトに未適用。
- `npm run --silent cloud:sql | clip.exe` で、Supabase SQL Editor に貼るSQLをクリップボードへコピー済み。
- fetch後のスクリプト失敗時にNodeが荒く終了しないよう、`cloud-collab-check.mjs` / `cloud-collab-smoke.mjs` のcatchを `process.exitCode = 1` に変更。変更後も `node --check` / `npm run build` 成功。
- `npx vercel env ls` で Production の `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` が入っていることを確認済み。Previewはブランチ指定が必要になったため、標準補助コマンドはProductionのみへ変更。
- ユーザーが Supabase SQL Editor で migration を実行し、`Success. No rows returned` を確認。
- migration適用後の `npm run cloud:check` 成功。`projects` table と `create_cloud_project` / `acquire_edit_lock` / `create_project_invite` / `accept_project_invite` RPC が到達可能で、未ログイン時に `not_authenticated` を返すことを確認。
- `npm run cloud:smoke` は owner/editor 環境変数未設定のため想定通り停止。次は Supabase Auth で owner/editor、可能なら viewer の一時アカウントを作成して実行する。
- ローカルViteを `.env` 反映後に再起動済み。Playwright CLIで `http://127.0.0.1:5173/` を確認し、クラウド欄がログイン/新規登録フォームになっていること、`Supabase接続が未設定です` が出ないこと、console error 0件を確認。
- Vercel Production環境変数反映後に `npx vercel build --prod` 成功。`.vercel/output` 作成済み。
- owner/editor/viewer のテストユーザー作成済み。
- 初回 `npm run cloud:smoke` で `create_cloud_project` RPC 内の `project_id` 曖昧参照が発覚。migration SQLを修正済みで、`npm run --silent cloud:sql | clip.exe` により更新済みSQLをクリップボードへコピー済み。Supabase SQL Editor で再実行が必要。
- 修正内容: `create_cloud_project` の required resource exists、heartbeat/save/update系、共有管理RPCの一部でテーブルaliasを明示し、PL/pgSQLの返却カラム名との衝突を避けた。
- 再実行後の `npm run cloud:smoke` で `create_cloud_project` は成功。次に `digest(text, unknown) does not exist` が発覚したため、`cloud_collab_token_hash` を `extensions.digest(convert_to(...), 'sha256')` へ修正し、`create extension if not exists pgcrypto with schema extensions` に変更。更新済みSQLを再度クリップボードへコピー済み。
- digest修正SQLをSupabaseへ再適用後、`npm run cloud:smoke` 成功。owner/editor/viewerで、招待受領、同一シーンロック拒否、viewerのscene lock拒否、別シーン同時ロック、scene保存、ロック解除を確認済み。最新検証プロジェクトID: `68db9080-6fa2-4ee7-9032-f174482c7491`。
- `src/cloud/api.ts` のクラウド一覧で、他ユーザーの `project_members.role` を拾って自分のロール表示が上書きされる問題を修正済み。現在はaccess tokenの `sub` を使い、自分の `project_members` のみ取得する。
- Vercel Productionへ反映済み。production deploy `dpl_DpgNMtHb8nRzz6QxVnsMLybciaao` を `https://tairetsu-maker.vercel.app` にalias済み。
- 本番UIで `https://tairetsu-maker.vercel.app` の表示、クラウドログインUI、console error 0件を確認済み。
- 本番UIで owner/editor/viewer のロール表示、同一シーンロック拒否、別シーン同時編集、保存通知表示まで確認済み。

## 2026-05-14 追記: owner向け project 系操作拡張

今回の追加目標:

- owner のみが、クラウド上でメンバー名簿、道具マスター、音源メタ情報、シーン追加/削除/並び替え/名称変更、JSON / `.tairetsu` / ZIP import によるクラウド上書きを実行できるようにする。
- editor は引き続き `scene:{sceneId}` の scenes.data のみ編集可能。
- viewer は閲覧のみ。
- project 系ロックは scene lock と排他にし、Realtime はロック状態と保存通知メタ情報のみ同期する。

実装済み:

- `supabase/migrations/20260514002000_cloud_project_owner_operations.sql` を追加。
  - `save_scene_order_with_lock`
  - `import_cloud_project_with_lock`
- `npm run --silent cloud:sql` は3本の migration を順番に出力する。
- `npm run cloud:check` は新RPC2本も確認する。
- `npm run cloud:smoke` は owner/editor/viewer に加え、以下を確認するよう拡張。
  - scene lock 中の project lock 拒否
  - project lock 中の scene lock 拒否
  - editor の project lock 拒否
  - owner による `project:members` / `project:objects` / `project:audio` 保存
  - owner による `project:sceneOrder` のシーン追加/削除
  - owner による `project:import` のクラウド上書き
- フロントに owner 専用の導線を追加。
  - 全体設定
  - メンバー名簿
  - 道具マスター
  - 音源設定
  - シーン構成
  - クラウド上書き
- メンバー名簿/道具マスターの project lock 中は、マスターのみ保存対象にし、各シーン内の配置/表示状態は同時変更しないよう境界を整理。
- 音源はクラウドにファイル本体を保存せず、メタ情報のみ保存対象にした。
- シーン構成の保存は `sceneOrder` resource と `scenes` table をRPC内で整合更新する。
- シーン削除と import は snapshots に操作前バックアップを残す。
- editor/viewer には project 系編集ボタンを表示しない。
- 他ユーザーの project lock 中は「メンバー名簿の編集中です。シーンは閲覧のみです。」のように、シーン編集不可の理由を表示する。

検証済み:

- `npm run typecheck` 成功。
- `npm run build` 成功。
- `npm run cloud:check` 成功。
- `npm run cloud:smoke` 成功。
  - 最新RPC smoke project ID: `de64691c-dc73-4063-88aa-f725f85e85d9`
  - `project:sceneOrder` はシーン追加/並び替え/削除を確認済み。
- ローカルUI `http://127.0.0.1:5173/?qa=project-ops` で確認。
  - owner で project 系ボタンが表示される。
  - owner が `メンバー名簿` ロックを取得すると管理モーダルが開き、道具管理タブは無効化される。
  - owner が `シーン構成` ロックを取得し、シーン名変更を `クラウド保存` できる。
  - editor では project 系ボタンが表示されない。
  - owner が `メンバー名簿` ロック中、editor の「このシーンを編集」は拒否され、閲覧のみ表示になる。

Supabase実環境:

- ユーザーが SQL Editor で3本目の migration を含むSQLを実行済み。
- `save_scene_order_with_lock` / `import_cloud_project_with_lock` は `cloud:check` で到達確認済み。

## 2026-05-15 live preview Phase 3 QA

Phase 0-2 で追加済み:

- `supabase/migrations/20260515002000_cloud_live_preview_foundation.sql`
  - `edit_locks` に `lease_id` / `operation_id` / `holder_client_id` / `renewed_at` を追加。
  - `scene_cell_versions` を追加し、セル単位 version は保存時 lazy upsert。
  - `save_scene_cell_patch_with_lock` は `expectedBaseVersion` を比較し、対象セルだけ `scenes.data` へ patch 保存。
- `src/App.tsx`
  - `member_position` と `object_state` の live preview broadcast / receive / canvas overlay を追加。
  - ドロップ後は cell patch 保存、commit通知、preview消去、lock解除。
  - クラウド共同編集中は Undo / Redo 無効。ローカル編集では従来通り維持。
- `src/cloud/realtime.ts`
  - Realtime broadcast に `preview` / `commit` を追加。
  - ドラッグ中の座標はDB保存せず、broadcast preview のみ送る。

Phase 3 QA で確認済み:

- `npm run cloud:smoke` 成功。
  - 最新QA project ID: `06e46b2d-1149-4061-bfad-848a0bc8578a`
  - title: `Codex cloud smoke 2026-05-15T08:50:28.144Z imported`
- 独立した2ブラウザコンテキストで owner/editor が同じクラウドプロジェクトを開ける。
- owner が `smoke` をドラッグ中、editor 側に `member_position` preview が反映され、ドロップ後も同じ位置に commit される。
- owner が `object-smoke` をドラッグ中、editor 側に `object_state` preview が反映され、ドロップ後も同じ位置に commit される。
- owner が `object-smoke` のサイズ変更ハンドルを操作した時、editor 側の道具サイズへ preview / commit が反映される。
- 同じ `member_position` を editor が操作しようとした場合、位置は変わらず二重編集が防がれる。
- 確認範囲の Realtime/console app error/warning は 0件。

注意:

- ブラウザ自動操作では非常に速いドラッグだと、lock取得前に移動が終わって preview が小さく見えることがある。人間操作相当のゆっくりしたドラッグでは preview が追従することを確認済み。
- 道具を動かす時は左サイドの `道具` タブを使う。上部の `道具マスター` は project lock を取得するため、シーン配置は閲覧のみになる。
- 道具回転は `object_state` patch の同じ経路に乗るが、自動ブラウザ操作では回転ハンドルのドラッグ角度を安定再現しにくく、今回はハンドル表示まで確認。手動QAまたは専用e2eで追加確認するとよい。

残タスク:

- Git commit `b355b87` (`Extend cloud owner project operations`) を `main` にpush済み。
- Vercel Production へ反映済み。
  - deployment: `dpl_G6mdaZuBbj3X1Vs4vHfw6S4db3TF`
  - production URL: `https://tairetsu-maker.vercel.app`
- production URL でクラウドログインUI、ownerのクラウドプロジェクト一覧、project系ボタン一式、console error/warning 0件を確認済み。
- production URL で検証用クラウドプロジェクトへJSONファイルを選択し、確認ダイアログ承認後に「クラウド隊列表を上書きしました。」まで確認済み。

## 新しいチャットでの具体的な手順

1. Codexで新しいチャットを開く。
2. 同じ作業フォルダを開く。
   - `C:\Users\shing\Documents\Codex\2026-04-29\react-typescript-vite-web-stageflow-json`
3. 最初のメッセージとして、下の「新チャット開始プロンプト」を貼る。
4. Codexに以下を確認させる。
   - `AGENTS.md`
   - `docs/SPEC.md`
   - `docs/CURRENT_HANDOFF.md`
   - `git status --short`
   - `git diff --stat`
5. 直近タスクの実装を続ける。
6. 実装後に `npm run build` を実行する。
7. 必要ならWeb版へ反映するため、GitHubへpushする。

## 新チャット開始プロンプト

新しいチャットに以下をそのまま貼ってください。

```text
このリポジトリは隊列メーカーです。
まず AGENTS.md、docs/SPEC.md、docs/CURRENT_HANDOFF.md を読んでください。

前のチャットがコンテキスト上限に近いため、このファイルから引き継いで作業してください。
最初に git status --short と git diff --stat を確認し、未コミット変更を壊さずに進めてください。

直近の未完了タスクは、Supabase Free 想定のシーン単位ロック式共同編集です。
docs/CURRENT_HANDOFF.md の「直近の未完了タスク」に沿って進めてください。

既存機能、保存互換性、ステージモード/パレードモードの分岐、ローカル保存との分離を壊さず、実装後は npm run build を実行してください。
```

## ローカル開発サーバーを開く手順

新しいチャットで動作確認したい場合:

```powershell
npm run dev
```

表示されたURL、通常は以下をブラウザで開く。

```text
http://localhost:5173/
```

既に別プロセスが動いていてポートが変わる場合は、Viteの表示に従ってください。

## Web版へ反映する手順

変更をGitHub/Vercelへ反映する場合:

```powershell
npm run build
git status --short
git add .
git commit -m "実装内容が分かる日本語または英語メッセージ"
git push
```

push後、Vercelが自動デプロイします。

公開URL:

```text
https://tairetsu-maker.vercel.app
```

## 注意すべき未解決・継続論点

- 右側道具割当付き書き出しは、まだ設計方針が決まった段階で、実装途中または未実装の可能性があります。
- 名簿管理モーダル `RosterManagementModal.tsx` は未追跡なので、新チャットで内容確認が必要です。
- 印刷・スクリーンショット・PDF周りは変更影響が大きいので、既存のステージ/パレード出力を壊さないように注意してください。
- パレードモードの画像保存は、最前/最後尾から前後3mを含む範囲で出す方針です。
- 共有リンク機能は使わない方針です。復活させないでください。
- JSON単体バックアップは優先度低めです。ZIP書き出しを基本にしてください。

## このチャットを続けるか、新しいチャットにするか

このチャットでも作業は続けられますが、履歴がかなり長くなっているため、反応が重くなったり、古い文脈が混ざるリスクがあります。

おすすめは、新しいチャットに移り、このファイルを読ませてから続行することです。
Codex側から自動で新しいチャットを作成して送信することはできないため、ユーザー側で新しいチャットを開いて、上の開始プロンプトを貼ってください。
