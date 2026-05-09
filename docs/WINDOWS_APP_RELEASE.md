# Windowsダウンロード版リリース手順

隊列メーカーのWindowsダウンロード版は、既存のReact/ViteアプリをTauriで包んで作成します。Web版の実装を活かしたまま、まずは `.exe` 形式のインストーラーを作る方針です。

## 方針

- Web版の機能を壊さず、同じ `src/` をWindows版でも使います。
- Windows版の土台は `src-tauri/` に置きます。
- まずは未署名のローカルビルドで動作確認します。
- 配布初期はGitHub Releasesでテスト配布し、必要に応じてMicrosoft Store公開を検討します。

## 追加したコマンド

```powershell
npm run desktop:dev
npm run desktop:build
```

- `desktop:dev`: Tauriの開発用ウィンドウで起動します。
- `desktop:build`: Windows向けインストーラーを作成します。

## 初回だけ必要なもの

WindowsでTauriをビルドするには、以下が必要です。

1. Rust / Cargo
2. Microsoft C++ Build Tools
3. WebView2 Runtime

このPCでは、現時点で `rustc` / `cargo` が見つかっていません。まずRust環境の導入が必要です。

## ビルドの流れ

```powershell
npm install
npm run build
npm run desktop:build
```

成功すると、Tauriの出力先にWindowsインストーラーが生成されます。

代表的な出力先:

```text
src-tauri/target/release/bundle/
```

## GitHubでWindows版を作る方法

ローカルPCにRustやMicrosoft C++ Build Toolsを入れずに、GitHub Actions上でWindowsインストーラーを作るワークフローも用意しています。

対象ファイル:

```text
.github/workflows/windows-desktop.yml
```

使い方:

1. GitHubのリポジトリを開く
2. `Actions` タブを開く
3. `Build Windows Desktop App` を選ぶ
4. `Run workflow` を押す
5. 完了後、`Artifacts` から `tairetsu-maker-windows` をダウンロードする

タグ `desktop-v1.0.0` のような `desktop-v*` 形式をpushした場合も、自動でWindows版ビルドが走ります。

## 配布時の注意

未署名の `.exe` をWebから配ると、Windows SmartScreenの警告が出る可能性があります。これはアプリの危険性ではなく、署名や配布実績が少ないアプリに出る一般的な警告です。

警告を減らしたい場合は、将来的に以下を検討します。

- コード署名証明書を使う
- Microsoft Storeで配布する

## 今後の改善候補

- アプリ専用アイコンを `src-tauri/icons/` に反映する
- Windows版のファイル保存・画像保存をネイティブAPIへ寄せる
- オフライン起動時の動作確認を増やす
- GitHub Releases用のリリース手順を整備する
