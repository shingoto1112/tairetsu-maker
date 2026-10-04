# 共同編集 第7回 — 共有開始・招待・参加・終了 API

第11回-1（11a）は [旧クラウド停止と救出契約](LEGACY_CLOUD_SHUTDOWN.md)を追加。
共通削除RPCは停止せず、NULL確認・不存在/匿名拒否・空search_path・EXECUTE限定を修正する。
旧文書の削除/共同ownerへの移譲とV2 Auth cascadeを保つ。旧方式の操作を全面停止し、
期限付きexportは現在ownerの実在恒久アカウントだけに限定する。11bの画面は未変更。
V2 OFF時の「端末だけ（ローカル専用）」と明示取り込み台帳は11bで接続する。

第10回-transportのユーザー決定（2026-10-05）：ドラッグ中の位置とプレゼンスは派生private topicへの直接Broadcastとする。解除/退出/文書削除/参加世代変更のcommitで、サーバーは旧確定通知topicへ内容なしの `acl_changed` を送る。残るクライアントは同期的に一時送信と表示を止め、最新資格・topicへ移る。外されたクライアントは送受信を停止し一時表示を消す。通知が届かなければ既存30秒poll・前面復帰で回復する。

直接Broadcastの認可は接続/JWT更新時にキャッシュされる。解除commit後、残るメンバーが新topicへ移るまで旧接続の外された人にpreview（開始座標、対象ID、累積差分、シーン/選択）が届く可能性をユーザーが受け入れた。数秒〜で、休止/通知欠落等もあるため厳密な30秒保証はない。悪意の残留socketの強制停止をクライアントの協力に依存して保証しない。topic回転は旧topicへの新規参加/発行認可を拒否する。確定した編集は従来どおりサーバー側で現在資格と世代を厳密に検査する。

previewはProject/履歴/Repository/ZIPへ保存しない。高頻度情報のDB配信は採用しないが、低頻度の内容なしACL通知と確定通知はtransactional `realtime.send` を使う。実socketを残した露出時間・旧topic再join・再参加世代・messages実測は [本番確認手順](COLLABORATION_PRESENCE.md) に従う。

2026-10-04、基準 HEAD `9359499`。UI・本番適用・配備は行っていない。
第6回の [全 Project 写像](COLLABORATION_PROJECT.md)、[保存](COLLABORATION_STORAGE.md)、
[provider](COLLABORATION_PROVIDER.md)、[iPad 保存](COLLABORATION_NATIVE_STORAGE.md)を継承する。
設計 consult12 の「5人」は後のユーザー決定 **8 distinct user** で置き換える。

## 流れと API

全 API は `await loadCollaboration()` の後に使う。メインの静的 import に追加しない。
CloudConfig は引数で注入し、ここから環境変数・シークレットを読まない。

```ts
const runtime = await loadCollaboration();
const auth = runtime.createParticipantAuth(config, platform); // web または ipad
const transport = runtime.createSupabaseTransport(config, auth.credential);
const management = runtime.createManagementTransport(config);
const api = new runtime.CollaborationLifecycle(repository, management, transport, {
  platform, auth, invitationBaseUrl: "https://正式なWebのホスト/",
  allowedOrigins: ["https://正式なWebのホスト"],
});
```

1. 呼出元は通常 editor を flush・閉じて `startSharing(localId, displayName)`。
   既存端末レコードへ schema 2 の初期 CRDT を CAS 保存してから Edge create。
   固定 bytes の再送は同じサーバー文書を返す。`bindSharedDocument` で共有 ID と
   accountId/membershipGeneration を原子的に確定する。返却 record を開き直す。
   旧本人クラウドの sync がある文書は併用拒否。既に共有済みの文書は再作成しない。
2. `createInvite(documentId)` → `{inviteId, expiresAt, link}`。
   256bit token、fragment `#invite=...`、24時間、1回消費。DB は SHA-256 hash のみ。
   `revokeInvite(documentId, inviteId)` は誰でも実行可能。
3. Web は `takeInvitationLink(allowedOrigins)` で fragment をメモリに取り出し、
   browser history の現在 URL から消す。返却 URL/token をログ・永続保存・analytics に渡さない。
   未認証の入口では文書内容・メンバー・文書名を取得しない。
4. `prepareJoin(link, displayName, signal?, captchaToken?)`。
   ログイン済みは現在の本人で参加。Web 未ログインは表示名で匿名 signup → 参加。
   iPad 未ログインは `IPAD_ACCOUNT_REQUIRED`。iPad ゲストは実装しない。
   初期 snapshot と全後続ページを受け取り、連続 seq・schema・Yjs 依存を検証する。
