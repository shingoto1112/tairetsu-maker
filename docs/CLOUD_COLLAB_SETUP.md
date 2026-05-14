# クラウド共同編集セットアップ手順

この手順は、Supabase Free と Vercel のWeb版でロック式共同編集を有効にするためのメモです。

## 1. Supabase プロジェクト

Supabase で新しいプロジェクトを作成し、Project URL と anon public key または publishable key を控えます。
service_role key はフロントエンド、Vercel、`.env` に置かないでください。

初回操作の目安:

1. Supabase にログインする。GitHubログインで問題ありません。
2. GitHubリポジトリ選択が出た場合、DB作成だけならスキップして構いません。選択必須の場合は `Only select repositories` にして、このアプリのリポジトリだけを選びます。
3. `New project` を押す。
4. Project name は `tairetsu-maker` など分かる名前にする。
5. Database password は自動生成で構いません。これは共有せず、自分用に保管します。
6. Region は選べる範囲で日本に近いものを選びます。
7. Free plan のまま作成します。
8. プロジェクト作成完了後、Project Settings -> API から `Project URL` と `anon public key` または `publishable key` を取得します。

## 2. SQL migration

Supabase の SQL Editor で、以下の順に migration SQL を実行します。

1. `supabase/migrations/20260514000000_cloud_collaboration_foundation.sql`
2. `supabase/migrations/20260514001000_cloud_collaboration_sharing_realtime.sql`
3. `supabase/migrations/20260514002000_cloud_project_owner_operations.sql`

2つ目の migration では、招待テーブル/RPC と Realtime 用 publication 追加を行います。
Hosted Supabase では `supabase_realtime` publication が存在するため、`edit_locks` と `audit_logs` の変更通知が使えるようになります。
3つ目の migration では、owner専用のシーン構成保存とクラウド上書きimport用RPCを追加します。

初心者向けに、必要なSQLをまとめてコピーするコマンドも用意しています。

```powershell
npm run --silent cloud:sql | clip.exe
```

このあと Supabase の SQL Editor に貼り付けて `Run` すれば、上の migration を順番通りに適用できます。

## 3. Auth 設定

Supabase Auth の Email provider を有効にします。
確認メールを使う設定の場合、新規登録後にメール確認してからログインしてください。

共同編集への参加は、owner が作成した招待リンクを、招待されたメールアドレスでログインしたユーザーが受け取る方式です。

## 4. ローカル `.env`

ローカル確認では、`.env` に以下を設定します。

```text
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-or-publishable-key
```

設定後、開発サーバーを再起動します。

```powershell
npm run dev
```

接続先とSQL適用状態を確認します。

```powershell
npm run cloud:check
```

このチェックはログインせずに実行します。`projects` テーブルへ接続でき、共同編集用RPCが `not_authenticated` を返せば、URL/anon key とSQL migrationの土台は通っています。

## 5. Vercel 環境変数

Vercel の Project Settings -> Environment Variables に以下を設定します。

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Production / Preview / Development の必要な環境に設定し、再デプロイします。

CLIで設定する場合:

```powershell
npx vercel env add VITE_SUPABASE_URL production
npx vercel env add VITE_SUPABASE_ANON_KEY production
npx vercel env add VITE_SUPABASE_URL preview
npx vercel env add VITE_SUPABASE_ANON_KEY preview
```

`.env` に設定済みの値をまとめて反映する補助コマンドも使えます。

```powershell
npm run cloud:vercel-env
```

標準では Production に設定します。Preview / Development も含めたい場合は以下のようにします。

```powershell
$env:CLOUD_VERCEL_ENVIRONMENTS='production,preview,development'
npm run cloud:vercel-env
```

設定後に確認します。

```powershell
npx vercel env ls
npx vercel build --prod
```

Web版へ反映する場合は、GitHubへpushしてVercelの自動デプロイを待つか、確認済みビルドを明示的にデプロイします。

```powershell
npx vercel deploy --prebuilt --prod
```

## 6. 最低限の動作確認

1. owner 用アカウントでログインする。
2. ローカル隊列表をクラウドへアップロードする。
3. クラウド隊列表を開き、「共有管理」から editor/viewer を招待する。
4. 別ブラウザまたは別プロファイルで、招待されたメールアドレスでログインし、招待リンクを受け取る。
5. editor が「このシーンを編集」でロック取得できることを確認する。
6. 同じシーンを別ユーザーが編集しようとすると拒否されることを確認する。
7. 別シーンなら同時にロック取得できることを確認する。
8. 保存後、他ユーザー側に「更新があります。再読み込み」ボタンが出ることを確認する。
9. viewer が編集できないことを確認する。
10. 編集終了またはTTL後にロックを再取得できることを確認する。

owner はクラウドプロジェクトを開いた状態で「クラウド上書き」から `.json` / `.zip` / `.tairetsu` を選択できます。実行前に確認ダイアログが出て、上書き前の状態はクラウド履歴へ退避されます。

## 7. CLIスモークテスト

Supabase Authで owner/editor の2アカウントを作成・確認済みにしたあと、ブラウザ操作前にRPCの主要経路だけを確認できます。

```powershell
$env:CLOUD_OWNER_EMAIL='owner@example.com'
$env:CLOUD_OWNER_PASSWORD='owner-password'
$env:CLOUD_EDITOR_EMAIL='editor@example.com'
$env:CLOUD_EDITOR_PASSWORD='editor-password'
npm run cloud:smoke
```

`.env` の `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` は自動で読み込みます。

このテストは、検証用クラウドプロジェクトを1件作成し、owner/editor 招待、同一シーンロック拒否、別シーン同時ロック、scene保存、ロック解除を確認します。
現在は owner 専用の project 系操作も確認し、`project:members` / `project:objects` / `project:audio` の保存、`project:sceneOrder` によるシーン追加/削除、`project:import` によるクラウド上書き、project lock と scene lock の排他も検証します。

viewer も自動確認する場合は、追加で以下を設定します。

```powershell
$env:CLOUD_VIEWER_EMAIL='viewer@example.com'
$env:CLOUD_VIEWER_PASSWORD='viewer-password'
npm run cloud:smoke
```

viewer 情報がある場合は、viewer が scene lock を取得できないことも確認します。
