# 保存方式 第11回：反復計測と描画負荷の改善

対象HEADは `db35f73`、作業ブランチは `codex/ipad-release-20261002`。編集はCodexのみ。保存形式、Project型、ZIP、表示座標と内部座標の分離、ステージ/パレードの仕様、印刷内容は変更しない。

中断後の再開時はHEADが `a5dcfb0` に進んでいた。`db35f73..a5dcfb0` は `.github/workflows/supabase-edge-deploy.yml` 1件だけで、アプリソース差分はない。この既存変更と未追跡 `.tmp-vite-https.config.mjs` は編集・実行しない。

## 再実行方法と測定条件

PowerShellでは `npm` のps1実行制限を避けるため `npm.cmd` を使う。依存追加は不要。

```powershell
$env:PERF_SAMPLES='20'
$env:PERF_OUTPUT='output/storage-performance/after.json'
node scripts/measure-storage-performance.mjs

# 原因を調べる別実行。通常の性能測定と混ぜない。
$env:PERF_SAMPLES='3'
$env:PERF_PROFILE='1'
$env:PERF_CASE='off-web-perf-large'
$env:PERF_OUTPUT='output/storage-performance/profile-after.json'
node scripts/measure-storage-performance.mjs
```

改善前の再現は、作業ツリーを戻さず次のように旧Railだけを計測サーバーへ渡す。撤去した旧writerはAppから未参照だったため測定に含めない。改善後は `PERF_BASELINE_RAIL` / `PERF_PROFILE` / `PERF_CASE` / `PERF_RESUME` を解除して全条件を測る。

```powershell
node -e "require('fs').mkdirSync('output/storage-performance',{recursive:true});require('fs').writeFileSync('output/storage-performance/baseline-scene-rail.txt',require('child_process').execFileSync('git',['show','db35f73:src/components/SceneThumbnailRail.tsx']))"
$env:PERF_BASELINE_RAIL='output/storage-performance/baseline-scene-rail.txt'
$env:PERF_SAMPLES='20'
$env:PERF_OUTPUT='output/storage-performance/before.json'
node scripts/measure-storage-performance.mjs
Remove-Item Env:PERF_BASELINE_RAIL
```

- Windows x64 / AMD Ryzen 7 7735U（16 logical CPUs、RAM約15.2GiB）/ Node 24.15.0 / Playwright Chromium 149.0.7827.55、headless。ローカルVite開発サーバーとReact開発版/StrictModeのみ、`.env`を読まずSupabase定義を無効にし、ブラウザーの外部リクエストも拒否する。利用者のDB・音源・ブラウザーを使用しない。
- 200人×45シーン、既存Repository匿名fixtureを利用した146人×18シーン、200人×45シーンの500mパレードを使用。パレードの全長縮小は行わない。
- Web 1440×1000、iPadプレビュー `?runtime=capacitor-ios` / 1032×1376（touchあり）。V2 OFF/ONの両方、全文書のsync/collaborationはnull。iPadプレビューの保存先はIndexedDBでありSQLiteではない。
- 各条件20回。各cold観測は新しいcontextに対象1件＋匿名小文書49件を通常Repository APIでseedし、HTTP cacheを消去、seedページを閉じ、新しいページを開く。既存DBへの起動を測り、schema作成はseedに分離する。旧sourceはなく、空の移行台帳のbootstrapと起動時メンテナンスは一覧測定に含む。実際の旧データ移行時間はこの測定の対象外。
- warmは同じページの編集から一覧へ戻り、再度開く観測。coldのたびにwarmを1回取るため、同一contextで20回続けた結果ではない。Viteのサーバー側変換cache/OS cacheは保持される。最初のcoldにはサーバー変換も含む。
- 一覧はナビゲーション開始（cold）/戻るボタンのclick（warm）から50カードと追加操作の有効化まで。開くはDOM clickから編集UI・200/146人のCanvas・選択中の小窓SVGが存在するまで。いずれも2回のrequestAnimationFrameを待つ。DOM存在だけの計測やPlaywrightの100ms刻みのassert待機時間と混同しない。
- 手動保存は編集でdirtyにしてから保存click→dirty解除・「保存」表示まで。自動保存はinputイベント→同じ完了条件で、仕様の800ms待機と描画を含む。シーン切替は2番目のカードclick→active反映＋2フレームまで。描画省略で完了条件を弱めていない。
- 百分位はnearest rank：p50=`ceil(n*.50)`、p95=`ceil(n*.95)`（1始まり）。単発や3回の診断を20回のp95と混ぜない。raw観測値・frame interval・profileはJSONに保存（git対象外）。
- 計測途中の編集と旧描画の混在を防ぐため、旧Railソースを一時保存して `PERF_BASELINE_RAIL` でVite transformに固定した。`PERF_RESUME=1` は同じcount/profileの完了済み条件だけを再利用し、不完了条件は全20回を取り直す。通常ビルドに旧コードやProfilerは追加しない。

