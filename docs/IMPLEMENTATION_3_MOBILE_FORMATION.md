# 実装③: 隊列表のスマホ版

## 入口と既定値

- 三本線メニュー「共有と書き出し」→「スマホで見る（LINE向け）」→ 隊列表の画像 / PDF。
- 実装②の `DocumentExportSheet` に対象「隊列表」を追加。範囲は全シーン、拡大図はオフ、画像が基本。PDFの入口ではPDFを初期選択する。
- 名簿画面はステージ設定を受け取っていないため、そこでは従来の名簿・割当表を維持。隊列表の入口から開いた共通シートでは4対象を切り替えられる。
- 予想ページ数はフォント準備後、生成と同じ測定・ページ計画で求める。

## 描画・ページ計画

- `PrintPreview` の従来の描画とレイアウト計算を `PrintStagePreview` へ移動。既定の引数とA4のCSSは保持。
- `StaticStagePreview` は出力幅とx/y範囲を受け取り、A4のmetrics計算を経由せず同じ描画を使う。割当欄・メモ・操作UI・選択状態を含めない。
- 論理幅540px、pixelRatio 2、上限960px。最終ページだけ内容に合わせて縮める。
- ステージ全体図はシーン名・小さい時刻・図を分割不可のブロックにし、入るだけ積む。全シーン共通の実寸縮尺を使う。非常に深いステージでは全体図の共通縮尺を高さ上限に合わせる。
- 順序は全シーンの全体図 → シーン順の拡大図（観客から見て左→右、縦の続きは上→下）。全体の流れを先に追えることと、全体図の積み上げを優先。
- 拡大図は0.5mの重なりと外周の丸半径分の余白を確保。丸が約64画像px以上になる最小の左右分割数を求め、最大3分割に制限する。共通部分の淡い帯は維持。
- 0.5mの丸、12×8mのステージでは左右2分割。左右の目盛り帯36 CSS pxをページ幅内に確保し、実描画幅420 CSS px、各タイル幅6.5m（重なり・外周余白込み）で丸の直径は約64.6画像px。18m→3分割、4m→1分割。既に全体図が読める狭いステージでは拡大図を重複生成しない。
- ステージは拡大図も奥行き方向に分割せず、ページ高さに合わせて縦横比を保って縮める。非常に深いステージや、最大3分割でも足りない幅・小さい丸では64pxを下回り得る。縦分割禁止・最大3分割を優先する。
- 各拡大ページにシーン名、左右位置、配置を示す縮小図と切り出し範囲を入れる。パレードは全体図・必要な拡大図ともページ高さで縦分割を維持し、続き番号と距離範囲を表示する。
- スマホ版ステージの縦目盛りは絶対座標0mから1mごと。描画範囲の上下パディングを値の起点にせず、範囲内の整数mだけを元の位置へ描く。左右の帯幅は桁数・符号を含むラベル長に応じて増やし、10pxの等幅文字と左右4pxの余白を確保。100m以上・負距離もページ幅内へ収める。
- 横目盛り、センター線、センター割りの既存ルールは維持。目盛り修正はスマホviewportと専用CSSに限定し、A4の既定処理・見た目は変更しない。
- パレードは表示中かつ未割当のメンバーと、回転道具の外接範囲から上下約2mを取る。範囲を先にページ分割し、全長Canvasを作らない。5m/10m線、左右距離目盛り、既存の横表示方式を保持。
- 大きな道具はタイル境界をまたいで続く。0.5mの重なりだけでは大型道具全体を1枚に収める保証はできない。全体図と縮小図で全形と位置を確認できる。

## 性能と完了条件

- `mobileExportPipeline` を名簿・割当表・隊列表で共用。1ページずつDOM描画→PNGエンコード→CanvasとDOM解放。全ページ成功時だけ完成結果を返す。
- スマホPDFは `createMobilePdfWriter` へ1ページずつ追加。全ページ分のPNGのbase64配列を保持しない。A4用PDF関数と既定値は維持。
- 完成PNGファイル群とPDFの圧縮済みページ情報は、最終共有に必要なため保持する。作業用Canvas・DOMの保持量はページ数に比例しない。
- 書き出し・測定・PDFコードは遅延読み込み。生成中の進捗・取消と、完成済み結果からの再共有は実装②を継承。

## 実装③全体の変更ファイル（今回より前の差分を含む）

- 入口・UI: `src/App.tsx`（共有用データの受け渡しのみ）、`src/components/ShareExportModal.tsx`、`src/components/DocumentExportSheet.tsx`、`src/styles.css`
- 描画: `src/components/PrintPreview.tsx`、`src/components/PrintStagePreview.tsx`、`src/components/StaticStagePreview.tsx`、`src/components/FormationMobilePage.tsx`
- 計画・生成: `src/utils/formationExportLayout.ts`、`src/utils/formationExport.tsx`、`src/utils/mobileExportTypes.ts`、`src/utils/mobileExport.ts`、`src/utils/mobileExportPipeline.ts`、`src/utils/pdfExport.ts`
- テスト: `PrintPreview.test.tsx` とスナップショット、`FormationMobilePage.test.tsx`、`ShareExportModal.test.tsx`、`DocumentExportSheet.test.tsx`、`formationExportLayout.test.ts`、`mobileExport.test.ts`、`pdfExport.test.ts`、`formationExportFixture.ts`
- 今回の目盛り補助: `src/utils/formationRulers.ts`。未使用の計測関数とテストは`src/utils/pdfEncodingBenchmark*`から`scripts/benchmark-image-pdf-encoding*`へ移動し、アプリからは参照しない。

今回の修正は`formationExportLayout.ts`、`formationRulers.ts`、`PrintStagePreview.tsx`、`StaticStagePreview.tsx`、`FormationMobilePage.tsx`、スマホ専用CSS、関連4テスト、計測スクリプト移動と実装②・③資料更新に限定。`App.tsx`、`PrintPreview.tsx`、A4スナップショットは今回編集していない。

## 検証と未確認事項

- 修正前のClaude実測（24人・4グループ・道具4個・3シーン・12×8m）: 全体図のみ2ページ・285KB・3.6秒、拡大図あり20ページ・1.95MB・22.9秒。このページ数・容量・時間は旧分割規則の結果。
- 新規則のテストでは3シーン・12×8mで全体図2＋拡大図6＝8ページ。フォント測定をモックした予想・生成の一致を確認済み。30シーンのモック試験は全体図15＋拡大図60＝75ページ。
- 今回の`npm test`: 44ファイル・282テスト成功（scriptsへ移動した計測テストも含む）。`npm run typecheck`、`git diff --check`成功。
- Viteビルド: `.tmp-mobile-formation-fix-build`へ一時出力して成功。メインJS489.23kB、gzip137.57kB、500kB警告・混在import警告なし。出力は確認後に削除。テスト・ビルドはesbuildの親ディレクトリ参照がsandboxで拒否されたため、許可された権限で実行。
- A4構造: 変更前に採取したステージ / パレード × document / stage-only のSHA-256スナップショット4件が一致。画像としての見た目の比較は未実施。
- 30シーン＋拡大図のモック試験で、同時保持が1ページ分であること、Canvas寸法を毎ページ0へ戻すことを確認。実ブラウザのヒープ計測は未実施。
- GUI・実画像の容量・実フォントでのページ数・iPhoneでの可読性・LINE/iOS共有はClaude側で確認する。
- commit/push/install、ios、dist、保存形式、クラウド変換、SQL/RPC、iPadネイティブrosterアクションは変更していない。

GUI確認用fixture: `src/utils/formationExportFixture.ts`（24人・3シーン・12×8m）。
