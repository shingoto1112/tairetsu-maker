import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';

// Inspect the emitted jsPDF content streams, independently of the browser/model.
// Track graphics-state matrices, stroke colors and rectangle paths in PDF points.
const quick = process.argv.includes('--quick');
const only = process.argv.find(a=>a.startsWith('--case='))?.slice(7);
const directory = `output/build31/vector-pdf-assignment-fix${quick ? '/quick' : ''}`;
const identity = [1, 0, 0, 1, 0, 0];
const multiply = (a, b) => [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3],
  a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
function borders(content) {
  let state = { matrix: identity, color: [0,0,0], width: 1 }, operands = [], path = [];
  const stack = [], rectangles = [];
  for (const token of content.match(/<[0-9a-f\s]*>|\([^)]*\)|\/[^\s[\]<>()]+|[\[\]]|[^\s]+/gi) ?? []) {
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(token)) { operands.push(Number(token)); continue; }
    if (token === 'q') stack.push({ ...state, matrix: [...state.matrix], color: [...state.color] });
    if (token === 'Q') { assert.ok(stack.length); state = stack.pop(); }
    if (token === 'cm') { assert.equal(operands.length,6); state.matrix = multiply(state.matrix, operands); }
    if (token === 'RG') state.color = operands.slice(-3);
    if (token === 'G') state.color = Array(3).fill(operands.at(-1));
    if (token === 'w') state.width = operands.at(-1);
    if (token === 're') {
      const [x,y,w,h] = operands.slice(-4), [a,b,c,d,e,f] = state.matrix;
      const points = [[x,y],[x+w,y],[x,y+h],[x+w,y+h]].map(([xx,yy])=>[a*xx+c*yy+e,b*xx+d*yy+f]);
      const halfStroke = state.width * Math.hypot(a,b) / 2;
      path.push({ left: Math.min(...points.map(p=>p[0]))-halfStroke, right: Math.max(...points.map(p=>p[0]))+halfStroke,
        bottom: Math.min(...points.map(p=>p[1]))-halfStroke, top: Math.max(...points.map(p=>p[1]))+halfStroke });
    }
    if (['S','s','B','B*','b','b*'].includes(token)) {
      if (state.color.every((v,i)=>Math.abs(v-[148/255,163/255,184/255][i])<.015)) rectangles.push(...path);
      path=[];
    }
    if (['n','f','f*'].includes(token)) path=[];
    operands=[];
  }
  assert.equal(stack.length,0);
  return rectangles;
}

const results=[];
for (const dimensions of ['square-19x18','tall-10x20','wide-30x12']) for (const view of ['audience','performer']) {
  const name=`${dimensions}-${view}`;
  if(only && only!==name)continue;
  for (const mode of ['before-vector','vector']) {
    const buffer=await readFile(`${directory}/${name}-${mode}.pdf`), raw=buffer.toString('latin1');
    const objects=new Map([...raw.matchAll(/(?:^|\n)(\d+) 0 obj\s*([\s\S]*?)\nendobj/g)].map(m=>[Number(m[1]),m[2]]));
    const pages=[...objects.values()].filter(s=>/\/Type \/Page\b/.test(s)), checked=[];
    if(dimensions.startsWith('square')) assert.equal(pages.length,quick ? 2 : 18);
    for(const [i,page] of pages.entries()) {
      const box=page.match(/\/MediaBox\s*\[([^\]]+)\]/)?.[1].trim().split(/\s+/).map(Number);
      assert.ok(box && Math.abs(box[2]-841.89)<.02 && Math.abs(box[3]-595.28)<.02,'A4 landscape');
      const ref=Number(page.match(/\/Contents (\d+) 0 R/)?.[1]), object=objects.get(ref);
      assert.ok(object,'Page content stream');
      const match=/stream\r?\n/.exec(object), length=Number(object.match(/\/Length\s+(\d+)/)?.[1]);
      assert.ok(match && length>0);
      const bytes=Buffer.from(object.slice(match.index+match[0].length,match.index+match[0].length+length),'latin1');
      const content=(object.includes('/FlateDecode')?inflateSync(bytes):bytes).toString('latin1');
      const frames=borders(content).filter(r=>r.right-r.left>50 && r.top-r.bottom>50).sort((a,b)=>(b.right-b.left)-(a.right-a.left));
      assert.equal(frames.length,2,`${name} ${mode} p${i+1}: stage + assignment outer frames`);
      const [stage,panel]=frames, gapPt=panel.left-stage.right, overlaps=gapPt<0;
      assert.equal(overlaps,mode==='before-vector',`${name} ${mode} p${i+1}: outer-frame overlap`);
      checked.push({page:i+1,stage,panel,gapPt,gapMm:gapPt*25.4/72,overlaps,pass:true});
    }
    results.push({name,mode,pages:pages.length,checks:checked,pass:true});
  }
}
const report={units:'PDF points after all matrices, including the 20pt page margin and fit',results,pass:results.every(r=>r.pass)};
await writeFile(`${directory}/pdf-outer-frame-coordinates.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({pass:report.pass,files:results.length,pages:results.reduce((n,r)=>n+r.pages,0),
  fixedMinimumGapMm:Math.min(...results.filter(r=>r.mode==='vector').flatMap(r=>r.checks.map(c=>c.gapMm)))},null,2));