## 改善と互換性

`SceneThumbnailRail`からSVG描画を`SceneThumbnailPreview`へ分離し、IntersectionObserverで小窓リスト内の可視範囲＋100pxだけ描画する。選択中のシーンは常に描画する。全45カードのラベル、ボタン、固定寸法、コンテキストメニュー、共同編集presenceを残し、SVGは同じ寸法のplaceholderになる。縦リスト・iPadの横リストとも実際の矩形で判断する。Observer非対応時は従来の全描画へ戻す。

SVGをmemo化し、タイトル・dirty状態・選択・presence更新でSVGを作り直す負荷を減らす。snapshotは前のシーンから位置/道具状態を継承するため、現在frameだけでcacheを判定しない。frames全体・members・stageObjects・memberGroups・stageと全体寸法フラグの変更で再描画する。色・割当・継承の試験を追加した。

StageCanvas/ParadeCanvas、座標計算、正規化、保存・復旧のロジックは変更しない。正規化は診断で約1msだったため、互換性に触れる最適化は採用しない。

## プロファイルの読み方

計測専用サーバーでnormalize呼出しとReact Profiler（App / Rail / StageCanvas / ParadeCanvas）を挿入し、get/touchOpened/list/commitのPromise往復を記録する。ReactのactualDurationはDOM配置・layout・paintを含まず、Appは子のdurationを含むため加算できない。get等のwall timeはmain threadの描画待ちも含み、非同期の一覧refreshは描画と重なる。Repositoryの素のI/O時間と誤認しない。2回rAFも物理的なGPU提示時刻を保証しない。

Web 1440×1000 / V2 OFF、各cold/warm 3回の診断の中央値（ms）。「小窓」「Canvas」「React全体」は開く完了までのcommitのactualDuration合計で、first mountだけの値ではない。Repository.getにはcodecの構造検証・本文復号/正規化も含み、「正規化」はその後のApp側のnormalizeProject呼出しだけを分離している。

| 文書・条件 | get 前→後 | touchOpened 前→後 | App正規化 前→後 | 小窓SVG 前→後 | Canvas 前→後 | React全体 前→後 |
|---|---:|---:|---:|---:|---:|---:|
| 200人45 / cold | 8.4→8.7 | 18.3→18.2 | 1.2→1.1 | 180.3→29.9 | 38.1→36.4 | 487.0→384.0 |
| 200人45 / warm | 8.1→8.0 | 15.0→15.1 | 0.3→0.2 | 228.8→24.3 | 25.9→34.6 | 510.7→334.2 |
| 500m parade / cold | 6.0→6.4 | 11.0→11.2 | 0.9→0.9 | 188.4→29.1 | 60.9→79.3 | 512.6→422.0 |
| 500m parade / warm | 6.2→6.4 | 11.8→11.4 | 0.2→0.3 | 231.5→23.5 | 67.3→66.2 | 565.1→367.7 |

中断後のV2 ON / Web parade、各3回の診断も実施した。coldではget 10.7→7.1ms、App正規化1.2→1.0ms、小窓207.4→33.4ms、Canvas81.6→85.3ms、React全体613.4→466.7ms。warmではget12.7→10.9ms、正規化0.5→0.3ms、小窓410.0→39.9ms、Canvas109.9→117.6ms、全体1,033.5→646.4ms。旧・新とも以前のV2 OFF診断より重くなり、Canvasや全体の遅延を小窓の変更だけに帰属させない。

