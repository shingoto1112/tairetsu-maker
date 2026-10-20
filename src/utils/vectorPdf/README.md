# A4 ベクター PDF（段階②、1.1.1 向け）

通常のA4 PDFは `a4PdfExport.ts` → `createA4VectorPdf` → `buildA4Document` → `renderScenePages` を使用する。保存形式・PNG・名簿・カメラは既存経路のまま。完成画面は既存の先頭ページ画像と合計サイズ表示を維持する。

## A4本実装

- `../printLayout.ts` がPrintPreviewとベクター版の改ページ・レイアウト定数・寸法・表示判定を共通提供する。シーンごとの寸法差も、全対象シーンで計算した共通倍率を使う。
- `a4Document.ts` は共通改ページでページを構成する。DOM計測はCSSが決めるページ外寸、シーンの積み重ね、タイトル・割当欄の折り返しに限定する。ステージ・メンバー・回転道具の座標はデータから計算する。
- `assignmentModel.ts` と `browserDocumentLayout.ts` は割当欄の列・折り返し・道具・担当メンバー・背景格子・輪郭・文字をベクターで描く。ぼかし影だけ192dpiの小さい透過PNGをサイズごとに共有する。割当道具は回転0。
- A4で使う700/800/900はBoldに対応する。描画モデルから必要ウェイトを選び、TTFバイト列だけをreader単位でセッション内キャッシュする。各jsPDFのフォント解析・サブセットは独立。ブラウザーFontFaceも同じバイト列を使う。
- 未対応・欠字・異常では文書全体を従来画像PDFに戻す。`vectorPdfDiagnostics()` は直近5件の理由をセッション内だけで返す。取消はAbortErrorとして終了し、フォールバックしない。
- 道具のrectangle/circle/curtain/line/customを扱う。`model.ts` の `printObjectShape` は線・カスタムを印刷CSS既定の四角へ変換し、未知の形だけを拒否する。`objectRenderShape` を通すため、旧 `shape: curtain` と現行 `type: curtain, shape: rectangle` の両方で縞が付く。
- `curtainStripes` は白28%・8px幅／16px周期を `CSS_PX_MM` でmmへ換算する。CSS既定のpadding-box左端（外形の左端＋枠幅）から白で始め、枠の内側へクリップし、名前より先に重ねる。ステージと割当欄で共有し、ステージの回転・最終A4倍率は親変換で1回だけ適用。道具の塗り・枠・角丸を維持する（現行幕の角丸は0）。
- 現在の未対応はパレード、未知の道具形状、メモ・時間・非表示メンバーを含めるオプション、`#RRGGBB`以外の道具／メンバー色。補助漢字・絵文字・結合文字・IVS等も従来方式へ戻る。これらを黙って省略しない。

## 検証

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
