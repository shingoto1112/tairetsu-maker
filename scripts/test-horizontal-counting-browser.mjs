import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const origin='http://127.0.0.1:5188';
const shotDir=process.env.COUNTING_SHOT_DIR ?? 'C:/Users/shing/AppData/Local/Temp/claude/c--Users-shing-OneDrive--------ChatGPT-------/e5aa9c38-eb07-490c-ac06-62f047c4c161/scratchpad/shots-counting';
const sizes=[[744,1133],[1133,744],[1032,1376],[1376,1032],[390,844]];
const vite=await createServer({envFile:false,server:{host:'127.0.0.1',port:5188,strictPort:true},logLevel:'warn'});
await vite.listen();const browser=await chromium.launch({headless:true});const results=[],errors=[];
try {
 await mkdir(shotDir,{recursive:true});
 for(const [width,height] of sizes) {
  const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const url=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(url.hostname)||['data:','blob:'].includes(url.protocol)?route.continue():route.abort();});
  await page.goto(origin);await expect(page.locator('.library-shell')).toBeVisible();
  for(const mode of ['stage','parade']) {
   await page.locator('.formation-card--new').click();await page.getByRole('button',{name:/新しく作る/}).click();
   await page.getByRole('button',{name:mode==='stage'?/ステージ隊列/:/パレード隊列/}).click();
   const dialog=page.getByRole('dialog',{name:'新しい隊列表を作成'}),radios=dialog.getByRole('radio');
   await expect(radios.nth(1)).toBeChecked();await dialog.getByRole('textbox',{name:'隊列表名'}).fill('検証'+mode);
   const snap=async(name)=>{
    const geometry=await dialog.evaluate(el=>{const r=el.getBoundingClientRect();const cards=[...el.querySelectorAll('.counting-card')].map(c=>{const b=c.getBoundingClientRect();return {left:b.left,right:b.right,width:b.width,top:b.top,bottom:b.bottom};});return {left:r.left,right:r.right,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,cards};});
    assert.ok(geometry.left>=0&&geometry.right<=width+1);assert.ok(geometry.scrollWidth<=geometry.clientWidth+1,'dialog horizontal overflow');
    if(width===390)assert.ok(geometry.cards[1].top>=geometry.cards[0].bottom,'mobile cards must stack');
    await page.screenshot({path:path.join(shotDir,name+'-'+width+'x'+height+'.png')});results.push({name,width,height,geometry});
   };
   await snap(mode+'-split');
   await radios.nth(1).focus();await page.keyboard.press('ArrowLeft');await expect(radios.nth(0)).toBeChecked();
   await page.keyboard.press('ArrowRight');await expect(radios.nth(1)).toBeChecked();
   await radios.nth(0).focus();await page.keyboard.press('Space');await expect(radios.nth(0)).toBeChecked();
   await snap(mode+'-meters');
   await dialog.locator('summary').click();await dialog.locator('[name="memberDiameterMeters"]').scrollIntoViewIfNeeded();await snap(mode+'-advanced');
   await expect(dialog.locator(mode==='stage'?'[name="gridSizeMeters"]':'[name="paradeCellSizeMeters"]')).toHaveValue(mode==='stage'?'0.5':'1');
   const diameter=dialog.locator('[name="memberDiameterMeters"]');await diameter.fill('0');await dialog.locator('summary').click();
   await dialog.getByRole('button',{name:'作成する'}).click();await expect(dialog.locator('details')).toHaveAttribute('open','');await expect(diameter).toBeFocused();await expect(diameter).toHaveAttribute('aria-invalid','true');await snap(mode+'-error');
   await diameter.fill('0.5');await dialog.getByRole('button',{name:'作成する'}).click();await expect(page.locator('.toolbar')).toBeVisible();
   const ruler=page.locator(mode==='stage'?'.meter-ruler--horizontal':'.parade-horizontal-ruler').first();await expect(ruler).toBeVisible();
   const texts=await ruler.locator('span').allTextContents();assert.ok(texts.every(s=>/^\d+$/.test(s)),JSON.stringify(texts));
   const notice=page.getByRole('button',{name:'お知らせを閉じる',exact:true});if(await notice.count())await notice.click();
   await page.screenshot({path:path.join(shotDir,mode+'-editor-meters-'+width+'x'+height+'.png')});
   results.push({name:mode+'-editor',width,height,texts});
   await page.getByRole('tab',{name:'ステージ',exact:true}).click();
   const settingCards=page.getByRole('group',{name:'横の数え方'});await settingCards.getByRole('radio').nth(1).check();
   await expect(ruler.locator('span').first()).toHaveText(mode==='stage'?'6':'10');
   await page.screenshot({path:path.join(shotDir,mode+'-editor-split-'+width+'x'+height+'.png')});
   if(width===744) {
    const exported=await page.evaluate(async mode=>{
      const {formationExportFixture}=await import('/src/utils/formationExportFixture.ts');
      const {createHorizontalRulerLabels}=await import('/src/utils/horizontalRuler.ts');
      const {generateA4Document}=await import('/scripts/testing/export-a4.tsx');
      const outputs=[];
      for(const counting of ['meters','centerSplit']) {
        const project=formationExportFixture();project.mode=mode;project.frames=project.frames.slice(0,1);project.stage.widthMeters=13;project.stage.horizontalGuideMode=counting;
        project.paradeSettings={totalDistance:100,width:13,cellSizeMeters:1,direction:'up',rulerPosition:'both',horizontalMeasureMode:counting==='meters'?'normalMeter':'centerSplit',emphasizeEvery5m:true,emphasizeEvery10m:true};
        const expected=createHorizontalRulerLabels(13,counting).map(item=>item.label),seen=[];
        const observer=new MutationObserver(()=>{document.querySelectorAll('.print-document.is-exporting .print-ruler-x').forEach(el=>seen.push([...el.children].map(child=>child.textContent)));});observer.observe(document.body,{subtree:true,childList:true});
        try {
          for(const format of ['png','pdf']) {
            const result=await generateA4Document(project, format);
            const file=result.files[0],base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});
            outputs.push({mode,counting,format,pageCount:result.pageCount,bytes:file.size,type:file.type,base64});
          }
          if(!seen.length||seen.some(labels=>JSON.stringify(labels)!==JSON.stringify(expected)))throw Error('export ruler mismatch '+mode+' '+counting);
        } finally {observer.disconnect();}
      }
      return outputs;
    },mode);
    for(const item of exported) {assert.ok(item.bytes>1000);await writeFile(path.join(shotDir,'export-'+item.mode+'-'+item.counting+'.'+item.format),Buffer.from(item.base64,'base64'));delete item.base64;results.push(item);}
   }
   await page.getByRole('button',{name:'隊列一覧へ戻る',exact:true}).click();await expect(page.locator('.library-shell')).toBeVisible();
  }
  await context.close();
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(shotDir,'results.json'),JSON.stringify(results,null,2));console.log('COUNTING_BROWSER: PASS; '+results.length+' checks; '+shotDir);
} finally {await browser.close();await vite.close();}