両文書の初期小窓circle数は9,000→1,800。小窓の負荷削減は明確だが、Canvasは変更しておらず3回の値から性能差を断定しない。一覧refreshのRepository.listのwall timeには800ms前後の値が記録されることがあるが、React描画と同時に待っているためI/Oそのものが800msという解釈は誤り。

編集画面を初めて出すReact commit全体のactualDuration中央値は、ステージcold 335.6→235.2ms / warm 263.5→181.5ms、パレードcold 355.9→247.7ms / warm 284.7→197.6ms。ここにもDOM配置・paintは含まれず、get/normalizeとこれらの値を足して開く時間を完全に説明できるわけではない。残るApp配下の描画とlayout/paintが次の調査候補である。

## 旧書込みの整理

通常保存から旧保存APIへの参照を全検索してから撤去する。保持する移行/救出readerは`src/storage/legacyReaders.ts`、移行台帳はmigrationCoordinator/Repository、旧音源の読取り・コピー移行はplatform/audioStorageとSwift AudioStore、明示整理はmaintenanceのcleanupOldData。詳細は [移行の記録](./STORAGE_MIGRATION.md) を参照。

## 依存関係

依存変更なしの監査は [依存監査報告](./STORAGE_DEPENDENCY_AUDIT.md)。high 4 / moderate 7 / low 1、実行時の2パッケージは現行コードで指摘APIへの到達経路が見つからず、残りは開発用。更新案はClaudeの判断待ちで、本作業では更新しない。

## iPad実機で確認すること

- 同じ匿名3文書で新規アプリ起動/開き直し各20回を測定。SQLite読取り・bridge・WKWebView描画をSafari Web InspectorとInstrumentsで分け、端末/OS/電源・発熱条件を記録する。
- 1032×1376と横向き、500mルートを縮小せずスクロール・ズーム・ピンチ・ドラッグ・慣性スクロール・全画面。60Hz/120Hzのframe interval・入力遅延・メモリピークを確認する。
- 小窓を先頭から末尾へ速くスクロール、画面外シーンを選択、折り畳み/再展開、回転。固定サイズ、選択シーンの自動スクロール、空白の残留や古いpreviewがないこと。
- メンバー/道具の移動・表示/非表示・割当・色・前シーンから継承する位置変更、通常m/センター割りの両方を確認する。
- 自動保存/手動保存/戻る/再起動、低容量・ロック・保存直後の終了。旧ミラー・旧localStorageへの追記がなく、移行/下書き救出/「古い保存データを整理」が継続すること。
- 旧音源がコピー移行され原本保持、再生/seek/ZIP書出しが通ること。共有文書のpresence付き小窓、オフライン復帰、印刷とステージのみのスクリーンショットも確認する。

本PCではiPad実機・Swift実行・SQLiteの性能・本番クラウドを未確認。ブラウザー寸法の再現を実機合格と扱わない。

## 目標の判定と残る制約

全24条件×20回の結果を下記に掲載し、不利な観測も除外しない。V2 OFFのWeb 200人45シーンcoldは開くp95 1,093.8→980.9ms、warmは847.0→752.3ms。500mパレードwarmは1,045.4→745.9ms。iPadプレビューの200人45シーンwarmは1,122.7→817.2ms、パレードwarmは1,050.4→889.2ms。小窓SVGの負荷削減と保存時の再描画削減は確認できた。

