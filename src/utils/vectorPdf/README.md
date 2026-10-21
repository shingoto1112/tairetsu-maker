# A4 ベクター PDF（段階③：パレード対応）

通常のA4 PDFは `a4PdfExport.ts` → `createA4VectorPdf` → `buildA4Document` → `renderScenePages` を使用する。保存形式・PNG・名簿・カメラは既存経路のまま。完成画面は既存の先頭ページ画像と合計サイズ表示を維持する。

## パレード A4（build31）

- `getPrintOrientation` を絵文字の紙面解像度計算・jsPDF作成・追加ページ・配置に明示して渡す。パレードはA4縦、ステージは従来の横。長いシーンはシーン単位で縮小し、途中では分割しない。upのみ対応。
- `getFramePrintVerticalRange` をそのまま使う。回転前の道具矩形、注釈を含めない範囲、0基準の上下端丸め、全長基準の格子原点を維持する。注釈は元端点を上端だけ移動し、クリップで破線の位相を保つ。メンバー・道具への一括ステージクリップは追加しない。
- 距離目盛りの距離・内部Y・分類だけを `printLayout.getParadePrintRulerLabels` に抽出した。順序・丸め・fallbackは従来どおり。編集画面のrulerPositionには依存せず、A4のincludeMeterRulersに従う。minorは600/7pt/#64748b、mediumは700/8pt/#334155、majorは800/9pt/#0f172a。線の強調とは独立。計測前にRegularとBoldを準備し、両方を使用文字で切り詰める。
- パレードだけ `fillStrokes` で線・枠を同じ幅の塗りパスへ変換する。PDFビューアーが極細のstrokeを1画素へ太らせる現象を避けるため。破線は元端点からの位相を保持する。`clipPage` は画像PDFと同じページ境界だけのクリップ。ステージ側は両方OFFで、既存の描画を維持する。
- `a4Document` のメンバー描画ノード検索はIDのMapを使用する。
- `paradeA4Limits.ts` は保存値を変更しない。500mを超える旧データも安全な切り出し量なら出力する。不正・非有限値、絶対値1000万以上の距離／座標等、0.01m未満の格子間隔、500シーン超を拒否する。描画上限は1シーン10万・文書全体300万、文字量は1シーン10万・文書全体100万。格子の推計を間引き上限で頭打ちにせず、破線・格子／目盛り・メンバー／注釈・道具・割当の原因と対象シーン名を表示する。文書全体の超過は対象シーンを分けるよう案内する。300万は146人×100シーン／300人×60シーンの推計の12倍以上、300人×500シーンも通すための余裕を持つ運用上限（ブラウザーのメモリ保証ではない）。安全性の拒否を文書全体の画像PDFへ戻さない。未対応の形状・文脈依存文字等は従来の文書全体fallbackを維持する。
- パレードの先頭JPEGプレビューは最長2048px・200万画素、画像fallbackは1ページ4096px・800万画素・合計6400万画素。寸法制限はラスター描画先だけに適用し、DOMレイアウトは変えない。短辺が1px未満になる極端な比率は説明して中止する。ステージのプレビュー・fallbackは従来の解像度と再利用方法を維持する。

検証：`node scripts/verify-vector-pdf-parade.mjs --pc --port=5396` と `--port=5398`。指定2画面・21fixture/27ページずつ。DOM対pdfjsの既存0.3%・絵文字5%閾値を使う。通常144dpi、100mを1ページに縮小した極小文字のシーンは双方288dpi（閾値不変）。HEADのPrintPreviewとのHTML一致は可変clip IDだけを正規化する。

多数シーンの回帰：`node scripts/verify-vector-pdf-parade-large.mjs --port=5395`。実際のShareExportModalで全シーン・道具割当・PDFを選び、146人／道具6／幅12m／全長150m／60シーンを両画面条件で公開生成する。全ページの向き・シーン名・末尾メンバー名とfallback不使用を検査し、PDF・先頭／末尾PNG・UIスクリーンショット・容量／時間を `output/build31/vector-pdf-parade/drawing-budget-regression/` に保存する。

`scripts/verify-vector-pdf-parade-runtime.mjs` は4fixtureを各々新しいブラウザーコンテキストで計測し、初回／2回目、公開生成経路、プレビュー寸法、取消、全体fallback、ステージ→パレード→ステージを検証する。`scripts/verify-vector-pdf-parade-stage.mjs` は既存23fixtureをHEADのモデル／rendererと比較し、描画モデル・抽出文字の位置／幅、作成日時・ランダムID以外のPDF全バイトの完全一致と既存画像比較を要求する。`--audit-saved` は保存済みの全新旧PDFを同じ基準で検査する。内容が同じPDFのpdfjs描画でも3〜4画素・最大RGB差8の微小差が出る場合があるため、画素完全一致とPDF内容一致は分けて記録する。閾値は変更しない。出力は `output/build31/vector-pdf-parade/`。外部通信を遮断し、5395〜5399だけを使用する。実機Safari／WKWebView・LINEは未確認。

## 端末の字体（①、2026-10-21）

- `renderScenePages` の `fontMode: "device"`（隊列表・名簿の既定。「フォントを入れて作る」で `"subset"`）。`deviceFont.ts` が文字の分類・区間分け・TJ の配置、`deviceFontPdf.ts` が pdf-lib でのフォント辞書・ToUnicode の追加と検証、`deviceGlyphs.generated.ts` が文字の表（`node scripts/generate-device-font-table.mjs --check` で再生成ずれを検出）。
- 端末の字体にするのは BIZ で描ける文字のうち表にある文字だけ。画像になる文字・名簿の配置計測は従来と同じ。英数字は埋め込みのまま（PC の Chrome・Android で等幅の代替字形になり間延びするため）。
- 失敗時は device → subset → original の順に新しい jsPDF で作り直す。取消は作り直さない。

