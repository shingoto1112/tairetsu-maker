# 第9回-4（9d）：控えの画面・操作記録・復元メモリ

9c `db55b14` と試験閾値修正 `9616fba` を基準に実装。SQL／Edge配備、本番接続、依存追加、commit/pushなし。9a〜9cの権限・原子的公開・保持契約は維持する。本書が9dの正本。

## 配置・文言

「みんなで編集」に「控え（履歴）」を追加。既存lazyなCollaborationSurfaceから新しいCollaborationHistoryPanelを読み込む。App.tsxは変更せず、上部にボタンを増やさない。iPad／スマホではダイアログ内を縦スクロールする。

- 現在参加中の全員・認証済みゲストが参加前を含む控えを利用できる。削除ボタンは文書作成者だけ。サーバーの権限検査も維持する。
- 日時、作った人（自動は「自動」、現在の参加者一覧にない人は「以前の参加者」）、平易な理由。新しい順で16件ずつkeyset取得する。過去の実名を補う新APIは作らない。
- 主操作は「新しい隊列表として開く」。新ID、共有資格・outbox非持出し。曲は8bの端末対応表で解決し、未対応ならaudioをnullにして案内する。
- 共有復元の確認画面は「全員に反映」「戻す直前も控えに残る」「後続の同時編集で完全には一致しない」を説明。削除も確認つき。
- 「受け付けました」「共有に反映しました」「この端末に反映しました」を区別。後続編集と未送信ローカル編集の差も別の日本語で表示する。
- 頻度制限／容量不足／保護中の削除／256KiB超を成功表示にしない。共有復元不可は独立コピーへ案内する。確定前のサイズ・容量・トポロジー拒否は自動再試行を止め、別の対象を選べる。同じ対象への明示再試行は保持済み要求IDを使う。
- 自動控えの容量不足延期、recoveryRequired、回収済みreceiptによる送信保留を実際のprovider状態から表示。使い方ページの共同編集本文は「準備中」のまま。

## 二重復元・保存失敗

HistoryControllerは画面ではなくSharedSessionControllerが所有する。画面を閉じても保持し、セッション終了／資格変更でabortする。

1. 要求ID、文書・参加世代、検証済み対象DTO、結果を**送信前に**HistoryJournalへCAS保存する。保存失敗なら送らない。
2. 受付・公開の応答消失、オフライン、再起動でも同じIDで確認する。確認済み要求を再開しても復元APIは再送しない。
3. 通常pull→SaveCoordinatorの永続保存が成功し、repository.getのdurable cursorがrestoreSeqへ達した後にobserveRestoreする。インメモリDoc／provider cursorで確認しない。
4. appliedを記録してからconfirmAppliedする。確認APIや確認後の記録保存が失敗しても同じ要求を再確認する。9cのサーバー側永久冪等柵も維持する。
5. 独立コピーのCommitRequestも保存前に固定する。応答消失は同じProject ID／operationId／CASで再試行する。保存済みで開けない場合は同じコピーを開く。正常に開いた後の次のコピー操作は新Projectを作る。

WebはProject DBとは別の `tairetsu-collaboration-operations` IndexedDB。ローカル文書・共有文書・世代・アカウント・参加世代をキーとし、readwrite transactionのCASで別タブの競合も検出する。

iPad nativeは既存Capacitor Filesystemの `Directory.LibraryNoCloud`、`Application Support/collaboration-operations/<SHA256 key>/`。Documents／iCloud共有には置かない。Web Locks内でrevisionを検査し、temp→一意なfinal名へrenameして公開する。最新2個の確定revisionを保持し、掃除の失敗は公開を覆さない。Web Locks非対応は保存を拒否する。Swift／SQLite schema不変。

最新記録の破損を古いrevisionへ戻さない。その文書の履歴操作だけを保留する。保存領域起動時の全件走査／Project一括変換はなく、別の壊れた1件は他文書のopenを妨げない。JWTや共有資格をコピーしない。未完了要求の掃除は追加しない。

## メモリ削減・測定

先に上限を下げる案では正常な2MiB以内の隊列表も復元不可になるため、検証を保った重複保持削減を採用した。

