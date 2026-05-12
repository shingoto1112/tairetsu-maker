# CURRENT_HANDOFF.md

このファイルは、長くなったCodexチャットから新しいチャットへ作業を引き継ぐためのメモです。
新しいチャットでは、まず `AGENTS.md`、`docs/SPEC.md`、このファイルを読んでから作業してください。

最終更新: 2026-05-12

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
 M src/components/PrintPreview.tsx
 M src/components/ShareExportModal.tsx
 M src/components/Toolbar.tsx
 M src/styles.css
?? docs/CURRENT_HANDOFF.md
?? src/components/RosterManagementModal.tsx
```

`git diff --stat` の概要:

```text
 src/App.tsx                         | 332 +++++++++++++++++++++++++++
 src/components/PrintPreview.tsx     | 355 +++++++++++++++++++++++++---
 src/components/ShareExportModal.tsx |  18 +-
 src/components/Toolbar.tsx          |  14 ++
 src/styles.css                      | 445 ++++++++++++++++++++++++++++++++++++
 5 files changed, 1126 insertions(+), 38 deletions(-)
```

注意:

- これらの変更は直近要望に関係している可能性があります。
- 勝手に戻さないでください。
- `src/components/RosterManagementModal.tsx` は未追跡ファイルなので、内容を確認してから扱ってください。
- このファイル `docs/CURRENT_HANDOFF.md` も未追跡です。必要ならGitに追加してください。

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

## 直近の未完了タスク

ユーザーが承認した直近方針:

「ステージ隊列の書き出し画像の右側に、道具割当の表示も同時に入れたい」

実装したいこと:

- 道具割当だけを単独で書き出す機能は不要。
- ステージ隊列の書き出しに「道具割当も追加」オプションを追加する。
- 書き出し画像内では、隊列表を左に寄せる。
- 右側に道具割当エリアを配置する。
- 道具は配置中の大きさ・色・名前を引き継ぐ。
- 担当メンバーは四角セルではなく、通常の丸いメンバーアイコンで表示する。
- 道具割当エリアは、隊列外に整理して表示する。
- 道具が小さい場合や数が多い場合は、横並びも検討する。
- まずはステージモード中心に実装し、パレードを壊さない。

関連ファイル候補:

- `src/components/PrintPreview.tsx`
- `src/components/ShareExportModal.tsx`
- `src/utils/exportImage.ts`
- `src/styles.css`
- 必要なら `src/App.tsx`
- 必要なら `src/types.ts`

実装開始時に見るべきポイント:

- `ShareExportModal` に、書き出し詳細画面のオプションとして「道具割当も右側に表示する」を追加する。
- 既にある「現在シーンの道具割当画像」のような単独書き出し導線は、今回の方針では不要または優先度低め。
- `PrintPreview` 側は `includeAssignments` を「ステージの代わりに割当だけ出す」ではなく、「ステージの右側に割当を追加する」という意味に変える。
- パレードモードでは今回の右側割当表示を無理に適用しない。まずはステージモードのみ安全に実装する。

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

直近の未完了タスクは、ステージ隊列の書き出し画像の右側に道具割当も同時表示する機能です。
docs/CURRENT_HANDOFF.md の「直近の未完了タスク」に沿って進めてください。

既存機能、保存互換性、ステージモード/パレードモードの分岐を壊さず、実装後は npm run build を実行してください。
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