- 開くp95 1秒：全条件では未達。V2 OFFでもiPadの大きな文書coldなどが残る。146人iPad coldは中央値830.2→743.2msだがp95 875.6→924.0msで、すべての分位が改善したとは言わない。
- 一覧p95 300ms：warmは達成、coldは未達。coldには開発版のHTTP/JS読み込み、起動時bootstrap/maintenanceと50カードの描画が入る。安全性を確かめず起動時メンテナンスを後回しにして数値だけを下げる変更はしない。
- 操作中のフレーム落ちなし：未達。V2 OFFのシーン切替でも33〜100msの最大rAF間隔が残る。小窓削減だけで60Hz/120Hzを保証できない。ドラッグ/ピンチの既存回帰試験とシーン切替の観測は別に扱う。
- 全条件の改善後後半ではV2 ONのwarm遅延が増えた。特にWeb paradeは開くp95 951.8→2,572.4ms。3回の追加診断では新描画warm中央値1,443.9ms、同じ現在環境の旧描画も1,530.5msで、小窓の変更だけでは増加を説明できない。CPU/熱/GC/layoutを確定原因と断言せず、追加20回の旧・新比較を別途記録する。

次の改善候補はApp配下の初期再描画とlayout/paintのブラウザートレース、V2 ONのwarm遅延の追跡、本番ビルドと実機での同条件計測。保存の互換性を変える案や全面的なApp再構成は今回採用しない。

## 改善前後の反復計測結果

各条件 n=20、単位ms、セルはp50 / p95。medium=146人×18シーン、large=200人×45シーン、parade=200人×45シーン/500m。

| 条件 | 一覧 前 | 一覧 後 | 開く 前 | 開く 後 |
|---|---:|---:|---:|---:|
| OFF / Web / large / cold | 359.6 / 517.4 | 359.7 / 370.6 | 1014.9 / 1093.8 | 922.7 / 980.9 |
| OFF / Web / large / warm | 47.2 / 49.6 | 47.3 / 63.6 | 830.5 / 847.0 | 691.4 / 752.3 |
| OFF / Web / medium / cold | 343.0 / 389.9 | 345.1 / 394.7 | 652.5 / 762.1 | 674.3 / 751.5 |
| OFF / Web / medium / warm | 47.6 / 50.6 | 59.7 / 61.2 | 498.6 / 571.3 | 486.0 / 500.8 |
| OFF / Web / parade / cold | 357.8 / 546.2 | 351.2 / 372.8 | 1070.4 / 1122.2 | 955.7 / 1007.9 |
| OFF / Web / parade / warm | 47.5 / 63.6 | 47.6 / 48.9 | 878.4 / 1045.4 | 700.2 / 745.9 |
| OFF / iPad / large / cold | 355.2 / 423.5 | 356.4 / 365.8 | 1309.9 / 1454.0 | 1023.9 / 1125.2 |
| OFF / iPad / large / warm | 48.0 / 49.9 | 47.2 / 48.9 | 959.9 / 1122.7 | 789.8 / 817.2 |
| OFF / iPad / medium / cold | 349.5 / 399.4 | 345.6 / 366.8 | 830.2 / 875.6 | 743.2 / 924.0 |
| OFF / iPad / medium / warm | 47.6 / 49.3 | 48.2 / 61.8 | 586.6 / 652.9 | 548.3 / 598.0 |
| OFF / iPad / parade / cold | 352.5 / 365.4 | 356.7 / 450.9 | 1322.6 / 1489.8 | 1090.6 / 1243.4 |
| OFF / iPad / parade / warm | 47.7 / 48.9 | 47.6 / 48.3 | 979.2 / 1050.4 | 829.4 / 889.2 |
| ON / Web / large / cold | 354.0 / 532.3 | 350.9 / 363.3 | 1033.2 / 1094.7 | 951.6 / 1055.4 |
| ON / Web / large / warm | 48.1 / 71.2 | 47.7 / 48.4 | 840.3 / 915.7 | 804.1 / 857.7 |
| ON / Web / medium / cold | 340.9 / 370.8 | 344.7 / 361.5 | 655.3 / 801.9 | 693.5 / 830.4 |
| ON / Web / medium / warm | 48.0 / 48.9 | 60.1 / 61.7 | 501.6 / 513.3 | 538.8 / 602.2 |
| ON / Web / parade / cold | 347.4 / 359.1 | 541.8 / 577.7 | 1080.9 / 1158.2 | 977.2 / 1487.7 |
| ON / Web / parade / warm | 48.6 / 52.5 | 83.5 / 113.9 | 890.1 / 951.8 | 2206.3 / 2572.4 |
| ON / iPad / large / cold | 354.8 / 383.8 | 509.6 / 598.4 | 1310.0 / 1371.0 | 1172.9 / 1370.5 |
| ON / iPad / large / warm | 48.2 / 49.2 | 70.1 / 79.8 | 969.5 / 985.7 | 1327.9 / 1441.5 |
| ON / iPad / medium / cold | 340.4 / 366.0 | 570.9 / 650.7 | 821.9 / 891.5 | 954.1 / 1242.1 |
| ON / iPad / medium / warm | 47.6 / 49.2 | 62.7 / 69.6 | 596.9 / 669.8 | 984.8 / 1370.6 |
| ON / iPad / parade / cold | 347.4 / 407.3 | 481.8 / 555.3 | 1343.5 / 1505.8 | 1175.4 / 1215.3 |
| ON / iPad / parade / warm | 47.8 / 61.6 | 79.7 / 92.6 | 1005.1 / 1056.5 | 1400.1 / 1609.2 |