- 対象DTOのサイズ・digest・閉じた構造・完全スキーマ・射影一致は一度だけ検証し、対象Y.Docを破棄してから現在Hを再生する。重い2Docを同時保持しない。
- canonical文字列／UTF8配列同士の比較をJSON構造比較に置換。digest用canonical化は維持する。
- 検証済みDTOから復元し、既存Map・Y.Text・墓標を保つ。サーバーは一transaction内で順次writeし、全体のクロージャ配列を保持しない。
- update／復元後完全状態の検証、2MiB／256KiB上限、有効内容一致、必須直前控え・CAS原子公開は省略しない。作業Docもasync digest前に破棄する。
- 検証・canonical化・write・一致後もメモリをサンプルし、OS最大RSSを記録。Denoで強制GCはしない。

Windows Node v24.15.0、各12試行、単独プロセスの最終値：

| 操作 | workload | heap最大 MiB | サンプルRSS MiB | OS最大RSS MiB | CPU p95 ms | wall p95 ms |
|---|---|---:|---:|---:|---:|---:|
| restore | regular | 69.54 | 212.55 | － | 578 | 236.79 |
| restore | accumulated | 84.24 | 233.34 | 234.22 | 655 | 335.06 |
| compact | accumulated | 84.96 | 231.82 | 233.48 | 861 | 383.87 |
| automatic | accumulated | 65.19 | 217.96 | 219.11 | 593 | 228.23 |

regularはサンプルRSSを記載する。boundary restoreはQUOTA_EXCEEDED（想定どおり、OS RSS189.85MiB）。既存v2ベンチは履歴なしwall p95 28.38ms、128ログ144.36ms。binary工程と入力decodeを含み、HTTP／Auth／DBを含まない。Node値と前回Linux Deno値は直接比較しない。

既存CIの `bench-collab-maintenance.deno.ts` に regular／accumulated restoreの **heap≤120MiB、OS RSS≤240MiB** のrestoreMemoryBudgetを追加し、超過はexit 1。既存workflowが実行するのでworkflow変更不要。`--allow-env` 必須。WindowsにDenoはなく、この判定達成は未確認。CIが超過したら公開を止め、同じfixtureで上限縮小案と比較する。240MiBでも実Edgeの256MB枠の余裕は保証しないため、HTTPを含む実Edge最大値を公開前に確認する。

## 試験・画像

追加unit：`historyController.test.ts` 7件、`historyJournal.test.ts` 5件。実App V2 ON／実Edge handler＋ローカルRPCモックの `test-collaboration-history-browser.mjs`。外部通信を遮断し合成名・合成音源だけ使用する。SQL transactionはLinux suiteが正本。

2独立ブラウザーで一覧・続き・手動・容量／頻度失敗・ゲストコピー・端末曲対応・資格非持出し・相手反映・直前控え・後続差・端末保存失敗中のconfirm禁止・再起動／オフライン／公開応答消失・256KiB超の案内・自動控え容量回復・recoveryRequired・作成者削除・protected・解除後403・実IDB CASと破損行分離を検査する。

