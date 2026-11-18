# 線の濃さ設定と配布順

ステージに6項目、paradeSettingsに横3項目と縦数字1項目の独立 boolean を追加。新項目の欠落は false で補完し、false を既定値で上書きしない。パレードの縦5m/10mは既存 emphasizeEvery5m / emphasizeEvery10m を使い、値・既定 true を維持する。ZIPの形式、内部座標、吸着、SQL、Swiftは変更しない。

編集画面の「ステージ」→「詳しい設定」に配置。作成画面の説明図は従来どおり数字の線を濃くする。

共通判定は位置→番号／距離→none / number / 5 / 10。有効な10、5、数字の順で判定するので、10 OFF・5 ONの10の位置は5になる。横②の5番は左右4.5m、10番は9.5m。センターは番号なし。全シーン幅で計算してから反転・切り出す。縦ステージは最前0m（frontDirection topでは上端、それ以外は下端）、パレードは internalYToParadeDistance の既存基準で、負の距離・0mも既存の5m/10m判定を維持する。

通常／数字／5／10の色は #e2e8f0 / #94a3b8 / #64748b / #475569、幅は1 / 1 / 1.25 / 1.5px。HTMLとSVGは src/utils/gridEmphasis.ts のトークンを共用する。全部OFFでも数字位置の線は通常線として描く。外枠・中央線を別描画し、同位置の横線を重ねない。

グリッドOFF（編集のstage.showGrid／出力のincludeGrid=false）では通常線を隠し、有効な強調線を残す。既存パレードの距離強調線がincludeGridに依存せず残る動作を基準とし、両モード・両方向へ統一した。パレード編集は既存どおりグリッドを常時表示する。強調のチェックを全てOFFにすると強調線も消える。

## 共同編集

schemaVersionは2を維持。各項目は独立atom、serverSchema2のboolean一覧とprojectSchemaの設定一覧に明示追加し、任意の未知設定は受け入れない。planRecipeは新項目の欠落とfalseを意味的に同じ扱いにし、正規化だけでOFFの新atomを一斉送信しない。利用者が変えた項目だけを書き込む。projectionでも正規化済みローカル本体の欠落atomをfalseとして解釈し、保存照合を成立させる。baseのtrueは欠落atomへ引き継がずfalseにするため、遠隔のOFF／削除を上書きしない。既存trueをfalseへ変える操作は明示falseを送信する。

旧検証の固定fixtureは scripts/testing/fixtures/preEmphasis{ProjectSchema,ServerSchema2}.ts。d7c9933の検証そのものを保存し、新設定入り文書をINVALID_UPDATEで拒否することを src/collaboration/gridEmphasis.test.ts で再現。新版では参加・受信・Undo/Redo・圧縮・復元で値が残る。旧JSON fixtureは欠落試験用に残し、emphasisProjects.jsonを追加した。

## 配布順（配備はこの作業では実施しない）

1. Claudeが利用者の確認後、共通検証を取り込んだEdgeのcollab-ingest・collab-maintenance・collab-restoreを再配備する。いずれも共通検証／設定スキーマに依存する。
2. Edge更新を確認してから、Web公開とTestFlight build 24を同時に配布する。
3. build 23は更新が必要。新設定入り共同編集文書を旧クライアント／旧検証へ戻さない。
4. Edgeを旧版に戻さない。既に新設定atomが文書や履歴に残るため、旧検証へ戻すと受付・圧縮・復元が拒否される。

SQL変更は不要。Swiftは未知JSONフィールドを保持する既存の設計を利用し変更しない。WindowsではネイティブSwift契約試験を実行できないため、iOS環境で新fixtureを含む保存往復の確認を配布前に行う。

ステージの縦目盛りは編集・印刷とも最前0mに統一し、小数の奥行きでも整数距離の数字位置に線を合わせる。既存書き出しの上端0m表示の食い違いを解消した。

## 最終確認結果

- npm test -- --maxWorkers 2: 2回とも113ファイル・1,033件成功。
- typecheck、git diff --check成功。
- Vite: VITE_COLLABORATION_V2未設定／1の両方で成功。一時出力を削除しdistは変更なし。メインJSは両方376,938バイト、gzipは未設定116,609／V2 116,610バイト。
- check-collab-v2、horizontal-counting、horizontal-grid、horizontal-grid-operations、horizontal-grid-collaboration、build22、app-storage、collaboration-ui、shared-session-app、collaboration-lifecycleの各ブラウザー試験成功。
- 4画面寸法×ステージ／パレード×横①②×8通りの設定＝128組み合わせをブラウザー確認。設定・使い方・出力画像を目視確認。ZIP往復、IndexedDB再読み込み、共同編集受信、Undo/Redoも確認。PNG／PDF書き出し4組成功。
- スクリーンショットと試験ログ: 作業時の一時フォルダ（今は残っていない、`shots-emphasis/`）
- 未確認: Deno未導入のためDeno実行によるEdge試験、iOS実機／Swift契約試験、実紙の白黒印刷。Edge関連のVitestと旧検証の拒否試験は成功。配備・本番アクセスは実施していない。

## 変更ファイル

- `docs/GRID_EMPHASIS.md`
- `docs/SPEC.md`
- `scripts/test-grid-emphasis-browser.mjs`
- `scripts/test-horizontal-grid-collaboration-browser.mjs`
- `scripts/testing/fixtures/preEmphasisProjectSchema.ts`
- `scripts/testing/fixtures/preEmphasisServerSchema2.ts`
- `scripts/verify-emphasis-build.mjs`
- `scripts/verify-emphasis-regressions.mjs`
- `src/App.tsx`
- `src/collaboration/gridEmphasis.test.ts`
- `src/collaboration/projectModel.ts`
- `src/collaboration/projectSchema.ts`
- `src/collaboration/projection.ts`
- `src/collaboration/recipeCommands.ts`
- `src/collaboration/serverSchema2.ts`
- `src/components/EmphasizedGrid.tsx`
- `src/components/FormationMobilePage.test.tsx`
- `src/components/GridEmphasisExports.test.tsx`
- `src/components/GridEmphasisSettings.tsx`
- `src/components/ParadeCanvas.tsx`
- `src/components/PrintPreview.tsx`
- `src/components/PrintStagePreview.tsx`
- `src/components/StageCanvas.tsx`
- `src/components/StageSettingsPanel.tsx`
- `src/components/__snapshots__/PrintPreview.test.tsx.snap`
- `src/components/helpContent.ts`
- `src/project/codec.test.ts`
- `src/project/codec.ts`
- `src/project/defaults.ts`
- `src/project/normalizeProject.ts`
- `src/repositories/contract/README.md`
- `src/repositories/contract/fixtures/emphasisProjects.json`
- `src/storage/maintenance.test.ts`
- `src/styles.css`
- `src/types.ts`
- `src/utils/gridEmphasis.test.ts`
- `src/utils/gridEmphasis.ts`
