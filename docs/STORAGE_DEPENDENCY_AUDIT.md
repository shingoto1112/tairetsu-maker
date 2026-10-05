# 保存方式 第11回：依存関係の監査（2026-10-05）

`npm.cmd audit --json` を依存変更なしで実行。npm registry の応答は計12件（high 4 / moderate 7 / low 1 / critical 0）。件数は脆弱な依存パッケージ数であり、個別 advisory 数ではない。`package-lock.json` のバージョン・dev flag と `npm ls --all`、アプリの呼出しを照合した。依存追加・更新・install・audit fix は実行していない。

| 依存（固定された版） | 深刻度 | 経路・影響 | Claudeへの対応案 |
|---|---|---|---|
| dompurify 3.4.13 | low | jsPDF 4.2.1 の動的HTML用依存。配布される依存だが、アプリはPDFに画像を追加し、`pdf.html()`、`IN_PLACE`、nodeを外すafterSanitize hookを使わない。今回のXSS条件への到達経路は検索で見つからない | 3.4.16以上へ更新可能か確認。HTML出力を導入するときには再評価 |
| fflate 0.8.2 | moderate | jsPDFの実行時圧縮。脆弱性は不正ZIP64の `unzipSync` 無限ループ。アプリのZIP読込みはJSZip、jsPDFは `zlibSync` を利用。該当展開APIの呼出しなし | 0.8.3以上への更新を検討、PDF出力を回帰確認 |
| @vitest/mocker / vitest 4.1.10 | moderate ×2 | 開発・試験のみ。browser mock serverのredirect mockによる任意ファイル読取り。通常の `vitest run` はbrowser serverを公開しない | 4.1.11以上へ更新、試験サーバーを外部公開しない |
| @xmldom/xmldom 0.9.10 | high | @capacitor/cli → plist、開発のみ。XML注入・不正入力による時間/メモリ増大等、複数advisory | CLIの依存制約に適合する修正版（今回の影響範囲0.9.11以下を避ける）を確認し、iOS sync/buildを検証 |
| undici 7.29.0 | high | jsdom 29.1.1、開発試験のみ。WebSocket/圧縮/Retry/キャッシュDoS、BalancedPool TLS検証回避等 | 7.29.1以上への解決を検討。Node組込みfetchのバージョンとは別に扱う |
| brace-expansion 5.0.9 | high | eslint → minimatch、開発のみ。細工されたbraceパターンによるCPU/stack DoS | 5.0.12以上へ解決可能か確認 |
| browserslist 4.28.5 | high | @vitejs/plugin-react → Babel、開発のみ。不正custom statsによるprototype write/crash、query cacheメモリ増大 | 4.28.6以下を避けた修正版でビルドを確認 |
| baseline-browser-mapping 2.10.42 | moderate | 上記browserslist経由、開発のみ。不正入力でprocess終了 | 2.11.0以上を検討 |
| uuid 7.0.3 / xcode 3.0.1 / @capacitor/cli 8.5.0 | moderate ×3 | CLI → xcode → uuid、開発のみ。uuid v3/v5/v6のbuffer境界検証不足が親依存にも伝播 | uuid 11.1.1以上を使う上流の修正を確認。auditの自動案はCLI 8.4.3へのダウングレードなので、そのまま適用しない |

実行時の該当条件は [DOMPurify advisory](https://github.com/advisories/GHSA-p98j-92pf-mc4p) と [fflate advisory](https://github.com/advisories/GHSA-px8p-9vwx-vf98)、試験サーバーの条件は [Vitest advisory](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) を参照。上記の「到達経路なし」は現行コードの静的調査による判断で、全依存が安全であるという証明ではない。

優先案は開発環境のhigh依存とVitestの修正版を上流制約に合わせて解決し、次に実行時2依存を更新してPDFを確認すること。`--force`による一括変更や、全指摘を本番XSSとして扱う判断は避ける。Windows用CLI/iOS用CLIとWebのビルドを分けて検証する。最終的な依存変更はClaudeが判断する。

全応答は再実行時の `output/storage-performance/audit.json`（git対象外）に保存可能。registryのadvisoryは更新されるため、更新直前に再監査する。