| 条件 | 手動保存 前 | 手動保存 後 | 自動保存（800ms待機含む） 前 | 自動保存（800ms待機含む） 後 | シーン切替 前 | シーン切替 後 |
|---|---:|---:|---:|---:|---:|---:|
| OFF / Web / large / cold | 316.9 / 360.0 | 180.3 / 193.3 | 1268.2 / 1294.5 | 1053.8 / 1068.2 | 172.0 / 197.5 | 93.1 / 96.5 |
| OFF / Web / large / warm | 325.2 / 377.5 | 179.5 / 194.5 | 1257.8 / 1271.9 | 1046.0 / 1085.5 | 159.9 / 173.1 | 86.7 / 108.5 |
| OFF / Web / medium / cold | 176.9 / 227.7 | 128.5 / 160.1 | 1049.8 / 1085.5 | 994.8 / 1007.6 | 93.9 / 126.5 | 65.3 / 82.8 |
| OFF / Web / medium / warm | 206.6 / 211.5 | 128.4 / 145.9 | 1024.6 / 1036.3 | 966.4 / 987.5 | 93.6 / 96.1 | 63.4 / 76.2 |
| OFF / Web / parade / cold | 360.2 / 409.0 | 210.9 / 239.8 | 1297.1 / 1368.5 | 1079.7 / 1096.7 | 177.4 / 192.3 | 111.6 / 125.6 |
| OFF / Web / parade / warm | 343.3 / 346.2 | 196.9 / 210.4 | 1285.3 / 1321.3 | 1075.8 / 1086.8 | 161.7 / 176.0 | 93.5 / 95.0 |
| OFF / iPad / large / cold | 354.3 / 415.2 | 178.6 / 194.3 | 1261.7 / 1321.4 | 1048.1 / 1066.8 | 158.8 / 178.1 | 83.2 / 95.0 |
| OFF / iPad / large / warm | 313.5 / 377.0 | 178.8 / 194.3 | 1254.3 / 1384.1 | 1061.8 / 1074.5 | 160.2 / 179.9 | 80.5 / 94.3 |
| OFF / iPad / medium / cold | 163.0 / 208.9 | 128.8 / 130.9 | 1046.4 / 1072.9 | 992.5 / 1014.7 | 81.9 / 95.5 | 62.1 / 68.1 |
| OFF / iPad / medium / warm | 162.6 / 178.1 | 128.1 / 129.8 | 1019.7 / 1028.5 | 958.2 / 1002.0 | 81.7 / 95.8 | 62.9 / 65.0 |
| OFF / iPad / parade / cold | 378.0 / 414.5 | 203.7 / 245.7 | 1288.9 / 1308.4 | 1075.4 / 1111.2 | 165.0 / 174.5 | 111.2 / 124.4 |
| OFF / iPad / parade / warm | 329.9 / 346.1 | 195.1 / 229.3 | 1281.9 / 1330.3 | 1071.0 / 1125.9 | 160.8 / 165.5 | 95.8 / 96.8 |
| ON / Web / large / cold | 328.3 / 345.8 | 194.0 / 195.7 | 1266.6 / 1287.0 | 1057.5 / 1070.8 | 178.2 / 211.8 | 93.4 / 95.7 |
| ON / Web / large / warm | 327.6 / 376.2 | 191.6 / 194.5 | 1260.6 / 1335.0 | 1043.6 / 1051.3 | 159.6 / 177.5 | 81.4 / 93.3 |
| ON / Web / medium / cold | 177.6 / 179.0 | 128.8 / 144.7 | 1049.0 / 1073.7 | 987.6 / 1004.2 | 80.8 / 94.5 | 62.7 / 78.2 |
| ON / Web / medium / warm | 202.1 / 209.8 | 128.3 / 129.4 | 1025.6 / 1052.2 | 965.1 / 995.2 | 93.8 / 97.3 | 63.3 / 65.7 |
| ON / Web / parade / cold | 344.8 / 398.4 | 228.1 / 416.2 | 1290.9 / 1352.5 | 1089.4 / 1121.1 | 189.5 / 227.0 | 221.9 / 302.9 |
| ON / Web / parade / warm | 336.5 / 344.2 | 464.4 / 610.1 | 1284.4 / 1323.0 | 1528.7 / 1960.1 | 159.6 / 176.3 | 207.9 / 295.1 |
| ON / iPad / large / cold | 344.8 / 362.6 | 329.5 / 343.7 | 1264.0 / 1299.7 | 1180.6 / 1231.1 | 177.8 / 192.4 | 141.0 / 155.0 |
| ON / iPad / large / warm | 312.6 / 363.4 | 312.5 / 399.7 | 1253.7 / 1264.6 | 1246.2 / 1332.1 | 147.3 / 163.6 | 131.0 / 162.7 |
| ON / iPad / medium / cold | 164.5 / 180.3 | 194.6 / 261.7 | 1038.0 / 1068.4 | 1051.3 / 1118.4 | 80.7 / 94.7 | 114.3 / 145.3 |
| ON / iPad / medium / warm | 162.6 / 164.1 | 209.6 / 291.9 | 1021.8 / 1037.9 | 1094.3 / 1132.3 | 82.8 / 96.0 | 111.2 / 178.1 |
| ON / iPad / parade / cold | 363.0 / 395.6 | 344.5 / 423.5 | 1288.8 / 1332.6 | 1192.1 / 1218.1 | 164.7 / 179.5 | 172.8 / 189.6 |
| ON / iPad / parade / warm | 330.0 / 348.8 | 327.9 / 416.9 | 1278.4 / 1328.1 | 1282.9 / 1381.5 | 161.1 / 183.3 | 145.9 / 194.6 |

