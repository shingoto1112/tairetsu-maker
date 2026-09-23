# App Storeプライバシー・サポート設定

最終更新: 2026-09-24

## 公開URL

- プライバシーポリシー: `https://tairetsu-maker.vercel.app/privacy.html`
- 利用規約: `https://tairetsu-maker.vercel.app/terms.html`
- サポート: `https://tairetsu-maker.vercel.app/support.html`
- Privacy Choices（任意）: `https://tairetsu-maker.vercel.app/privacy.html#data-controls`

上記3ページはViteの `public/` に含まれ、VercelとiPadアプリbundleへ同梱される。
アプリ内では、隊列一覧のフッターと編集画面の三本線メニューから開ける。

## App Store Connectの入力手順

App PrivacyのURL、4データタイプ、追跡なし回答は2026-08-14に公開済み。

### App Privacy

1. App Store Connectで「マイApp」から「隊列メーカー」を開く。
2. 左メニューの「Appのプライバシー」を開く。
3. Privacy Policy URLへ上記のプライバシーポリシーURLを入力する。
4. 任意のUser Privacy Choices URLには `#data-controls` 付きURLを入力する。
5. 「このAppからデータを収集しますか」は「はい」を選ぶ。
6. 下表の4種類を登録し、回答を公開する。

| App Storeのデータタイプ | 目的 | ユーザーにリンク | トラッキング |
| --- | --- | --- | --- |
| 連絡先情報 > 名前 | Appの機能 | はい | いいえ |
| 連絡先情報 > メールアドレス | Appの機能 | はい | いいえ |
| ID > ユーザーID | Appの機能 | はい | いいえ |
| ユーザーコンテンツ > その他のユーザーコンテンツ | Appの機能 | はい | いいえ |

この回答は `ios/App/App/PrivacyInfo.xcprivacy` の
`NSPrivacyCollectedDataTypes` と一致させる。音源ファイルは端末内で処理し、サーバーへ
収集しないため「オーディオデータ」には含めない。広告、第三者分析、追跡は「いいえ」。

今後、クラッシュ収集、分析、音源クラウド保存、問い合わせフォーム等を追加した場合は、
App Store回答、Privacy Manifest、公開ポリシーを同時に更新する。

### Support URL

1. App Store ConnectでiOS Appのバージョン情報を開く。
2. Support URLへ `https://tairetsu-maker.vercel.app/support.html` を入力する。
3. サポートページの窓口はユーザー承認の tairetsu.maker@gmail.com へ差し替え、2026-09-24に公開済み。実際の受信は本人が確認する。

## 一般公開前にユーザーが決めること

- 公開してよい運営者名または屋号
- 専用サポートメールの受信確認（アドレスは決定・公開済み）
- 利用規約を法務確認するかどうか
- 有料提供時の価格、返金、特定商取引法表示の要否

現在のサポートページはメール窓口を案内しており、GitHubアカウントは不要。
ページとテストだけのcommit 4c2a34fを公開し、iPad向け再審査修正はWeb本体へ反映していない。

## Supabase Authメール

一般公開前にSupabase DashboardのAuthentication設定でcustom SMTPを設定する。
送信元ドメインのSPF / DKIMを認証し、確認メール、再設定メール、メール変更通知を実機で
確認する。Supabaseの標準送信元は開発・テスト用途に留める。
