# Repository 契約（第1回）

この回では保存経路を切り替えない。App が使うのは抽出済みの
`project/normalizeProject.ts` と既存と同じ補助関数だけ。
codec、Repository、契約fixture、メモリ実装は既存保存には接続しない。

## 共通の確定条件

- 本体・summary・repositoryRevision・localRevision を原子的に確定する。
- IDB は transaction.oncomplete、SQLite は COMMIT の成功で receipt を返す。
- 新規は expectedRepositoryRevision=null の場合だけ。初期保存版は文字列 `1`。
- 更新は CAS が一致し、localRevision が保存済みより大きい場合だけ。
- rename は内容編集なので localRevision と updatedAt を要求する。
- touchOpened は lastOpenedAt と CAS 版だけ進め、内容版・updatedAt は維持する。
  開いた日時の更新後に古い snapshot が上書きされることも CAS で防ぐ。
- 失敗時は変更しない。get の null は欠損だけで、読めない場合は RepositoryError。
- operationId が同じ同一要求は元の結果を返す。異なる要求への再利用は CONFLICT。
  応答喪失時の結果照会 API、保持期限・GC、削除 tombstone・同期との原子性は、
  durable adapter と後続の同期・復旧設計で具体化する。
- 入出力は保存状態から独立した snapshot。保存中の追加編集は receipt の
  localRevision を超えるため dirty のまま残す。キューそのものは第6回。

## 一覧とページ

`lastOpenedAt ?? updatedAt ?? createdAt` を Date.parse 相当の epoch ms にして降順。
不正日時は 0。同日時は ID の Unicode scalar 順で昇順（localeCompare は使わない）。
既存 UI の日付優先度を維持し、同日時の順序だけ明確にする。
limit は整数 1..100、mode は任意。cursor は filter と最後のソートキーに結び付く
不透明文字列。最後のページの nextCursor は null。異なる filter／不正 cursor は
INVALID_ARGUMENT。offset ではなくキーを使う。ページ間の更新に対しては live 一覧
であり、snapshot isolation は保証しない。cursor の文字列表現自体は adapter 固有。

## JSON fixture の使い方

- `fixtures/projects.json`: 構造を模した匿名データ。stage、parade、旧 mode なし、
  旧フィールド（stage 内／トップ）、音源あり／なし、146人×18シーン、疎な旧データ。
  実ZIP・実名・音源本体は含まない。
- `fixtures/ids.json`: TS／Swift共用の検証表。規則の正本は `../ids.ts` のコメント。
  UTF-8 255 bytes、C0/C1・NUL・DEL、`/`・`\`・`:`・`..` を拒否。
  UUID限定にはしない。不正UTF-16 surrogateも拒否しSwiftと揃える。
  許可IDもパスへ連結せず、native が生成する storage key を用いる。
- `fixtures/commitProjects.json`: stage／parade の正規化済み匿名要求。
  TSとSwiftで同じ本体JSONを使用し、Swift側に正規化ロジックを複製しない。
  素材fixtureとの一致はcodecのunit testで確認する。
- `fixtures/operations.json`: formatVersion=1。scenario ごとに空の保存領域を用意する。
  expect はオブジェクトの再帰的部分一致。配列と null は完全一致。
  `expect.error` は機械判定用コードに一致する reject を期待する。
- `commit`: projectKey の正規化済み匿名要求に、トップレベル patch を適用。
  localRevision／expectedRepositoryRevision／operationId を渡す。
- `get`: 取得値に expect を適用し、戻り値の変更が保存状態へ反映されないことも確認。
- `list`: query を渡し、期待ID列と hasNext を確認する。
  usePreviousCursor=true は直前の list の nextCursor を用いる（APIには渡さない）。
- `rename`／`remove`: input をそのまま渡す。remove 成功は null と比較する。
- `touchOpened`: id と at を渡す。
- `duplicate`: source を get し、ID・title・createdAt・updatedAt を変更、lastOpenedAt
  を除去して新規 commit。localRevision=1。音源IDは共用、同期関係は付けない。
- `concurrentCommits`: 同じ期待版の要求を同時に開始し、成功数と失敗コードを確認。
- `commitWithEdit`: 呼び出し直後に入力の title を editedTitle へ変更する。
  保存本体が呼び出し時の snapshot と一致し、receipt が提出版を返し、
  editorLocalRevision > receiptLocalRevision の dirty が残ることを確認する。

runner は body と summary の全素材・版を独立に照合する。Vitest／Node／DOMには
依存しない。`runRepositoryContract(createRepository)` の factory は scenario ごとに
独立したテスト保存領域を返す（IndexedDBでは専用DB名を使い、最後にclose/delete）。
XCTestは同じJSONと上記操作の意味を使用し、要求を並列に開始してCASも検証する。
Swift側ではcommitProjects.jsonの要求をそのまま使用する。
実nativeの確定境界は第3回に試験する。

`testing/MemoryProjectRepository.ts` はテスト専用の契約モデル。
耐久性・再起動・容量不足・transaction abort を証明する実装ではない。
契約テスト自身は壊したadapter（欠損への吸収・CAS無視等）が失敗することも確認する。

## 第2回への引き継ぎ

IndexedDB adapter と音源の transaction 完了修正を行う。今回はDB名・store名・旧キーを
変更していない。移行やApp接続はまだ行わない。契約に加えて本体とsummaryの途中abort、
request成功後のabort、DB再オープン、複数接続CAS、失敗の分類を確認する。
音源の「不存在」と「取得失敗」を分け、request成功時点でresolveしない。
RevisionはJS Numberへ変換しない。SQLite側の整数上限はnative adapterで別途定義する。
旧データのID生成は移行台帳から注入し、毎回random IDを割り当てない。
Project.versionと保存schemaを混同してUNSUPPORTED_SCHEMAを判定しない。