### シーン切替中の最大frame intervalの分布

各操作中に観測した最大rAF間隔のp50 / p95。1フレームも落ちないことの証明ではない。

| 条件 | 前 | 後 |
|---|---:|---:|
| OFF / Web / large / cold | 150.0 / 166.8 | 66.6 / 66.8 |
| OFF / Web / large / warm | 133.3 / 149.9 | 50.0 / 66.7 |
| OFF / Web / medium / cold | 66.5 / 100.0 | 33.3 / 50.0 |
| OFF / Web / medium / warm | 66.7 / 66.7 | 33.3 / 50.0 |
| OFF / Web / parade / cold | 150.0 / 166.7 | 83.3 / 100.0 |
| OFF / Web / parade / warm | 133.4 / 150.1 | 66.7 / 66.7 |
| OFF / iPad / large / cold | 133.3 / 150.1 | 50.0 / 66.8 |
| OFF / iPad / large / warm | 133.3 / 150.0 | 50.0 / 66.7 |
| OFF / iPad / medium / cold | 50.0 / 66.7 | 33.3 / 33.4 |
| OFF / iPad / medium / warm | 50.0 / 66.7 | 33.3 / 33.4 |
| OFF / iPad / parade / cold | 133.4 / 150.0 | 83.3 / 83.4 |
| OFF / iPad / parade / warm | 133.3 / 133.4 | 66.6 / 66.7 |
| ON / Web / large / cold | 150.0 / 183.3 | 66.6 / 66.7 |
| ON / Web / large / warm | 133.3 / 150.0 | 50.0 / 66.7 |
| ON / Web / medium / cold | 50.0 / 50.1 | 33.3 / 33.4 |
| ON / Web / medium / warm | 66.7 / 66.7 | 33.3 / 33.4 |
| ON / Web / parade / cold | 166.6 / 199.9 | 200.0 / 283.3 |
| ON / Web / parade / warm | 133.3 / 150.1 | 183.3 / 266.6 |
| ON / iPad / large / cold | 150.0 / 166.7 | 116.6 / 133.3 |
| ON / iPad / large / warm | 116.7 / 133.4 | 100.1 / 133.4 |
| ON / iPad / medium / cold | 50.0 / 66.6 | 83.3 / 116.7 |
| ON / iPad / medium / warm | 50.0 / 66.7 | 83.3 / 150.0 |
| ON / iPad / parade / cold | 133.4 / 150.1 | 150.0 / 166.7 |
| ON / iPad / parade / warm | 133.3 / 149.9 | 116.7 / 166.7 |