## PDF用フォントの事前サブセット（build31）

- `trueType.ts` は元TTFのWindows Unicode BMP cmap format 4を読み、ベクター／画像runを先に確定する。jsPDFで元TTFを二重解析しない。確定したベクター文字だけを文書全体・ウェイト別に収集する。切り詰めたcmapで画像化を決め直さない。
- `hbSubsetBrowser.ts` は書き出し時だけ動的importされ、Viteが追跡する `harfbuzz-subset.wasm?url` を同一オリジンから読み込む。初回の初期化だけを共有し、失敗したロードは再試行可能。MIMEによるinstantiateStreaming失敗時はArrayBufferで初期化する。キャッシュ済み元バッファをtransferしない。
- `hbSubset.ts` にsubset-font 2.9.0のTrueType用呼び出し手順を移植した。subset-fontは **BSD-3-Clause**（MITではない）、harfbuzzjs 1.6.3はMIT。配布用の全文を `public/licenses/` に置く。追加npm依存はない。
- NO_HINTING・NO_LAYOUT_CLOSUREを指定し、GSUB/GPOS/vhea/vmtx/gasp/DSIGとレイアウト機能を除く。.notdef・複合グリフはHarfBuzzに保持させ、GIDは詰め直す。nameテーブルの著作権・OFLライセンス情報も保持する。`public/fonts/` はDOM計測にも使うので変更しない。
- 登録前にformat 4・要求文字すべての存在・advance・基本メトリクス・loca／複合グリフ参照を検査する。addFont・描画・シリアライズ・ToUnicode検証までの失敗は **新しいjsPDFと元TTF** で再生成する。既存の文書全体画像fallbackは、未対応レイアウト等や元フォントでも生成できない場合の境界として残る。取消では再生成しない。
- 同期WASMの前後でイベントループへ制御を戻してAbortSignalを確認する。WASM実行中そのものは中断できない。現在はmain threadで実行する。
- `fontSubset.test.ts` が実WASM・両ウェイト・cmap／字幅／抽出・版ずれ・障害注入・取消を契約として検査する。`renderScenePages` の `fontMode: "original"` は新旧比較用。`metrics` は文字数、入力／埋込フォント容量、時間、試行経路を返す。
- `scripts/verify-vector-pdf-font-subset.mjs --pc` と引数なしで、1440×900 DPR1／1180×820 DPR2の既存23fixtureを検査する。計測条件のDOMは維持し、参照撮影だけ144dpiへ合わせる（DPR1スクリーンショットの拡大を避ける）。既存0.3%／絵文字5%の閾値を変えず、元TTF版との抽出文字・位置・幅は完全一致を要求する。ヒント除去による微小なラスタ差には同じ画像比較器を使う。

Safari／WKWebView・LINEのプレビューは実機未確認。CSPを追加する際は対象エンジンでwasm-unsafe-evalの必要性を検査する（現行CSPなし、unsafe-evalは追加しない）。

## A4本実装

- `../printLayout.ts` がPrintPreviewとベクター版の改ページ・レイアウト定数・寸法・表示判定を共通提供する。シーンごとの寸法差も、全対象シーンで計算した共通倍率を使う。
- `a4Document.ts` は共通改ページでページを構成する。DOM計測はCSSが決めるページ外寸、シーンの積み重ね、タイトル・割当欄の折り返しに限定する。ステージ・メンバー・回転道具の座標はデータから計算する。
- `assignmentModel.ts` と `browserDocumentLayout.ts` は割当欄の列・折り返し・道具・担当メンバー・背景格子・輪郭・文字をベクターで描く。ぼかし影だけ192dpiの小さい透過PNGをサイズごとに共有する。割当道具は回転0。
- A4で使う700/800/900はBold、パレード目盛りの600はRegularに対応する。描画モデルから必要ウェイトを選び、TTFバイト列だけをreader単位でセッション内キャッシュする。各jsPDFのフォント解析・サブセットは独立。ブラウザーFontFaceも同じバイト列を使う。
- 独立描画できる欠字はグラフェム単位の透過PNGで代替し、通常文字は連続runのまま描く。文脈依存文字・未対応・異常では文書全体を従来画像PDFに戻す。`vectorPdfDiagnostics()` は直近5件の理由をセッション内だけで返す。取消はAbortErrorとして終了し、フォールバックしない。
- 道具のrectangle/circle/curtain/line/customを扱う。`model.ts` の `printObjectShape` は線・カスタムを印刷CSS既定の四角へ変換し、未知の形だけを拒否する。`objectRenderShape` を通すため、旧 `shape: curtain` と現行 `type: curtain, shape: rectangle` の両方で縞が付く。
- `curtainStripes` は白28%・8px幅／16px周期を `CSS_PX_MM` でmmへ換算する。CSS既定のpadding-box左端（外形の左端＋枠幅）から白で始め、枠の内側へクリップし、名前より先に重ねる。ステージと割当欄で共有し、ステージの回転・最終A4倍率は親変換で1回だけ適用。道具の塗り・枠・角丸を維持する（現行幕の角丸は0）。
- 現在の未対応は未知の道具形状、メモ・時間・非表示メンバーを含めるオプション、`#RRGGBB`以外の道具／メンバー色。アラビア文字など文脈依存文字、制御文字、独立描画できない結合列は従来方式へ戻る。これらを黙って省略しない。

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