5. 返った **固定 CommitRequest を保持**して `saveJoinedProject(request)`。
   保存失敗・応答消失は同じ ID/bytes/operationId を再送する。新しい要求に作り直さない。
   起動をまたいで要求を失った場合も、同じ active membership なら招待結果を再取得できる。
   再取得は新規参加ではなく既存資格の receipt replay。解除後や新しい参加世代では不可。
6. 参加者には `shared-文書UUID-端末UUID` の新しいローカルレコードを作る。
   作成者の CRDT metadata.projectId・内部 entity ID・bytes は一切変更しない。
   投影と recipe compiler は共有文書 ID を明示した場合だけこの端末 alias を受理する。
   直接 `projectSharedDocument` / `commands.applyRecipe` を使う呼出元も第3引数を渡す。
   ローカル音源 ID、表示状態を他人から製造しない。曲 descriptor 接続は第8回。
7. 返った record から coordinator/editor/provider を起動。
   更新は既存の固定 journal/outbox → 端末 COMMIT → provider の順を維持する。

`members` は userId・表示名・isGuest・isCreator を返す。メールは返さない。
ゲスト判定・作成者・権限の正本は DB。編集可能な user_metadata の表示名で認可しない。

## 権限表

| 操作 | 未認証 anon | 匿名ゲストのメンバー | 通常メンバー | 作成者 | 外された人 |
| --- | --- | --- | --- | --- | --- |
| 内容取得・変更 | 不可 | 可 | 可 | 可 | 不可 |
| 招待作成・失効、他人を外す | 不可 | 可 | 可 | 可 | 不可 |
| 作成者を外す | 不可 | 不可 | 不可 | 不可 | 不可 |
| 自分の退出 | 不可 | 可 | 可 | 不可 | 不可 |
| 新文書作成 | 不可 | 不可 | 可（恒久アカウント） | 可 | 可（恒久アカウント） |
| 共有文書削除 | 不可 | 不可 | 不可 | 可 | 不可 |
| 招待参加 | 認証が先 | 有効招待で可 | 有効招待で可 | 既存資格 | 新しい有効招待が必要 |
| 自分の状態確認 | 不可 | 可 | 可 | 可 | 自分の終了理由だけ |

同じ user の別端末は人数を消費しない。別ブラウザーで新規匿名 signup は別 user。
残り1枠への同時参加は文書行ロックで直列化し、8人まで・9人目は MEMBER_LIMIT。

## 端末側の状態と救出

`api.state(localId)` は active / removed / ended / unavailable / membership-changed /
auth-required。network エラーは終了扱いにせず typed error のまま。
provider の `sharing` も active / removed / ended / membership-changed / auth-required。

```text
独立文書 → 初期 CRDT の端末保存 → Edge 作成 → ID・binding 保存 → active
招待 → 認証 → メンバー加入 → 初期状態検証 → 固定端末保存 → active
active → 解除・退出 → removed（両 lane と購読を停止）
active → 作成者の文書削除／アカウント削除 → ended（両 lane と購読を停止）
active → 認証なし・別本人 → auth-required（コピー保持）
旧 attachment → 同じ本人の再参加 → membership-changed（旧 outbox は保留）
```

`ended` の文言は「共有が終了しました。この端末のコピーは残っています」。
サーバーは解除後の新しい内容を旧 topic に送らない。topic 変更の再購読と失効発見は
既存30秒 poll／foreground wake で行うため、画面の終了表示には遅延があり得る。
通信断・OS 停止中は端末へ即座に終了を知らせる保証はない。

解除・終了でも Project、CRDT、journal、pending/sent outbox を削除しない。
`prepareIndependentCopy(localId, liveProjection?)` は未送信変更を含む新 ID・独立 Project の
固定保存要求を返す。呼出元は editor の pending を stage し、現在投影を渡し、要求を保存する。
元の attachment は救出元として残す。再参加は新 attachment・空 outbox で、旧 binding を書き換えない。
自動採用・自動世代切替・checkpoint 復元は実装しない（履歴の第9回）。

`deleteSharedDocument(documentId)` はクラウドだけを終了する。
`removeLocalCopy(localId, expectedRepositoryRevision, operationId)` は端末だけを削除する。
第8回では後者の直前に保存・救出の確認を行い、両操作のボタンと説明を区別する。
`createCollaborationAccountApi(config).deleteAccountWithPassword(password, "DELETE_MY_ACCOUNT")`
は既存認証で直前にパスワード再確認し、既存 delete_current_account を呼ぶ。
返却の旧 deleted/transferred count は旧文書だけの数。新共有文書の数と混同しない。
新方式の作成者文書は所有者移譲せず Auth CASCADE で削除。端末 Repository は削除しない。
ゲストの本人確認手段はセッションだけなので、パスワードによるアカウント削除 API は恒久アカウント用。

## 認証と iPad 導線