## 中断後の追加比較（V2 ON / Web / 500m parade）

旧描画を20回、その直後に新描画を20回。各行はp50 / p95（ms）。当初の全条件の観測を置き換えず、別の比較として保持する。

| 操作 | cold 旧 | cold 新 | warm 旧 | warm 新 |
|---|---:|---:|---:|---:|
| 一覧 | 478.9 / 511.6 | 478.1 / 630.6 | 79.6 / 95.2 | 79.4 / 97.1 |
| 開く | 1181.8 / 1311.6 | 1044.7 / 1316.9 | 1463.5 / 1693.1 | 1320.5 / 1378.3 |
| 手動保存 | 568.8 / 725.3 | 349.5 / 406.0 | 815.3 / 946.5 | 332.4 / 459.6 |
| 自動保存（800ms含む） | 1525.8 / 1645.0 | 1200.1 / 1330.3 | 1649.3 / 1795.9 | 1283.0 / 1420.4 |
| シーン切替 | 316.0 / 357.8 | 173.0 / 187.1 | 271.4 / 311.2 | 156.9 / 215.5 |
| 最大rAF間隔 | 283.4 / 316.7 | 150.0 / 166.7 | 249.9 / 283.3 | 133.3 / 200.0 |

追加比較ではwarmの開く、手動/自動保存、シーン切替のp95が改善した。coldの開くp95は1,311.6→1,316.9msで改善しておらず、一覧は描画変更の対象ではない。環境変動の確定原因と全条件の性能保証は未解決。全24条件と追加比較の集計値は [STORAGE_PERFORMANCE_RESULTS.json](./STORAGE_PERFORMANCE_RESULTS.json) に保存し、raw 20観測はローカルのoutput/storage-performanceに保持する。

追加比較の再現は `PERF_SAMPLES=20`、`PERF_CASE=on-web-perf-parade`、Profilerなしで、旧Rail指定時の出力を `repeat-before-on-parade.json`、旧Rail解除後を `repeat-after-on-parade.json` にする。全表と集計JSONの再生成は `node scripts/report-storage-performance.mjs`。通常の全条件計測へ戻すときは `PERF_CASE` を解除する。

## 検証の再実行

`node scripts/check-storage-round11.mjs` は指定されたunit/browser/buildチェックを順番に実行し、各logと結果を `output/storage-performance/checks.json` に保存する。npm testとbuild22、新しい小窓ブラウザー試験は各2回。テスト専用5197サーバーと各既存試験のローカルモックを使い、既存5179サーバーは操作しない。Vite buildはworkspace内の一時フォルダで行い、main JSを測ってから削除する。`CHECK_PHASE=unit` / `browser` で範囲を選べるが、結果JSONはその実行の範囲になる。

