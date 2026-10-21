# A4 ベクター PDF（段階②、1.1.1 向け）

通常のA4 PDFは `a4PdfExport.ts` → `createA4VectorPdf` → `buildA4Document` → `renderScenePages` を使用する。保存形式・PNG・名簿・カメラは既存経路のまま。完成画面は既存の先頭ページ画像と合計サイズ表示を維持する。

## A4本実装

- `../printLayout.ts` がPrintPreviewとベクター版の改ページ・レイアウト定数・寸法・表示判定を共通提供する。シーンごとの寸法差も、全対象シーンで計算した共通倍率を使う。
- `a4Document.ts` は共通改ページでページを構成する。DOM計測はCSSが決めるページ外寸、シーンの積み重ね、タイトル・割当欄の折り返しに限定する。ステージ・メンバー・回転道具の座標はデータから計算する。
- `assignmentModel.ts` と `browserDocumentLayout.ts` は割当欄の列・折り返し・道具・担当メンバー・背景格子・輪郭・文字をベクターで描く。ぼかし影だけ192dpiの小さい透過PNGをサイズごとに共有する。割当道具は回転0。
- A4で使う700/800/900はBoldに対応する。描画モデルから必要ウェイトを選び、TTFバイト列だけをreader単位でセッション内キャッシュする。各jsPDFのフォント解析・サブセットは独立。ブラウザーFontFaceも同じバイト列を使う。
- 独立描画できる欠字はグラフェム単位の透過PNGで代替し、通常文字は連続runのまま描く。文脈依存文字・未対応・異常では文書全体を従来画像PDFに戻す。`vectorPdfDiagnostics()` は直近5件の理由をセッション内だけで返す。取消はAbortErrorとして終了し、フォールバックしない。
- 道具のrectangle/circle/curtain/line/customを扱う。`model.ts` の `printObjectShape` は線・カスタムを印刷CSS既定の四角へ変換し、未知の形だけを拒否する。`objectRenderShape` を通すため、旧 `shape: curtain` と現行 `type: curtain, shape: rectangle` の両方で縞が付く。
- `curtainStripes` は白28%・8px幅／16px周期を `CSS_PX_MM` でmmへ換算する。CSS既定のpadding-box左端（外形の左端＋枠幅）から白で始め、枠の内側へクリップし、名前より先に重ねる。ステージと割当欄で共有し、ステージの回転・最終A4倍率は親変換で1回だけ適用。道具の塗り・枠・角丸を維持する（現行幕の角丸は0）。
- 現在の未対応はパレード、未知の道具形状、メモ・時間・非表示メンバーを含めるオプション、`#RRGGBB`以外の道具／メンバー色。アラビア文字など文脈依存文字、制御文字、独立描画できない結合列は従来方式へ戻る。これらを黙って省略しない。

## グラフェムの画像代替

