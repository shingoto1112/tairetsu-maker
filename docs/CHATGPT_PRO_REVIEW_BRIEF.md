# ChatGPT Pro レビュー依頼用メモ

このファイルは、隊列表作成アプリ「隊列メーカー」の現状を ChatGPT Pro などに確認してもらうための共有メモです。

## 確認してほしいアプリ

- アプリ名: 隊列メーカー
- 公開URL: https://tairetsu-maker.vercel.app
- GitHubリポジトリ: https://github.com/shingoto1112/tairetsu-maker
  - 現在 private のため、外部から直接読めない可能性があります。
  - その場合は、このメモと一緒にソースZIPをアップロードしてください。

## アプリの目的

ダンス、舞台、パレードなどで使う隊列表を作成・編集・保存・印刷・書き出しできるWebアプリです。

主な利用想定:

- ダンスステージのシーンごとの隊列表作成
- メンバー、グループ、道具、幕、割当の管理
- 曲に合わせたシーン切り替え
- パレード形式の縦長隊列表作成
- ZIP形式での共有
- スクリーンショット、印刷、PDF保存
- iPadでの編集

## 技術構成

- React
- TypeScript
- Vite
- npm

主要コマンド:

```bash
npm install
npm run typecheck
npm run build
npm run dev
```

## まず読んでほしいファイル

- `AGENTS.md`
- `docs/SPEC.md`
- `docs/CHATGPT_PRO_REVIEW_BRIEF.md`

必要に応じて:

- `src/App.tsx`
- `src/components/StageCanvas.tsx`
- `src/components/ParadeCanvas.tsx`
- `src/components/PrintPreview.tsx`
- `src/components/FormationList.tsx`
- `src/components/DetailsPanel.tsx`
- `src/types.ts`
- `src/styles.css`
- `src/utils/tairetsuFile.ts`
- `src/utils/exportImage.ts`
- `src/utils/pdfExport.ts`
- `src/utils/storage.ts`

## 現在とくに見てほしい観点

1. iPadでの操作性
   - ピンチイン/アウトの自然さ
   - 拡大後のスクロール
   - ステージ/パレードの表示領域
   - タッチ操作で誤操作が起きないか

2. ステージモード
   - ステージ全体表示と拡大表示の両立
   - メンバーや道具の配置、ドラッグ、座標管理
   - センター割り表示と通常メートル表示
   - メンバー名ラベルの見やすさ
   - 大人数、150人弱を想定したときの視認性

3. パレードモード
   - 縦長キャンバスのスクロールとズーム
   - 5m/10mラインと1mグリッドのズレがないか
   - メンバー/道具がグリッド上に正しく乗るか
   - ステージモードで便利な機能がパレードにも必要か

4. 保存・読み込み
   - ブラウザ内保存
   - IndexedDBでの音源保存
   - `.zip` / `.tairetsu` 読み込み・書き出し
   - 既存データとの互換性

5. 印刷・スクリーンショット
   - ステージ部分だけが画像化されるか
   - iPadで保存/共有しやすいか
   - PDF保存が壊れないか
   - パレード出力の範囲指定が自然か

6. コード品質
   - `src/App.tsx` が肥大化しすぎていないか
   - `StageCanvas` / `ParadeCanvas` の責務が複雑すぎないか
   - TypeScript型の安全性
   - 将来的な保守性

## 相談したいこと

以下について、具体的な修正案・優先順位・実装方針を出してください。

- いま残っていそうなバグ
- iPadで使いにくいUI
- 150人規模の隊列で重くなる可能性
- ステージモードとパレードモードの設計分離
- 印刷、スクリーンショット、ZIP共有まわりの安定化
- 今後のリファクタリング優先順位
- すぐ直すべき小さな改善
- 後回しにしてよい大きな改善

## 注意してほしいこと

- 既存機能を壊さない前提で提案してください。
- 保存データ形式を破壊的に変える提案は、移行処理込みで考えてください。
- UIは日本語利用が前提です。
- サーバーを使う共有リンク機能は現時点では使わない方針です。
- ZIPでの書き出し・読み込みを基本にしています。