最初の全チェックではVite buildが親processのNODE_ENVをproductionへ変え、後続browserに伝播した。legacyのDEV-only guard・runtime preview・共同編集mockが無効になったため、このbrowser実行を最終判定に使わない。ランナーでbuild前のNODE_ENVを復元し、browser段階をdevelopmentに固定して全browser試験を再実行する。計測専用サーバーにもproduction拒否を追加し、拒否を2回確認した。独立して起動した反復計測のprocessにはbuildの環境変数は伝播しておらず、React Profilerの記録も開発版で取得している。

historyの5190競合は中断前の専用 `storage-performance-server.mjs` の残存process。portとPID/commandを照合して今回の所有processのみ停止し、5179は操作しない。初回結果は `checks-initial-invalid-env.json` に保存する。

DEV条件で残ったhistory/presenceの待機前提も修正した。historyは復旧時のjournal確認によるbusy/再配置とクリックが競合するため、読み取り専用の一覧更新だけを再試行する（restore/delete/copyの再試行回数は変更しない）。presenceは開く際の成功通知が3秒後に消えるApp更新を観測に混ぜていたため、通知終了と2rAFを待ってから通信の観測を開始する。テスト用Vite変換で実際のApp/可視preview関数実行数も数え、既存Fiberのカウンターと合わせて0を要求する。アプリに通知・history・presenceの実装変更はない。

## 最終検証結果（2026-10-05）

| 検証 | 結果 |
|---|---|
| `npm.cmd test -- --maxWorkers 2` | 2回とも99ファイル / 834件成功。追加7件を含む |
| `npm.cmd run typecheck` / 一時Vite build | 成功。出力削除済み。main 371,369 B、基準370,075 Bから+1,294 B（0.35%）、gzip 114,766 B |
| `check-collaboration-bundle` / `check-native-repository` | 成功。通常startupに共同編集/Yjsなし。nativeは静的/SQL事前検証で、Swift実行ではない |
| `test-build22-browser` | DEV条件で2回成功。ステージ/パレード各12寸法、146人画像、タッチ/ドラッグ/慣性/ロック/600%ズーム |
| `test-app-storage-browser` | a〜l成功。旧キー不変、保存、ZIP、quota、2タブ競合、音源、バックアップ、GC、復元候補・previous救出 |
| `test-indexeddb-browser` / `npm.cmd run test:repository:browser` | 両方成功。契約50手順、移行30ケース、故障注入・再起動・破損隔離・CAS・200/1000文書 |
| `test-legacy-import-browser` / `test-legacy-local-browser` / `test-help-page-browser` | 成功。個別破損隔離、救出の冪等性、3runtime OFF/旧API0、V2 OFF/ONヘルプ・状態12種 |
| collaboration UI / shared-session / history / presence | 全成功。待機を更新したhistory/presenceは各2回。presenceの実際のApp/preview実行数は両回とも0 |
| `test-scene-previews-browser` | DEV条件で2回成功。Web/iPad、画面外省略、末尾選択、折り畳み再展開、回転、documentのスクロール不変 |
| production条件での計測拒否 / scripts構文 / `git diff --check` | 成功。production拒否は2回。意図しない差分と一時ビルドの残留なし |

ビルドには既存のaudioStorageのstatic/dynamic import混在警告が出る。今回このimport構成は変更しておらず、失敗ではない。正常なDEV条件のbuild22操作rAF p95最大値は1回目100.1ms / 2回目66.7ms、pinch release位置差最大1.303px。機能回帰の成功を「全操作でフレーム落ちなし」と扱わない。最初の不適切なNODE_ENV条件の33.3msは最終値に使わない。

最終集約はローカル `output/storage-performance/checks-final.json`、各ログ・画像もoutput内に保持する。初回失敗と再実行の履歴は削除しない。port競合時に作られた今回の一時コンパイルフォルダだけは、絶対パスがworkspace直下であることを確認して削除した。

主な変更ファイル：SceneThumbnailRail / 新SceneThumbnailPreview / 新useVisibleScenePreviewsと試験、legacyWriteBoundary試験、platform/index、計測・検証scripts（新5件とhistory/presence待機修正）、本書/APP_CONNECTION/MIGRATION/依存監査/集計JSON、outputのgit除外。旧storage.ts / projectStorage.ts / 廃止writerのstorage.test.tsを撤去した。