- `textRuns.ts` は実cmapと文字種からベクターrun／画像グラフェムを選ぶ。ZWJ・肌色・VS16・IVS・結合文字・補助漢字を分断しない。Intl.Segmenterがない場合、結合列の配置は文書全体の画像PDFへ戻す。通常BMP文字は従来の配置を維持する。
- ハングルは完成形音節（AC00〜D7A3）・互換字母（3130〜318F）だけ独立描画を許可する。結合用字母（1100〜11FF、A960〜A97F、D7B0〜D7FF）は文書全体を画像PDFへ戻す。
- `browserMixedText.ts` は元のRangeのadvanceとゼロ寸法のinline baselineプローブを分離する。通常メンバーに追加計測を行わず、混在行だけ遅延計測する。flexの匿名テキスト項目と行末空白も保持し、元のTextノードをfinallyで復元する。道具名は未回転の独立DOMで計測する。
- `graphemeImages.ts` は端末フォントを使うCanvas透過PNG。measureTextは字形のはみ出し・余白だけに使い、DOMの幅で中央揃えする。最終紙面384dpi相当（解像度を切り上げて共有）、辺1024px・合計400万画素・256種類が上限。空画像・既知の欠字表示との一致・PNG作成失敗で全体フォールバックする。システムフォントの欠字検出は完全ではない。
- 文書単位のaliasは`vector-grapheme-N`。キーは文字列・フォント・太さ・サイズ・色・解像度で、既存の`assignment-shadow-*`とは別。画像は既存の親groupとclip内に置き、addImageのrotationを使わない。
- `renderer.ts` は実際のベクターrunだけをサブセット・ToUnicode・描画後検証の対象にする。紙面の文字検査にメタデータの題名を含めない。画像のみのページも扱う。
- 道具名のクリップはステージ・割当欄ともCSSのoverflow:hiddenに合わせて枠線の内側とし、画像文字が枠線へ重なるのを防ぐ。
- `node scripts/verify-vector-pdf-emoji.mjs` は5398番と外部通信を遮断したChromiumを使う（`--port=5399`等で変更可、5393は禁止）。両視点の混在名（ハングルも含む）と18シーン・146人・道具18の架空fixtureから新旧PDF・画像文字欠落の負例PDF・DOM参照・全ページ差分を`output/build31/vector-pdf-emoji/`へ生成する。同一DOM・DPRで撮影した画像だけを紙面寸法へ縮小し、CSS zoomやDPR変更による再配置を避ける。全体の0.3%閾値は変更しない。追加の局所判定はグラフェムごと5%未満（同じ2px/色32のAA許容）。小さい画像文字の欠落をページの背景で希釈させない。
- iPadのWKWebView・SafariでのApple Color Emoji画像化は未確認。実機で確認する。

## 検証

### 割当欄の重なり修正（build31）

`createA4VectorPdf` は画像PDFと同じ `withExportClone` 内で計測・描画する。
編集画面の `#root { zoom: 0.8 }` のDOMRectと、未縮小のステージmm・文字サイズ・影を
混ぜると、右列がステージへ侵入し、改行間隔と影の寸法も崩れるため。
`buildA4Document` を直接使う検証側も、ズームを継承しない印刷DOMを渡すこと。
文字の横位置は丸の中心、縦ベースラインは同じ複製DOMの行レイアウトを使う。
PrintPreviewの短い名前は行の幅制限を解除し、可読下限で丸を超える文字を左右均等に置く。
4文字・2行のラベルも切り抜かない。通常サイズの画像ハッシュは旧CSSと一致する。

```powershell
node scripts/verify-vector-pdf-assignment-fix.mjs
node scripts/inspect-vector-pdf-assignment-layout.mjs
node scripts/verify-print-label-centering.mjs
```

5397/5398番のローカルサーバーと外部通信を遮断したChromiumを使用する。
19×18m・146人・道具18・18シーン（1シーンのみ2人割当）、10×20m、30×12mの両視点、
既存の段階②・幕・絵文字fixtureを比較する。画像比較の0.3%閾値は維持する。
参照は計測時のDPR/CSS zoomを変えずに撮影し、scrollWidth/scrollHeightでA4へfitする。
実PDFの変換行列を解析し、全44ページでステージと右列の外枠（線幅込み）が重ならないことも検査する。
旧CSSとの画像比較は通常サイズ・可読下限、ステージ・パレード、旧フォント・BIZで実施し、
許可した短い名前の文字範囲以外に画素差がないことを確認する。
成果物は `output/build31/vector-pdf-assignment-fix/`。

```powershell
node scripts/verify-vector-pdf-stage2.mjs
node scripts/verify-vector-pdf-stage2.mjs --curtains --no-ui
npx.cmd --no-install vitest run src/utils/vectorPdf scripts/vector-pdf-visual-diff.test.mjs --maxWorkers 2
```

5396番のローカルViteと隔離Chromiumを使用し、外部オリジンへの通信を遮断する。`output/build31/vector-pdf-stage2/` に新旧PDF、同じBIZフォントのDOM参照、pdfjs-dist 6.4.299による144dpi描画、領域別差分・計測JSON・iPad縦横の操作画面を保存する。pdfjs-distは開発用スクリプトだけで使い、製品コードへimportしない。比較は座標・改行とPDF抽出文字列の完全一致、2pxまでのAA差の比較を併用する。3px移動・文字の欠落・色違いを不合格にする検出器テストもある。

以下は段階①の開発用APIと再現手順。通常の書き出しは上記の本実装を使う。

