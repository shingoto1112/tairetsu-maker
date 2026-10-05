import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const read=async name=>JSON.parse(await readFile(`output/storage-performance/${name}.json`,'utf8'));
const before=await read('before'),after=await read('after');
for (const report of [before, after]) {
  assert.deepEqual(report.errors, []); assert.deepEqual(report.denied, []);
}
assert(before.count===after.count && !before.profile && !after.profile);
assert(before.rows.length===24 && after.rows.length===24,'Full matrix is required');
const key=r=>`${r.v2?'ON':'OFF'} / ${r.ipad?'iPad':'Web'} / ${r.project.replace('perf-','')} / ${r.temperature}`;
const number=v=>v.toFixed(1), pair=m=>`${number(m.p50)} / ${number(m.p95)}`;
const lines=['## 改善前後の反復計測結果','',`各条件 n=${before.count}、単位ms、セルはp50 / p95。medium=146人×18シーン、large=200人×45シーン、parade=200人×45シーン/500m。`,''];
for(const metrics of [['list','open'],['manualSave','autoSave','scene']]) {
  const labels={list:'一覧',open:'開く',manualSave:'手動保存',autoSave:'自動保存（800ms待機含む）',scene:'シーン切替'};
  lines.push(`| 条件 | ${metrics.flatMap(k=>[`${labels[k]} 前`,`${labels[k]} 後`]).join(' | ')} |`,
    `|---|${metrics.flatMap(()=>['---:','---:']).join('|')}|`);
  for(const b of before.rows) {
    const a=after.rows.find(r=>key(r)===key(b)); assert(a);
    for(const k of metrics) assert(b.metrics[k].n===before.count && a.metrics[k].n===after.count);
    lines.push(`| ${key(b)} | ${metrics.flatMap(k=>[pair(b.metrics[k]),pair(a.metrics[k])]).join(' | ')} |`);
  }
  lines.push('');
}
lines.push('### シーン切替中の最大frame intervalの分布','',
  '各操作中に観測した最大rAF間隔のp50 / p95。1フレームも落ちないことの証明ではない。',
  '', '| 条件 | 前 | 後 |','|---|---:|---:|');
for(const b of before.rows) { const a=after.rows.find(r=>key(r)===key(b));lines.push(`| ${key(b)} | ${pair(b.metrics.sceneFrameMax)} | ${pair(a.metrics.sceneFrameMax)} |`); }
lines.push('');
await writeFile('output/storage-performance/comparison.md',lines.join('\n'));
const compact={before:{browser:before.browser,count:before.count,rows:before.rows.map(({samples,...r})=>r)},after:{browser:after.browser,count:after.count,rows:after.rows.map(({samples,...r})=>r)}};
const optional = async name => { try { return await read(name); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
const repeatBefore = await optional('repeat-before-on-parade'), repeatAfter = await optional('repeat-after-on-parade');
if (repeatBefore && repeatAfter) {
  for (const report of [repeatBefore, repeatAfter]) {
    assert(report.count === 20 && !report.profile && report.rows.length === 2);
    assert.deepEqual(report.errors, []); assert.deepEqual(report.denied, []);
  }
  compact.repeat = { before: repeatBefore.rows.map(({samples,...r})=>r), after: repeatAfter.rows.map(({samples,...r})=>r), count:20 };
  const repeatLines = ['## 中断後の追加比較（V2 ON / Web / 500m parade）', '',
    '旧描画を20回、その直後に新描画を20回。各行はp50 / p95（ms）。当初の全条件の観測を置き換えず、別の比較として保持する。', '',
    '| 操作 | cold 旧 | cold 新 | warm 旧 | warm 新 |', '|---|---:|---:|---:|---:|'];
  for (const [metric,label] of Object.entries({list:'一覧',open:'開く',manualSave:'手動保存',autoSave:'自動保存（800ms含む）',scene:'シーン切替',sceneFrameMax:'最大rAF間隔'})) {
    repeatLines.push(`| ${label} | ${['cold','warm'].flatMap(temperature=>[repeatBefore,repeatAfter].map(report=>pair(report.rows.find(row=>row.temperature===temperature).metrics[metric]))).join(' | ')} |`);
  }
  await writeFile('output/storage-performance/repeat-comparison.md', repeatLines.join('\n')+'\n');
}
await writeFile('docs/STORAGE_PERFORMANCE_RESULTS.json',JSON.stringify(compact,null,2)+'\n');
console.log(lines.join('\n'));
