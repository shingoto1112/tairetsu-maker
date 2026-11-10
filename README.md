# 隊列メーカー

ダンス・舞台・パレードの隊列表（フォーメーション表）を作る iPad アプリ／Web アプリです。メンバーの立ち位置と道具をシーンごとに置き、曲に合わせて確かめ、PDF・画像・名簿として書き出せます。

作業の決まりは [`AGENTS.md`](AGENTS.md)、仕様は [`docs/SPEC.md`](docs/SPEC.md) を先に読んでください。

## 構成

- 画面: React + TypeScript + Vite（`src/`）。Web 版は Vercel が `main` を自動で公開します。
- iPad 版: 同じ画面を Capacitor（WKWebView）で包み、保存・音源・共有シートは Swift（`ios/`）で行います。
- Windows 版: Tauri（`src-tauri/`）。
- クラウド保存・共同編集（任意）: Supabase（認証・データベース・Realtime・Edge Functions、`supabase/`）と Yjs。ログインしなくても端末だけで使えます。

## 起動・確認

```bash
npm install
npm run dev        # 開発サーバー
npm run typecheck  # 型チェック
npm test           # 全テスト（Vitest）
npm run build      # 本番ビルド（dist/ は生成物。Git には入れない）
```

Node 22 以上が必要です。

## 環境変数

`.env.example` を `.env` にコピーして設定します。何も設定しなければ、クラウドを使わない端末専用のアプリとして動きます。

| 変数 | 役割 |
| --- | --- |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Supabase の公開設定（anon または publishable キー。service_role は入れない） |
| `VITE_COLLABORATION_V2` | `1` のビルドだけクラウド保存・共同編集を有効にする |
| `VITE_COLLABORATION_INVITATION_URL` | 招待リンクの土台にする URL（省略時は公開サイト） |
| `VITE_PUBLIC_SITE_URL` | 利用規約・プライバシー・サポートのページを置く公開サイト（省略時は本番の URL） |

## データの保存

- 隊列表は端末の中に1件ずつ保存します（Web／Windows は IndexedDB、iPad は SQLite）。
- 音源ファイルは端末の中だけに保存し、クラウドへは送りません。
- 受け渡しは `.tairetsu`／ZIP の書き出し・読み込みで行います（音源を同梱できます）。
- 隊列表を URL に入れる共有リンクは作りません（昔のリンクを開いたときの読み込みだけ残しています）。
- 共同編集は招待リンクで参加します。仕組みは `docs/COLLABORATION_*.md` と `docs/COLLAB_V2_SERVER.md`。

## 書き出し

- 隊列表: A4 の PDF（既定は軽いベクター PDF）と画像。道具の割当欄を付けられます。
- 名簿: PDF・画像（A4／スマホ向け）・Excel（.xlsx）。
- 仕様は `docs/SPEC.md`、ベクター PDF の作りは `src/utils/vectorPdf/README.md`。

## 配布

- Web: `main` へ push すると Vercel が公開します。
- iPad: TestFlight へのアップロードは手動起動（GitHub Actions の `ios-testflight.yml`、または `codemagic.yaml`）。
- Windows: `npm run desktop:build`（Rust／Cargo、Microsoft C++ Build Tools、WebView2 Runtime が必要）。GitHub Actions の `windows-desktop.yml` でも作れます。手順は [`docs/WINDOWS_APP_RELEASE.md`](docs/WINDOWS_APP_RELEASE.md)。