Web ゲストは既存 `save/readCloudAuthSession` と refreshSession を利用。
sessionStorage だけでは browser 再起動後に戻れないため、**ゲストだけ**を localStorage の
`tairetsu.collaboration.guestSession.v1` に保存し、既存 session へ再hydrate。
refresh に guest marker・表示名を引継ぎ、並行呼出の signup/refresh を1回にまとめる。
恒久アカウントへ切替えたら古い guest mirror は除去する（本人へのリンク・合併ではない）。
signOut は participantAuth の入口を使い、guest mirror も消す。
ブラウザー消去・ログアウト・別端末では同じゲスト ID に復帰できず、新招待が必要。
`ParticipantAuthState` の sessionPersistence/guestRecovery を第8回の説明に使用する。
匿名 Auth ユーザーは自動削除されない。参加中の guest を年齢だけで掃除しない。

iPad は既存メール＋パスワード、Keychain hydration・refresh を継続。
アプリ内の「招待リンクを貼り付けて参加」は `prepareJoin` と同じ経路。
Universal Links、Associated Domains、Info.plist、Swift は追加・変更しない。
Web で開いた場合は `invitationEntry` の案内を出し、リンクをコピーしてアプリへ貼り付けてもらう。
画面・ボタン・案内の描画は第8回。今回は導線の API と状態だけ。

## 未適用 foundation SQL の変更

既存 `20261004000000_collab_v2_foundation.sql` を改訂。新しい migration ファイルは不要。
旧11 migration・旧関数・ACL の変更はない。再適用は既存データと資格を保持する。

- list_members / access_status の RPC を追加。外部 user は文書の存在・内容を判定できない。
- private join_attempts：user ごと **20回/10分**。失敗も加算し、同時試行を直列化。
  INVALID_INVITE / INVALID_ARGUMENT / MEMBER_LIMIT / INVITE_ATTEMPT_LIMIT は JSON error を返して
  counter を commit。クライアントは typed error、制限は429相当で10分待ち。
- 招待に used_membership を追加。同一 active membership の参加応答再取得だけを許す。
- private departures：文書 ID・user ID・removed/ended のみ。文書内容なし。
  Auth 作成者削除前の文書 trigger で他メンバーの終了理由を残す。直接 SELECT 不可・RLS 有効。
  user 削除時には FK で本人の記録も消える。doc ID の FK は意図的に持たない。
- Auth BEFORE DELETE trigger で未使用招待を先に失効。
  SET NULL とメンバー CASCADE の順序に依存する旧 trigger の弱点を解消。
- ACL/topic は既存 trigger で insert/delete ごとに更新。旧 topic へ本文を送らない。
  provider membership 確認を access_status RPC に変更し、物理削除後も終了理由を取得。

attempts/終了記録の自動 GC は今回なし。招待・文書・ログの既存上限を保ち、
Auth と private table を含む実 DB 容量を監視する。20回制限は複数匿名 ID を横断しないため
CAPTCHA/Auth の IP 制限の代わりにはならない。

## 本番適用時に利用者が行うこと

本番操作は今回ゼロ。以下は Claude の Linux 確認後、UI と公開前の対策が揃ってから行う。

1. 使用する Supabase プロジェクトを確認し、現在の DB と設定をバックアップする。
2. **11aの旧API停止手順を完了する**。匿名guestもauthenticatedロールなので、
   [実DBの棚卸し・backup・停止migration・旧通信確認](LEGACY_CLOUD_SHUTDOWN.md)を公開前に行う。
   V2 foundation→停止migrationの順を推奨する。RealtimeのAllow public access OFFもこの段階で行う。
   旧src/cloudと画面の切替は11b。未保存編集を持つ旧利用者はいない前提で停止時間を設ける。
3. [サーバー手順](COLLAB_V2_SERVER.md)に従い、改訂 foundation 全体を1 transaction で適用。
   private schema は Data API の公開対象に加えない。エラーなら途中から再実行しない。
4. 同手順で collab-ingest と依存ファイルを配備する。service key を端末・Git・URL に置かない。
5. Edge の COLLAB_ALLOWED_ORIGINS に正式 Web の正確な origin と、使用する iPad WebView の
   `capacitor://localhost` 等の実 origin を登録する。末尾 `/`・ワイルドカードは使わない。
   本番 smoke で実 iPad の Origin を確認し、確認なしに広く許可しない。origin 無しの native 要求は許可。
   client の invitationBaseUrl/allowedOrigins も正式 Web に合わせる。
6. Authentication で Anonymous Sign-Ins を有効にする（上記2の完了後）。
7. Email provider の **Confirm email をオフ**にする。
   既存 signUpWithPassword は確認ありだと session=null を返す。メール送信サービスなしで
   iPad の新規登録→即ログインを成立させるには確認オフが必要。
   メール本人確認はできず、メールによるパスワード復旧も提供できない。既存の確認待ちアカウントは
   別途管理画面で確認し、オフにするだけで過去 user が確認済みになるとは仮定しない。
