# 起動直後の読み込みと保守処理

## 確認できた原因と限界

HEAD 97ef9ac、隔離した Chrome 149、匿名 ZIP で確認した。

- 追加ボタンが有効になった瞬間に MutationObserver からファイルを渡す試験では、修正前も成功した。報告された「有効化直後だけ毎回失敗」の条件は、この環境では再現できていない。
- 保存準備中（追加ボタンは無効）に同じファイルイベントを渡すと、修正前に「保存できませんでした。再試行できます。」を再現した。ZIP 展開後の `openProjectInEditor` は準備完了を待たず、未設定の `repositoryRef` を BUSY として扱っていた。外部からのファイル受け渡しには UI の disabled だけでは足りない。
- 起動時 GC は `prepareAppRepository` 内で await される。単に `[audio GC]` が読み込み前に出るだけでは、GC が保存と競合して BUSY を返した証拠にはならない。
- 別の競合として、IndexedDB の書き込みは DB 接続を取得してから `tairetsu-storage-maintenance` の shared lock を待っていた。待機中に Repository が close されると、取得済みの閉じた接続で transaction を作って InvalidStateError → BUSY になる。

## 修正

- App の保存準備 Promise を読み込み・通常操作が待つ。移行と起動保守が終わり、Repository と SaveCoordinator が設定されてから保存する。固定時間待ちや BUSY 全般の再試行は追加しない。
- GC は `tairetsu-audio-editors`、`tairetsu-storage-maintenance` の exclusive lock を両方 `ifAvailable` で取得する。保存が先に走っている場合、editor lock を保持したまま保存終了を待たずスキップする。次の起動または明示的な GC で再実行でき、成功するまで gcAt は更新しない。
- すでに GC が実行中なら保存は shared lock の取得を待つ。GC の参照検証から削除までの排他区間を分断せず、DB 接続はロック取得後に取得する。
- 現在、前世代、復旧候補、保存待ち音源、バックアップ、他タブの編集を保護する既存条件、Web Locks 非対応時の GC スキップは変更しない。
- Project 型、ZIP・保存形式、保存失敗時の編集保持は変更しない。

## 検証

追加試験: `REPOSITORY_TEST_ORIGIN` をローカル Vite の origin に設定し、`node scripts/test-startup-storage-browser.mjs` を実行する。最終版を2回実行して全ケース成功した。

- 有効化と同じブラウザータスクで音源付き ZIP を渡す。事前モジュール読み込みや driver 往復を挟まない。
- 起動保守の読み込みを遅らせ、保存準備中のファイル受け渡しを確実に発生させる。
- 読み込み後の連続編集・保存・再読み込み、音源の保持。
- 実際の App を2タブで同時起動し、有効化直後に読み込み、両方の編集を保存する。
- 実行中 GC に対する commit・rename・remove の待機と完了。
- 保存が先行する場合の GC スキップ、別タブの editor lock の取得。
- GC ロック待機中に close した Repository での commit 成功。

既存試験: 全ユニット試験は2回とも99ファイル・834件成功。typecheck、Vite build、app-storage、IndexedDB（直接および npm 経由）、legacy-import、legacy-local、collaboration-ui、shared-session、collaboration-history、native preflight、diff --check は成功。

build22: stage の12画面サイズは初回成功。並行実行中に parade 1210×834 の `inertia advances` が失敗したため、他の重い試験終了後に parade 全12画面サイズを単独再実行した。全サイズと後続のシーン表示、慣性、最大ズーム、ドラッグ、名簿画像、長距離キャンバスの確認まで成功した。画面・ジェスチャーの実装は変更していない。

メイン JS: `index-Bt_TgTO5.js` 371,505 B（基準 371,369 B から +136 B）。ビルドは一時フォルダーに出力し、確認後削除済み。

## iPad

Swift の `ProjectRepository.execute` は所有 queue に入ってから `StorageMaintenance.lock.lock()` を取得する。GC、commit、rename、remove、バックアップはこの同じ待機ロック内で実行され、AudioStore も同じ NSRecursiveLock を使う。GC がロックを保持していることだけを理由に BUSY を返す構造ではない。App の準備待機修正は iPad にも適用される。

Swift の変更と新しい XCTest は追加していない。既存の GC・前世代・復旧・バックアップ保護 XCTest と native preflight を確認した。Windows では Swift のコンパイル・XCTest と LINE/Files の実機受け渡しは実行していない。macOS では `swift test --package-path ios/ProjectRepositoryCore`、実機では起動直後のファイル受け渡しを確認する。