画像保存先：
`C:\Users\shing\AppData\Local\Temp\claude\c--Users-shing-OneDrive--------ChatGPT-------\e5aa9c38-eb07-490c-ac06-62f047c4c161\scratchpad\shots-9d\`

各 `744x1133 / 1133x744 / 1032x1376 / 1376x1032 / 390x844` の次の画像（計25枚）と `bounds.json`：

- `history-list-<寸法>.png`
- `history-confirm-<寸法>.png`
- `history-result-<寸法>.png`
- `history-difference-<寸法>.png`
- `history-recovery-<寸法>.png`

ホーム／共有は全寸法でviewport内、ダイアログ横overflowなし。スマホ確認／結果とiPad一覧を画像で確認。最終試験結果は本書末尾へ記録する。

保存失敗のE2Eで、remote-onlyの再保存成功では新しいoutboxがなく、storage errorで停止した受信が再開しない経路を確認した。SharedSessionControllerの既存commit通知から、storage error時だけprovider.wakeを追加した。履歴観測の100ms coalesceと通信の15秒再試行タイマーも分離し、確定済み復元の保存成功は直ちに観測する。確定前のサイズ拒否は再起動時にも自動実行しない。追加unitとE2E末尾の公開総数で検査する。

## Claudeと第10・11回への申し送り

- Linux：push後にSQL初回／再適用・実ロール・CAS／rollback／冪等性、Deno check・Edge試験2回、全9測定と追加restoreMemoryBudgetを確認。既存のサーバー256KiB超拒否試験も維持。Node値だけで公開しない。
- macOS：既存Swift47試験をコンパイル・実行。iPad実機でLibraryNoCloud private path／Web Locks／rename／強制終了後再開／容量不足を確認。今回Swiftと共通fixtureは不変。モック試験は実機の耐障害性を証明しない。
- 第10回：プレゼンス・ドラッグ表示は一時情報とし、Project／控え／outbox／durable cursorへ混ぜない。session owner／受信保存成功通知を利用し、復元の所有者を増やさない。
- 第11回：旧schema 1控えの完全性限界を維持し、現在値で過去を黙って補完しない。旧API停止・匿名認証保護を完了してから公開。recoveryRequired／receipt回収時の送信保留を無断解除しない。操作記録の掃除で未確認要求を消し、新ID再送させない。
- 第12回：使い方の共同編集本文をまとめて更新。今回は準備中を維持。

変更：`src/collaboration/{checkpoint,jsonEqual,restore,restorePlan,historyApi,historyController,historyJournal,provider,sharedSessionController,uiService}`、`src/components/{CollaborationHistoryPanel,CollaborationSurface,collaboration.css}`、`src/storage/sharedSessionState.ts`、unit／browser試験、`scripts/testing` のloader／mock、Deno測定、本書と履歴／復元／保守／UIのリンク。App.tsx、Project型、ZIP、PrintPreview、dist、SQL foundation、Swift、workflow、既存未追跡 `.tmp-vite-https.config.mjs` は不変。

## 最終Windows確認（2026-10-05）

- `npm test -- --maxWorkers 2`：**94ファイル785件、2回合格**（82.75秒／82.21秒）。最終追加対象4ファイル29件も別途2回合格。操作記録保存失敗時に送信しないこと、公開応答消失後の同じID、確認前の永続保存、確認応答失敗、別タブCAS、コピー保存応答消失／次回新ID、容量失敗、サイズ拒否の再起動、native rename失敗／破損最新記録／別キー隔離／cleanup失敗を含む。
- 最終 `test-collaboration-history-browser.mjs` **2回合格**。意図した2要求だけを公開、オフライン／再起動・サイズ拒否再起動でも公開総数2。25画像とboundsを最終状態で上書き。外部通信・旧API通信なし。
- typecheck、実Vite設定の一時build2構成と削除、`check-collaboration-bundle` 合格。メインJS **475,353 B（475,264 B基準から+89 B）**、gzip141,336 B。通常起動の静的graphに共同編集／Yjsなし。追加表示状態の投影だけが主bundleに入る。既存audioStorage import併用warningのみ。
- 指定 `test-collaboration-{ui,shared-session,lifecycle,provider,app,device-audio}-browser` は合格（shared-sessionは `test-shared-session-app-browser.mjs`、device-audioは `test-device-audio-app-browser.mjs`）。help-pageもV2 OFF／ONで合格、「準備中」を維持。最終保存回復修正後、shared-sessionとprovider／app／lifecycleを再確認済み。
- `test-build22-browser`、`test-app-storage-browser`、`test-indexeddb-browser`／`npm run test:repository:browser`（同一suite）はisolated Viteの `test-local-regression-browser.mjs` で合格。ステージ／パレード24寸法、ZIP／音源、保存失敗編集保持、CAS、30移行ケース、壊れた1件を含むDB open／upgradeを確認。
- `check-collab-v2`、`check-native-repository`、追加JSの構文、`git diff --check` 合格。native静的検査はSwift47件の実行を代替しない。
- `node --expose-gc scripts/bench-collab-v2.mjs`、`node --expose-gc scripts/bench-collab-maintenance.mjs` 合格。maintenance全9ケース、boundary restoreだけ想定QUOTA_EXCEEDED。上の表はメモリ工程サンプル追加後の値。
- 本番操作／Linux SQL・Deno／Swiftコンパイル／iPad実機は未実行。既存機能の回帰は上記で確認した。実Edgeの上限適合とnative private journalの実機耐障害性を未確認事項として残す。