`--curtains` は既存fixtureを維持して幕0/90/137度・線・カスタムと割当欄を含む追加fixtureを使い、同じ比較基準で `output/build31/vector-pdf-stage2/curtain-addendum/` へ生成する。追加の全シーン／1シーンPDFもここに置く。`shape-fallback.pdf` の旧「幕で戻る」例は未知形状が2ページ目にある文書全体フォールバックの例に再生成する。既存の比較JSON・PDF・UI検証結果は保持する。

## 開発用の入口

`createVectorPdfPrototype` にプロジェクト、シーン ID 1つ、印刷オプション、既存の文書全体の画像 PDF を返す `fallback(signal)` を渡す。戻り値の `mode` は `vector` / `image`。後者は `reason` を持つ。中断は AbortError を投げ、画像生成に進まない。

ブラウザーでは Regular / Bold の FontFace を読み込んでから、`measurePropText` を渡す。正確な A4 の収まりを維持するには、既存 PrintPreview の `.print-page` に `measurePrintPageExtent` を適用した `pageExtent` も渡す。これは CSS のページ外寸だけの計測で、図形の回転後の外接矩形から座標を復元する処理ではない。外寸省略時はモデルの論理寸法になり、CSS のスクロール領域や端数丸めによる倍率差が残り得る。

Node のテストでは `readFontBytes(fileName, signal)` へ `readFile` の薄いアダプターを渡す。製品コードは Node の fs に依存しない。

```powershell
# アプリを起動せず、架空データだけでローカル生成（外部リクエストは遮断）。
node scripts/generate-vector-pdf-prototype.mjs

# npm run build 済みの dist 内フォントを使う、同梱確認用の生成。
node scripts/generate-vector-pdf-prototype.mjs --dist-fonts

# インストール済み Python の pypdf / Pillow と Poppler による検査・画像化。
python scripts/inspect-vector-pdf-prototype.py --poppler /path/to/pdftoppm
```

出力先は `output/build31/vector-pdf-prototype/`。生成スクリプトは 5397 番だけを使用し、終了時に自身のサーバー・ブラウザーを閉じる。

## 実装の境界

- `model.ts`: PrintPreview の寸法・表示判定・名前サイズと stageExportView の視点・目盛り・道具名の向きを再利用。図形は mm、グループ回転は画面上の時計回り。
- `browserTextLayout.ts`: 道具名の CSS 折り返し、完全に隠れる文字の除外、ページ外寸のみを計測。円形道具のクリップも考慮。
- `fonts.ts`: バージョン付き同一オリジンの TTF を書き出し時に取得し、実 cmap を検査。700 以上を Bold に対応させる。
- `renderer.ts`: jsPDF の実 TrueType サブセットで生成。半透明の塗りと不透明な線を分け、図形ごとに GState を保存・復元。文字揃えは jsPDF 4.2.1 の advanced mode の幅計算を避けて直接計算。生成後もフォントストリーム・Unicode 対応を検査する。
- `index.ts`: 未対応レイアウト・欠字・生成異常を文書全体の画像方式へ戻す。

段階①の `createVectorPdfPrototype` は複数シーンの改ページ、割当欄、パレード、メモ・時間付き・固定シーン数レイアウト、非表示メンバーを含める出力、未知の道具形状、`#RRGGBB` 以外の道具／メンバー色に未対応。描画対象の補助漢字・絵文字・結合文字・異体字セレクタ・制御文字も画像方式になる。幕・線・カスタムの描画モデルは段階①②で共通。通常A4の改ページ・割当欄は上記の段階②で対応済み。

文字はモデルへ入れる前に可視部分だけにする（`visibleTextLines` はモデル内の既に選別済みの文字を集める関数）。ステージ全体を一律にクリップしない。注釈だけを元の端点のままクリップし、破線位相を変えない。道具本体の回転と名前の補正回転を別グループに持つ。

フォントのバイト列を変更したら `FONT_VERSION` も変更する。提供済み TTF と OFL.txt は変更していない。Vite の public コピーにより dist に同梱され、Capacitor の `webDir: "dist"` から同一オリジンで読める。iOS 実機の確認は別途必要。
