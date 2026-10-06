import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const median=xs=>{const a=[...xs].sort((a,b)=>a-b);return a[Math.floor(a.length/2)]??0;};
const f=x=>Number(x).toFixed(2);
export async function report(results){
 const grouped=new Map();for(const r of results){const key=[r.mode,r.count,`${r.width}x${r.height}`,r.cpu,r.operation].join('/');if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(r);}
 const rows=[];const csv=['mode,count,size,cpu,operation,variant,phase,runs,raf_p50_ms,raf_p95_ms,raf_p99_ms,over33_percent,over50_percent,long_count,long_total_ms,long_max_ms,long_over100_count,pointer_raf_p95_ms,input_p50_ms,input_p95_ms,input_duration_ms,received_moves'];
 for(const [key,runs] of grouped){
  const [mode,count,size,cpu,operation]=key.split('/');const metrics={};
  for(const variant of ['A','B']){
   const subset=runs.filter(r=>r.variant===variant);if(subset.length<3)throw Error('Incomplete condition '+key);
   metrics[variant]={};
   for(const phase of ['all','start','steady','end']){
    const samples=subset.map(r=>phase==='all'?r:r.sections[phase]);const m=Object.fromEntries(['p50','p95','p99','over33','over50','latency95'].map(k=>[k,median(samples.map(s=>s[k]))]));
    m.longCount=samples.reduce((n,s)=>n+s.longCount,0);m.longTotal=samples.reduce((n,s)=>n+s.longTotal,0);m.longMax=Math.max(...samples.map(s=>s.longMax));m.longOver100=samples.reduce((n,s)=>n+s.longOver100,0);
    metrics[variant][phase]=m;csv.push([mode,count,size,cpu,operation,variant,phase,subset.length,...['p50','p95','p99','over33','over50','longCount','longTotal','longMax','longOver100','latency95'].map(k=>f(m[k])),...['inputInterval50','inputInterval95','inputDuration','moves'].map(k=>f(median(subset.map(r=>r[k]))))].join(','));
   }
  }
  const a=metrics.A.all,b=metrics.B.all;const delta={p95:b.p95-a.p95,over33:b.over33-a.over33,latency95:b.latency95-a.latency95,steadyP95:metrics.B.steady.p95-metrics.A.steady.p95};
  const repeatedB=runs.filter(r=>r.variant==='B'&&r.longOver100>0).length;
  const repeatedA=runs.filter(r=>r.variant==='A'&&r.longOver100>0).length;
  const pass=delta.p95<=2&&delta.steadyP95<=2&&delta.over33<=2&&delta.latency95<=8&&!(repeatedB>=2&&repeatedA<2);
  rows.push({mode,count,size,cpu,operation,a,b,delta,pass,metrics,repeatedA,repeatedB});
 }
 const stage=rows.filter(r=>r.mode==='stage'),pass=stage.length===6&&stage.every(r=>r.pass);
 const max=k=>Math.max(...stage.map(r=>r.delta[k]));
 const text=['# 操作中の名前表示 A/B 測定（2026-10-06）','',
  `判定: **${pass?'合格':'不合格／未完了'}**。ステージ ${stage.length}/6 条件。各 A/B 3回、各条件にウォームアップ。`,
  `最大増加: rAF p95 ${f(max('p95'))}ms、定常 p95 ${f(max('steadyP95'))}ms、33.3ms超 ${f(max('over33'))}ポイント、pointer→次rAF p95 ${f(max('latency95'))}ms。Bの代理遅延p95最大 ${f(Math.max(...stage.map(r=>r.b.latency95)))}ms。`,'',
  '## 方法・限界','',
  '- npm の既存 Vite/Playwright のみ。envFile:false の production build。Aはb5f4076の名前隠し、Bは作業ツリーの名前常時表示。空いているloopbackポートでpreview。架空データ・隔離コンテキスト・外部リクエスト遮断。ビルドはOS一時フォルダに作成し終了時に削除。',
  '- 200/300人、1376×1032、CDP CPU 4倍、倍率150%。座標と配置は各A/B同一。単体・2人選択ドラッグはCDP mouse、パンはCDP touch。約16.67ms間隔で60点の同じ往復経路（1秒）。A/Bを試行ごとに交互に実行。',
  '- Chromiumで入力が統合されるため、実際のpointermove受信期間の最初20%を開始、次70%を定常、最後10%＋120msを終了として分類。rAF間隔とtrusted pointermove受信→次rAFを採取。後者は入力から画面表示までの実遅延ではなく代理値。long taskはPerformanceObserver。OS/IPCの入力送信時間は代理遅延に含まれない。',
  '- 表のp95/割合は各3試行の中央値。long task件数・合計は3試行の総和、最大は最大値。全指標と開始/定常/終了の表は [CSV](member-label-ab-summary.csv)。',
  '- 合格基準はp95差≤2ms、33.3ms超の増加≤2ポイント、代理p95差≤8ms。Bで100ms以上が2試行以上に新規反復する条件がないこと。定常p95にも同じ基準を適用。絶対50msは目標として別記。Chromiumの合成負荷でありiPad実機の合格を保証しない。','',
  '|モード|人数|画面|CPU|操作|p95 A/B ms|定常p95 A/B ms|>33増加 pt|代理p95 A/B ms|long 件数 A/B|long 最大 A/B ms|判定|',
  '|---|---:|---|---:|---|---|---|---:|---|---|---|---|'];
 for(const r of rows)text.push(`|${r.mode}|${r.count}|${r.size}|${r.cpu}|${r.operation}|${f(r.a.p95)}/${f(r.b.p95)}|${f(r.metrics.A.steady.p95)}/${f(r.metrics.B.steady.p95)}|${f(r.delta.over33)}|${f(r.a.latency95)}/${f(r.b.latency95)}|${r.a.longCount}/${r.b.longCount}|${f(r.a.longMax)}/${f(r.b.longMax)}|${r.pass?'合格':'要確認'}|`);
 await fs.writeFile('docs/member-label-ab-summary.csv',csv.join('\n')+'\n');await fs.writeFile('docs/MEMBER_LABEL_AB.md',text.join('\n')+'\n');
 console.log(JSON.stringify({pass,conditions:rows.length,stageConditions:stage.length,maxDeltaP95:max('p95'),maxDeltaOver33:max('over33'),maxDeltaLatency:max('latency95'),failures:rows.filter(r=>!r.pass).map(r=>({mode:r.mode,count:r.count,size:r.size,cpu:r.cpu,operation:r.operation,delta:r.delta}))}));
 return {pass,rows};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await report(JSON.parse(await fs.readFile(process.argv[2] ?? (()=>{throw Error('Pass the result JSON path');})(),'utf8')));
