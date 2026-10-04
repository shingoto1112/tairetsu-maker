# 使い方ページ・整列・状態表示（2026-10-04）

## 実装と判断

- V字を選択肢、FormationTemplate union、Appの座標分岐から削除。横1列・縦1列・斜め1列を維持。FormationTemplateは操作引数で、Project・FormationFrame・保存codec・ZIPにテンプレート種別のフィールドはない。既存のV字配置は通常の座標なのでそのまま読み込める。データ移行は不要。
- 履歴権限は参加中の全員・ゲストが参加前も含めて閲覧・独立コピー・手動控え・共有復元でき、手動削除は作成者だけ。既定値をユーザー確認済み（2026-10-04）に確定。SQLは変更していない。
- 使い方は最大760pxのスクロール可能なモーダル。三本線の「情報・サポート」先頭と、ホームのフッターにアイコン付きボタンを追加。節は独立して開閉でき、「場所:」は緑の背景で強調する。
- aria-modal、見出し・領域の関連付け、Tab循環、Esc・閉じるボタン、元の入口へのフォーカス復帰、背景のinert化・スクロール停止を実装。閉じるボタンと見出しは44px以上。
- collaborationV2 OFFでは共同編集の節を出さず、ONでは見出しと「準備中です。」だけ。サポートは既存のPUBLIC_LINKS.supportを利用し、新しいタブに安全に開く。
- 本文・コンポーネント・CSSは動的importで別チャンク。起動後1.5秒で先読みし、回線復帰時も先読みを試す。ネイティブ配布ではローカル同梱アセットから読む。Webでは先読み完了後なら初めて開く場合もオフラインで読める。Webアプリ全体の未キャッシュ状態でのオフライン起動は既存構成では提供していない。
- 状態ボタンは縮小・折り返しを許可し、高さを自動化。縦向きヘッダーも文言に応じて広がり、スマホでは行を分ける。「送信待ち 0 件（端末保存中）」等の0件表示を「端末に保存中」にした。同期状態の内部判定は維持。

## 原稿からの変更

- 「新規 / 読込」→「追加（新規 / 読込）」：実際のホームボタンの主ラベルを補った。
- 「名前・グループ・色・座標、道具の横幅・縦幅・回転角度を数字で入力できます。」→「名前・グループ・色を編集し、座標や道具の横幅・縦幅・回転角度を数字で入力できます。」：数字を入力する対象を正確にした。
- 共同編集の予定本文は載せず、ONの場合だけ「準備中です。」。
- 「困ったとき」の「サポート」を既存リンクにした。その他の原稿本文は維持。V字の記載なし。

## 変更ファイル

| 対象 | ファイル |
|---|---|
| 整列・入口 | `src/types.ts`, `src/App.tsx`, `src/components/GroupToolsPanel.tsx`, `Toolbar.tsx`, `FormationLibrary.tsx`, `LegalLinks.tsx`, `src/styles.css` |
| 使い方（新規） | `src/components/HelpPageLoader.tsx`, `HelpPage.tsx`, `helpContent.ts`, `helpPage.css`, `HelpPage.test.tsx` |
| 状態 | `src/components/collaboration.css`, `src/storage/sharedSessionState.ts`, `sharedSessionState.test.ts` |
| 試験 | `src/AppRoster.test.tsx`, `src/components/Toolbar.test.tsx`, `scripts/test-help-page-browser.mjs`（新規）, `scripts/test-build22-browser.mjs`, `scripts/check-collaboration-bundle.mjs` |
| 文書 | `docs/COLLABORATION_HISTORY.md`, `docs/IPAD_RESUBMISSION_STATUS.md`, 本書 |

build22試験は既存5179サーバーに触れず実行できるよう、保存試験と同じ`REPOSITORY_TEST_ORIGIN`指定を追加し、loopback HTTPに限定した。既定の5179は維持。

## 検証

- `npm test -- --maxWorkers 2`：最終機能を含む91ファイル・761件を2回合格。途中の初回は整列の追加2件を含む前で759件合格。
- 追加・関連4ファイル35件を2回合格：ステージ／パレードの3種整列の座標・保存、メニュー順、各節開閉、V2 OFF/ON、サポートURL、Tab・Esc・フォーカス復帰、0件の文言。
- `npm run typecheck` 合格。
- `node scripts/check-collaboration-bundle.mjs` 合格。実Vite設定で通常／probeを一時ディレクトリへビルドし削除。使い方本文・CSS、共同編集・Yjsの起動グラフ分離を検査。通常メイン`index-CZMsktmJ.js`は **475,310 B**、gzip **141,342 B**。基準474,341 Bから **+969 B（約0.20%）**。
- `test-build22-browser` 合格：12寸法×ステージ／パレード、タップ・ドラッグ・長押し・ピンチ・慣性・ズーム600%・シーン表示・146人画像。専用5187サーバー使用。
- `test-app-storage-browser` a〜l合格：既存データ移行、保存・競合・救出、ZIP、音源、バックアップ、GC、復旧。専用5187サーバー使用。
- `test-collaboration-ui-browser`、`test-shared-session-app-browser` 合格：ローカルmockだけ。招待・同期・removed/ended・独立コピー・アカウント切替など既存機能を確認。
- `test-help-page-browser` を2回合格：Chromiumのネットワークを遮断した状態で初回表示、ホーム／編集メニューの入口、全節開閉、V2 OFF/ON、アクセシビリティ、実Toolbarの12状態×5寸法の全文Range境界・ヘッダー内収まりを確認。状態画像は実コンポーネントに決定的な試験スナップショットを与えている。
- Viteの既存audioStorage静的／動的import重複の警告あり。ビルド失敗なし。
- `git diff --check` 合格。一時ビルド出力と今回の一時サーバー／補助ファイルは削除済み。作業中にClaude側のLinux CI修正でHEADが`3dffb00`から`77b90a5`へ進んだが、その差分には触れていない。

## スクリーンショット

保存先：`C:/Users/shing/AppData/Local/Temp/claude/c--Users-shing-OneDrive--------ChatGPT-------/e5aa9c38-eb07-490c-ac06-62f047c4c161/scratchpad/shots-help/`

寸法：`744x1133`, `1133x744`, `1032x1376`, `1376x1032`, `390x844`。

以下の各接頭辞に`-{寸法}.png`を付けた全75枚。全ファイル一覧と境界測定は同フォルダーの`results.json`。

- 使い方：`help-list`, `help-roster-open`, `help-v2-preparing`（15枚）。
- 状態：`status-synced`, `status-saving`, `status-pending`, `status-pending-saving`, `status-checking`, `status-offline`, `status-save-failed`, `status-removed`, `status-ended`, `status-auth-required`, `status-membership-changed`, `status-recovery-required`（60枚）。

## 制約

ChromiumでiPad寸法・runtimeを再現した確認であり、実iPad／Safariのネイティブ動作確認は未実施。Webでは先読み前に通信が失われた場合、未取得の使い方チャンクは読めない。アプリ全体のオフライン再起動保証には別途キャッシュ方針が必要。

Project型・ZIP形式・PrintPreview・dist・SQL／Edge／Swift・Claude担当保守ファイル・既存HTTPS一時設定は変更していない。依存追加・本番接続・commit／push／workflow実行なし。
