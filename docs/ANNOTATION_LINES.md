# 線を引く（build 25）

`FormationFrame.annotationLines` はシーン内のIDから線全体へのmap。欠落は空とし、前シーンを探索しない。座標は内部メートル、色はblack/red/blue/green、線種はsolid/dashedのみ。1シーン100本、全体5,000本、有限座標の絶対値100,000mまで。現在のステージ寸法では検証しないため、縮小して範囲外になった線も保持する。

新規シーンは表示している配置の元シーンからコピーする。シーンのコピー・貼り付けでも、新しいIDと独立した線の値を作る。読み込み、設定変更、同期、Undo/Redoでは再吸着しない。

入口はステージの既存操作群、パレードの左操作パネル。44px以上のボタン・端点タッチ領域を確保し、ステージの通常時に上部の行を追加しない。線は2.5px、破線は8px／間隔6px。通常モードのSVGはpointer-events:none。書き出しは元の両端で描いて範囲だけをクリップし、選択・端点を含めない。A4のレイアウト計算には線を渡さない。

共同編集schemaVersionは2のまま、scene mapにannotationLinesを明示追加する。1本の全属性を1つのJSON値として更新する。削除イベントはtombstonesの`["annotationLines", JSON.stringify([sceneId,lineId]), eventId]`。古い移動が届いても削除イベントのある線は表示しない。Undoは自分の削除イベントだけを取り消す。

旧v2文書の初回追加は、シーンの不変なYjs Item IDから決定的なコンテナ挿入を作る。同時初回追加が別々のコンテナを作って線を失うことを防ぐ。通常の32bit client IDと分離した安全な整数IDを使い、既存IDとの衝突は拒否する。コンテナはUndo対象から外し、他端末の線を消さない。線の値は通常の端末IDで編集する。

**build 24は新しいmapを持つ共有文書を開けない。全参加者の更新が必要。** 新しいmapを作ったあと全線をUndo/削除してもコンテナは残る。

配備順序は、利用者の確認後にClaudeがcollab-ingestおよび同じ検証器を利用するEdge関数を再配備し、その後Web/iPad build 25を配布する。旧Edgeは新項目を拒否するため、クライアントだけを先に公開しない。SQL変更は不要。既存の権限検証は変更しない。本作業では配備しない。

Swiftは変更しない。TSのnative bridge契約fixtureで線JSONの保持を確認するが、実機Swift/SQLiteでの往復は別途確認が必要。

## 実装ファイル

- 保存・型・座標: `src/types.ts`, `src/project/annotationLines.ts`, `src/project/codec.ts`, `src/project/normalizeProject.ts`, `src/utils/annotationLines.ts`, `src/utils/tairetsuFile.ts`, `src/App.tsx`。
- 編集・出力・説明: `src/components/AnnotationLines.tsx`, `src/components/useAnnotationEditor.tsx`, `src/components/StageCanvas.tsx`, `src/components/ParadeCanvas.tsx`, `src/components/CompactStageControls.tsx`, `src/components/PrintPreview.tsx`, `src/components/PrintStagePreview.tsx`, `src/components/SceneThumbnailPreview.tsx`, `src/components/helpContent.ts`, `src/styles.css`。パレード小窓はカード寸法を変えず、表示範囲に全長を使う。
- 共同編集: `src/collaboration/annotationMap.ts`, `projectSchema.ts`, `serverSchema2.ts`, `projectModel.ts`, `projection.ts`, `recipeCommands.ts`, `model.ts`, `commands.ts`（同ディレクトリ）。
- 試験: `src/project/annotationLines.test.ts`, `src/collaboration/annotationLines.test.ts`, `src/components/AnnotationEditor.test.tsx`, `AnnotationExport.test.tsx`, `SceneThumbnailPreview.test.tsx`（後二つもcomponents内）, `src/repositories/nativeSqliteRepository.test.ts`, `src/repositories/contract/fixtures/annotationLines.json`, `src/collaboration/testing/lifecycleHarness.ts`, `scripts/testing/load-collab-edge.mjs`, `scripts/test-annotation-lines-browser.mjs`, `scripts/test-annotation-collaboration-browser.mjs`, `scripts/test-annotation-regressions.mjs`。

## ローカル確認結果

保存の正常・不正・欠落・本数境界、音源あり／なしZIP、吸着、キャンセル、コピーの独立性、Undo/Redo、旧文書での同時初回追加、削除対移動、再接続、実際のbuild 24検証器による拒否を確認。Edgeは1シーン100本と全体5,000本の境界、長いIDの削除も確認。A4は線あり／なしで全レイアウト寸法が一致し、分割出力は元端点を維持してクリップする。iPad縦横・スマホの画像と実際のPNGを目視確認。

`npm test`は1回実行し1,167成功／3タイムアウト。該当3ファイルを単独ワーカーで再確認し39件成功。最終変更の関連単体試験、typecheck、Vite build、diff check、check-collab-v2、collaboration UI／shared-session／lifecycle、test-build22-browserも成功。ブラウザー試験は負荷を重ねると既存の慣性スクロール判定が失敗したが、単独再実行で全条件成功。

146人の移動p95は線なし50.0ms／100本あり50.1ms、100本ありパレードのパン16.7ms。メインJS `index-CRE_9l-c.js` は388,221 bytes、gzip 120,381 bytes。一時ビルド先は削除した。Denoはこの環境にないため、Deno Edge試験はLinux CIで確認。実機Swift/SQLiteと実機iPad Safariは未確認。配備・SQL変更・commit/pushは行っていない。