8. 公開ゲスト募集前に CAPTCHA 対応を終える。Turnstile の無料プランを候補とし、
   guest API は captchaToken 対応済み。**CAPTCHA を今すぐオンにしない**：旧メール認証入口は
   captchaToken 未対応で、iPad の登録・ログインも失敗し得る。第8回以降で既存入口の対応を確認してから設定。
   CAPTCHA なしの段階は限定テスト用途のみ。無料枠・MAU・Auth IP 制限・DB 容量・Realtime 使用量を確認する。
9. Realtime の public access を無効にし、private channel と topic ローテーションを確認。
10. 実 Supabase で未認証拒否、作成・ゲスト参加・解除・再参加・アカウント削除、
    iPad 新規登録・貼付け参加・復帰、guest browser 再起動を smoke test する。

公式根拠：[匿名認証](https://supabase.com/docs/guides/auth/auth-anonymous)、
[メール認証](https://supabase.com/docs/guides/auth/passwords)、
[CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha)、
[Realtime 認可](https://supabase.com/docs/guides/realtime/authorization)、
[Turnstile 無料プラン](https://www.cloudflare.com/products/turnstile/)。
無料枠内で運用する方針は維持するが、利用量の上限内を自動保証するものではない。

## 第8回と Claude の確認事項

- UI：開始前の flush/閉じる、招待の明示消費、fragment の早期除去、表示名、ゲスト制約、
  貼付け参加、固定保存要求の再試行、終了/救出、provider 生命周期・foreground wake を接続。
- account deletion の確認に「所有する共有文書も削除、他端末コピーは残る」を明記する。
- 独立コピー/再参加の旧 outbox を自動採用しない。編集を拾うには明示的 import を新 session に行う。
- CAPTCHA/旧 API 匿名拒否が済むまで public guest 招待を公開しない。Web のリリース案内は今回は不要。
- Linux：既存 workflow の Postgres17 実ロール、attempt counter commit/race、招待 receipt replay、
  Auth FK/trigger、終了理由、再適用、foundation単体の旧関数/ACL非干渉、
  11a停止による期待権限変更・救出snapshot・共通削除、Deno checkをClaudeが確認。
- macOS：Swift と共通 fixture は変更なし。新 alias レコードの native commit/再読込、
  Keychain の登録・参加・再起動・削除、実 iPad origin/foreground を確認する。
- 実 Supabase の JWT/Realtime 認可 cache・Edge 制限・RLS はモックでは保証しない。
  文書世代の checkpoint/圧縮/明示復元と自動 GC は第9回以降。

## Windows の検証記録

- 最終コードの `npm test -- --maxWorkers 2` を2回：各83ファイル・712件成功。
- `npm run typecheck`、`git diff --check`、`check-collab-v2.mjs`、`check-native-repository.mjs` 成功。
- Vite CLI build を workspace の専用一時フォルダへ出力し、そのフォルダだけ削除。
- `check-collaboration-bundle.mjs` 成功。通常 main=459376 bytes / gzip=135675 bytes。
  通常起動の静的 graph に共同編集/Yjs なし。dynamic probe runtime=23103 bytes / gzip=7925 bytes。
  全 production chunk に testing harness なし。build/probe 一時フォルダを削除。
- `test-collaboration-provider-browser.mjs`：既存9シナリオ、2専用 DB 削除・mock 停止。
- `test-collaboration-app-browser.mjs`：実 App の5シナリオ（読込・編集・CAS・Undo・再読込）。
- `npm run test:repository:browser`：契約50手順、移行30ケース、共有 CAS・原子性・破損/復旧・
  2ページ競合・200/1000件計測、52専用 DB の試験成功。
- `test-app-storage-browser.mjs`：既存保存・ZIP・音源・GC・復旧の a〜l 成功。
- 新しい `test-collaboration-lifecycle-browser.mjs` を最終コードで2回成功。
  各回、同時2 context で2シナリオ・10チェック（作成/招待/guest/再起動/同時編集/解除/
  救出/再参加/期限・使用・失効/8人競争/文書・account削除）。計4専用 DB 削除・mock 停止。
  通信は既存5179の dev server と使い捨て loopback mock に限定。

SQL/Deno/Swift の実実行ではない。Linux CI・macOS・本番サービスの検証は未確認。
Swift・fixture・旧 src/cloud・Project 型・ZIP・PrintPreview・dist・依存と
既存 `.tmp-vite-https.config.mjs` は変更なし。install / commit / push / gh / workflow 実行、
本番接続・設定変更・シークレット読取は行っていない。
