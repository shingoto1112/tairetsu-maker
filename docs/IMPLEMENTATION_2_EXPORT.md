# 実装②：名簿・道具割当表の書き出し

## 実装と変更ファイル

- `src/components/RosterManagementModal.tsx`: 道具割当表示のサマリーを非表示、切替表記を「道具割当」に統一。入力確定・IME検出と共通書き出しシートへの入口。
- `src/components/RosterAssignmentView.tsx`, `RosterAssignmentDetail.tsx`, `ObjectAssignmentEditor.tsx`, `src/styles.css`: 横向きのヘッダー圧縮、注記を詳細ペインへ移動、担当チップの色を丸いドットで統一。
- `src/components/DocumentExportSheet.tsx`: 対象・範囲・用途・形式、進捗・取消、完成後のプレビュー・共有・保存。完成物は共有成功・取消・失敗後も保持。複数画像は1枚ずつ保存。
- `src/utils/mobileExportTypes.ts`, `mobileExport.ts`, `mobileExportLayout.ts`, `assignmentExportSnapshot.ts`: 固定snapshot、実測改ページ、名簿の2列/1列切替、番号維持、続き見出し、全シーン改ページ、担当者の重複除去・同名区別。出力は幅1080px、最大高さ1920px、最終ページだけ内容高へ短縮。PDFは1px=0.375pt、追加余白なし。
- `src/utils/exportRaster.ts`, `pdfExport.ts`, `rosterExport.tsx`, `exportImage.ts`, `src/App.tsx`: A4のレイアウト・余白・pixelRatio=2を維持し、埋め込みをPNGへ変更。1ページにつきDOM描画1回。新規描画・PDFコードは動的importの先へ分離。既存JPEG URL関数は互換ラッパーとして維持。
- `src/utils/exportDelivery.ts`, `src/platform/files.ts`: 実File配列によるWeb Share判定、押下時に生成・importを挟まない共有、Capacitorの複数ファイル逐次保存と全経路のCache削除。既存1Blob関数は互換ラッパー。
- `src/utils/exportFileName.ts`: App内の既存sanitize・拡張子・日時処理を共通化。自動ファイル名にメンバー名は入れない。
- `scripts/benchmark-image-pdf-encoding.ts`, `scripts/benchmark-pdf-compression.mjs`: 同じCanvasによるPNG/JPEG比較診断、および合成図表の圧縮測定。未使用の診断コードとテストをsrcからscriptsへ移動。アプリの機能・バンドルからは参照しない。
- テスト追加: `DocumentExportSheet.test.tsx`, `mobileExportLayout.test.ts`, `mobileExport.test.ts`, `assignmentExportSnapshot.test.ts`, `pdfExport.test.ts`, `exportDelivery.test.ts`, `scripts/benchmark-image-pdf-encoding.test.ts`。
- テスト更新: `RosterManagementModal.test.tsx`, `ObjectAssignmentEditor.test.tsx`, `RosterPanels.test.tsx`, `AppRoster.test.tsx`, `rosterExport.test.tsx`, `src/platform/files.test.ts`。

編集前の未commit差分を保持。`ios/`, `dist/`, Project/ZIP/クラウド変換、SQL/RPC、AppのiPadネイティブroster actionは今回変更していない。commit/push/install、稼働中dev serverの操作は行っていない。

## PNG圧縮の判断

合成の不透明図表1480×2000pxを、同じA4寸法・余白・`compress:true`で3回ずつ測定した。時間は中央値。アプリの24人・3シーンfixtureとは別の測定。

| compression | PDF bytes | 時間 |
| --- | ---: | ---: |
| FAST | 108,418 | 342ms |
| MEDIUM | 74,332 | 361ms |
| SLOW | 30,197 | 429ms |

容量減に対する時間増が小さいためPNGには`SLOW`を明示。PNGは可逆圧縮で、JPEG品質低下を「劣化なし」とは扱っていない。

通常生成はPNGだけをエンコードする。ブラウザ診断関数は1回のDOM描画から同じCanvasのPNG/JPEG(q0.9)を各1回エンコードし、同条件のPDF bytes・時間・最小候補を返す。モックテストでこの比較条件を確認した。実fixtureのPNG/JPEG容量・生成時間が未測定のため、毎ページの二重エンコードは採用していない。

