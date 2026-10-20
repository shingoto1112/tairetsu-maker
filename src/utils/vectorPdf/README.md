# A4 ベクター PDF 試作（段階①、1.1.1 向け）

通常の UI はこのモジュールを import しない。保存形式・PNG・名簿・カメラは既存経路のまま。

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

未対応は複数シーンの改ページ、割当欄、パレード、幕等の装飾、メモ・時間付き・固定シーン数レイアウト、非表示メンバーを含める出力、`#RRGGBB` 以外の道具／メンバー色。描画対象の補助漢字・絵文字・結合文字・異体字セレクタ・制御文字も画像方式になる。`renderScenePages` は測定のための独立シーン反復用で、実際の全シーン改ページ API ではない。

文字はモデルへ入れる前に可視部分だけにする（`visibleTextLines` はモデル内の既に選別済みの文字を集める関数）。ステージ全体を一律にクリップしない。注釈だけを元の端点のままクリップし、破線位相を変えない。道具本体の回転と名前の補正回転を別グループに持つ。

フォントのバイト列を変更したら `FONT_VERSION` も変更する。提供済み TTF と OFL.txt は変更していない。Vite の public コピーにより dist に同梱され、Capacitor の `webDir: "dist"` から同一オリジンで読める。iOS 実機の確認は別途必要。
