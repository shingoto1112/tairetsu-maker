# QAレポート

## 使用したテストデータ

- 実在のチームから借りた見本ZIP（名前は伏せる）
- リポジトリ内の `test-data/` には見本ZIPは存在しませんでした。

## 実行した確認

### ドキュメント確認

- `AGENTS.md` を確認しました。
- `docs/SPEC.md` を確認しました。
- `docs/DEVELOPMENT_FLOW.md` は存在しませんでした。
- `docs/CHECKLIST.md` は存在しませんでした。

### ZIP解析

実行コマンド:

```powershell
node scripts\analyze-project-zip.mjs <見本ZIPのパス>
```

結果:

- 成功
- `manifest.json` と `project.json` を確認
- 音源 `audio/audio.wav` を確認
- 51人、30道具、16シーンのデータを確認
- シーン配列順と時刻順の逆転を1件検出

検出内容:

- 前: シーン15 / 187秒
- 後: シーン16 / 102秒

### ローカル配信確認

`http://localhost:5173/` はHTTP 200で応答しました。

### UI読み込み確認

in-app browserの自動操作を試しましたが、ブラウザ制御の初期化がタイムアウトしました。
そのため、ファイル選択UIからのZIP読み込み完了までは自動確認できていません。

代替確認として、ZIP構造と読み込み実装 `src/utils/tairetsuFile.ts` の設計を確認しました。
現在の実装は、`.zip` / `.tairetsu` の拡張子やMIME typeだけに依存せず、ZIP内部の `manifest.json` / `project.json` を基準に読み込む方針です。

## 実行したコマンド

実行コマンド:

- `npm install`
  - 結果: 成功
  - 備考: 2件のmoderate脆弱性が報告されました。今回は破壊的更新を避けるため `npm audit fix --force` は実行していません。
- `npm run build`
  - 結果: 成功
  - 備考: Viteから、minify後のJSチャンクが500kBを超えているという警告が出ました。動作停止ではありませんが、将来的なコード分割候補です。

以下は `package.json` にスクリプトが存在しません。

- `npm run typecheck`
- `npm run lint`
- `npm test`

## 成功/失敗結果

| 確認 | 結果 |
|---|---|
| AGENTS.md確認 | 成功 |
| docs/SPEC.md確認 | 成功 |
| docs/DEVELOPMENT_FLOW.md確認 | 未作成 |
| docs/CHECKLIST.md確認 | 未作成 |
| ZIP解析 | 成功 |
| manifest.json確認 | 成功 |
| project.json確認 | 成功 |
| 音源ファイル確認 | 成功 |
| ローカルHTTP応答 | 成功 |
| UIでのファイル選択読み込み | 自動確認不可 |
| npm install | 成功 |
| npm run build | 成功 |
| npm run typecheck | スクリプト未定義 |
| npm run lint | スクリプト未定義 |
| npm test | スクリプト未定義 |

## 残課題

- 見本ZIPをブラウザUIから手動で読み込み、復元結果を目視確認する。
- シーン16 のようなシーン順/時刻順の逆転をUIで扱いやすくする。
- 大量メンバー・道具の一括作成導線を検討する。
- 印刷・スクリーンショットを見本ZIPで手動確認する。
- `typecheck` / `lint` / `test` スクリプトの追加を検討する。
- JSチャンクが500kBを超えているため、将来的にコード分割を検討する。
- `npm audit` で報告されたmoderate脆弱性の内容を確認し、互換性を崩さない範囲で更新する。
