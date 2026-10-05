import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const origin=process.env.REPOSITORY_TEST_ORIGIN ?? 'http://127.0.0.1:5179';
assert(new URL(origin).protocol==='http:' && ['127.0.0.1','localhost'].includes(new URL(origin).hostname));
const base=JSON.parse(await readFile('src/repositories/contract/fixtures/commitProjects.json','utf8')).stage;
const browser=await chromium.launch({headless:true});
try {
  for(const ipad of [false,true]) {
    const context=await browser.newContext({viewport:ipad?{width:1032,height:1376}:{width:1440,height:1000}});
    try {
      const page=await context.newPage(), errors=[]; page.on('pageerror', e=>errors.push(e.message));
      await context.route(`${origin}/__preview_seed`,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Anonymous preview test</title>'}));
      await page.goto(`${origin}/__preview_seed`);
      await page.evaluate(async base=>{
        const {IndexedDbProjectRepository}=await import('/src/repositories/indexedDbRepository.ts');
        const project={...base,id:'preview-test',title:'匿名小窓試験',audio:null,members:Array.from({length:200},(_,i)=>({id:`m-${i}`,name:`匿名${i}`,color:'#009966'}))};
        project.frames=Array.from({length:45},(_,f)=>({...base.frames[0],id:`frame-${f}`,label:`シーン${f+1}`,timeSec:f*8,positions:Object.fromEntries(project.members.map((m,i)=>[m.id,{x:1+i%20*.5,y:1+Math.floor(i/20)*.5}])),objectAssignments:{},memberVisibility:{}}));
        const r=new IndexedDbProjectRepository();await r.initialize();await r.commit({project,localRevision:'1',expectedRepositoryRevision:null,operationId:'seed'});r.close();
      },base);
      await page.goto(origin+(ipad?'/?runtime=capacitor-ios':''));
      await page.getByRole('button',{name:'匿名小窓試験を開く',exact:true}).click();
      const cards=page.locator('.scene-thumbnail-card'); await expect(cards).toHaveCount(45);
      await expect(cards.first().locator('circle')).toHaveCount(200);
      await expect(cards.last().locator('circle')).toHaveCount(0);
      assert((await page.locator('.scene-thumbnail-preview circle').count())<9000);
      // The last button stays keyboard/click accessible before its SVG is populated.
      await cards.last().click();await expect(cards.last()).toHaveClass(/is-active/);
      await expect(cards.last().locator('circle')).toHaveCount(200);
      await expect(cards.first().locator('circle')).toHaveCount(0);
      const rootBefore=await page.evaluate(()=>({top:document.scrollingElement.scrollTop,left:document.scrollingElement.scrollLeft}));
      await page.getByTitle('シーンサムネイルを閉じる',{exact:true}).click();
      await page.getByTitle('シーンサムネイルを開く',{exact:true}).click();
      await expect(cards.last()).toHaveClass(/is-active/); await expect(cards.last().locator('circle')).toHaveCount(200);
      if(ipad) { await page.setViewportSize({width:1376,height:1032}); await expect(cards.last().locator('circle')).toHaveCount(200); }
      assert.deepEqual(await page.evaluate(()=>({top:document.scrollingElement.scrollTop,left:document.scrollingElement.scrollLeft})),rootBefore);
      assert.deepEqual(errors,[]);console.log(`PASS deferred previews ${ipad?'ipad portrait + landscape':'web'}`);
    } finally {await context.close();}
  }
} finally {await browser.close();}
