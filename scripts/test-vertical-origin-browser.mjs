import { chromium } from '@playwright/test';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
const out=path.join(os.tmpdir(), 'tairetsu-shots-vertical-origin');
await fs.mkdir(out,{recursive:true});
await fs.mkdir('output/origin-baseline',{recursive:true});
const baseline=execFileSync('git',['show','0af3211:src/components/PrintPreview.tsx']).toString().replaceAll('"../','"../../src/').replace('"./EmphasizedGrid"','"../../src/components/EmphasizedGrid"').replace('"./ShareExportModal"','"../../src/components/ShareExportModal"').replace('"../../src/utils/gridEmphasis"','"./gridEmphasis"');
await fs.writeFile('output/origin-baseline/PrintPreview.tsx',baseline);
await fs.writeFile('output/origin-baseline/gridEmphasis.ts',execFileSync('git',['show','0af3211:src/utils/gridEmphasis.ts']).toString().replaceAll('"../types"','"../../src/types"').replaceAll('"./','"../../src/utils/'));
await fs.copyFile('scripts/testing/vertical-origin-harness.tsx','output/origin-baseline/harness.tsx');const browser=await chromium.launch({headless:true});
try{const page=await browser.newPage();await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'||['data:','blob:'].includes(new URL(r.request().url()).protocol)?r.continue():r.abort());await page.goto('http://127.0.0.1:5198');
const show=async(k,o='top',d=12.5)=>page.evaluate(async([k,o,d])=>{const h=await import('/output/origin-baseline/harness.tsx');return h.show(k,o,d);},[k,o,d]);
const coords=()=>page.locator('.print-page, .print-scene, .print-stage-preview, .print-stage-area, .print-member, .print-object').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {class:e.className,style:e.getAttribute('style'),x:r.x,y:r.y,w:r.width,h:r.height};}));
const results=[];
const unchangedDrawing = () => page.locator('.print-document').evaluate(el => {
  const copy = el.cloneNode(true);
  copy.querySelectorAll('.print-ruler-y').forEach(el => el.replaceChildren());
  copy.querySelectorAll('.print-stage-guides line').forEach(el => {
    if (el.getAttribute('y1') === el.getAttribute('y2')) el.remove();
  });
  return copy.innerHTML;
});
for(const depth of [12,12.5]){await page.emulateMedia({media:'print'});await show('before','top',depth);const before=await coords();const unchanged=await unchangedDrawing();assert.ok(before.length>50);const beforePdf=await page.pdf({path:out+`/a4-before-${depth}.pdf`,preferCSSPageSize:true});const pageCount=buffer=>buffer.toString('latin1').split('/Type /Page').filter(x=>x.startsWith(' ')||x.startsWith('\n')||x.startsWith('\r')).length;const beforeCount=pageCount(beforePdf);assert.ok(beforeCount>0);for(const o of ['top','bottom']){await show('a4',o,depth);assert.deepEqual(await coords(),before);assert.equal(await unchangedDrawing(),unchanged);results.push({depth,origin:o,elements:before.length,coordinates:'identical'});await page.screenshot({path:out+`/a4-${o}-${depth}.png`,fullPage:true});const pdf=await page.pdf({path:out+`/a4-${o}-${depth}.pdf`,preferCSSPageSize:true});assert.equal(pageCount(pdf),beforeCount);results[results.length-1].pdfPages=beforeCount;} }
await page.emulateMedia({media:'screen'});
for(const [width,height] of [[744,1133],[1032,1376],[1376,1032],[390,844]]){await page.setViewportSize({width,height});for(const kind of ['sheet','share']){await page.reload();await show(kind);await page.getByRole('button',{name:'このシーンを書き出す',exact:false}).click();await page.screenshot({path:out+`/debug-${kind}-${width}.png`});await page.getByRole('radio',{name:'上を0mにする'}).waitFor();assert.equal(await page.getByRole('radio',{name:'上を0mにする'}).isChecked(),true);await page.getByRole('radio',{name:'上を0mにする'}).focus();await page.keyboard.press('ArrowRight');assert.equal(await page.getByRole('radio',{name:'下を0mにする'}).isChecked(),true);await page.screenshot({path:out+`/${kind}-${width}x${height}.png`});}}
await page.setViewportSize({width:1032,height:1376});for(const origin of ['top','bottom']){await show('static',origin);await page.locator('.static-stage-preview').screenshot({path:out+`/export-${origin}.png`});}
await fs.writeFile(out+'/a4-coordinate-results.json',JSON.stringify(results,null,2));console.log('ORIGIN_BROWSER PASS',results,out);
for (const origin of ['top', 'bottom']) {
  const files = await page.evaluate(async origin => {
    const { formationExportFixture } = await import('/src/utils/formationExportFixture.ts');
    const { generateA4Document } = await import('/scripts/testing/export-a4.tsx');
    const p = formationExportFixture(); p.stage.depthMeters = 12.5; p.frames = p.frames.slice(0, 1);
    const outputs = [];
    for (const format of ['png', 'pdf']) {
      const result = await generateA4Document(p, format, { verticalOrigin: origin });
      const data = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result.split(',')[1]); r.readAsDataURL(result.files[0]); });
      outputs.push({ format, data, pages: result.pageCount });
    }
    return outputs;
  }, origin);
  for (const file of files) { assert.ok(file.pages > 0); await fs.writeFile(`${out}/generated-${origin}.${file.format}`, Buffer.from(file.data, 'base64')); }
}
}finally{await browser.close();await fs.rm('output/origin-baseline',{recursive:true,force:true});}