## Claude向けのGUI・実測手順

既存dev server `http://127.0.0.1:5179` を使用する。

1. 名簿画面の「書き出し ▾」を開く。メンバー管理→メンバー名簿、道具管理の名前の編集→道具名簿、道具割当表示→道具割当表が初期対象。
2. スマホ向け画像/PDFを生成し、ページ数・容量・プレビューを確認する。画像の自然幅1080px・高さ1920px以下、最後のページの短縮、名前の折り返し、続き見出し、担当者なし、全シーン改ページを確認する。
3. 名簿A4は「印刷向け（A4）」→「PDF」→「…のPDFを作成」。容量を完成画面で確認できる。関数直接測定は`createRosterExportSnapshot`→`generateRosterExport(snapshot, "pdf")`の戻り値`blob.size`。
4. 隊列表A4は既存「共有と書き出し」→「すべてのシーンを書き出す / PDF保存」→「PDFとして保存」。24人・3シーン・12×8mの同じfixture、道具割当の右側表示なしで、保存されたBlob/ファイルのbytesを測る。内部経路はAppの`generatePrintPdfBlob`→`elementToPngPage`→`imagePagesToPdfBlob`。
5. PNG/JPEG比較には、表示・サイズ計測できる既存の同じ`.print-page`要素で以下を呼ぶ。印刷用要素を独立マウントする場合は、PrintPreviewの親`.print-document`へ`is-exporting`を付けて、既存CSSと同じレイアウトを使用する。

```js
const { benchmarkImagePdfEncoding } = await import('/scripts/benchmark-image-pdf-encoding.ts');
const page = document.querySelector('.print-document.is-exporting .print-page');
const result = await benchmarkImagePdfEncoding(page, 'landscape');
// result: width, height, rasterMs, results[], smallest
```

この関数は1ページの診断。実際の3ページPDF容量は手順4で別に確認する。最小候補がJPEGの場合も、PNGと同品質とは解釈しない。

## 検証と未確認

- `npm test`: 40ファイル・260件成功。
- `npm run typecheck`: 成功。
- `npx vite build --outDir .tmp-implementation2-build`: 成功。メインJS486.98kB、gzip136.68kB。500kB警告・混在import警告なし。一時出力は確認後に削除。
- `git diff --check`: 成功。
- ローカルnpm testとViteはesbuildの親ディレクトリ参照がsandboxで拒否されたため、許可された権限で実行した。外部・本番操作なし。

GUI確認、iPad/iPhone実機・LINE共有、実fixtureのA4 PDF 0.6MB以下達成は未確認。Cache削除は全経路で試行するが、OS側の削除失敗は既存どおりbest effort。非常に長い見出しが1ページを占有して本文を収められない場合は、省略した完成品を出さずエラーで中止する。

対象追加は`mobileExport.ts`の`exportTargets`（snapshot作成・ページ計画・描画の組）とシートの対象選択へ追加する。隊列表スマホ版およびShareExportModalとの接続は実装③で追加済み。

## 実装③の修正との関係

隊列表スマホ版の拡大図は約64画像pxを目安に横最大3分割へ緩和し、12×8m・0.5m丸は左右2ページにする。ステージでは縦分割せずページ高さへ比例縮小、パレードでは従来の縦分割を維持。3シーンの予想は全体図2＋拡大図6＝8ページ。スマホ版の縦目盛りを絶対整数m基準に修正し、左右に桁数に応じたラベル用余白を確保する。名簿・割当表の改ページ規則、既存A4の構造・レイアウト・見た目、保存形式はこの修正で変更しない。新規則のGUI・容量・時間・実機可読性はClaudeの再確認が必要。

今回の検証は`npm test`44ファイル・282件、型検査、`git diff --check`が成功。A4構造4件の既存スナップショットも未更新で一致。一時出力のViteビルドはメインJS489.23kB（gzip137.57kB）、500kB警告なし。ビルド出力は確認後に削除。計測コードはアプリから未参照のままscriptsへ移し、通常生成・共有・バンドルには含めない。
