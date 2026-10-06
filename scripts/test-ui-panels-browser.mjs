import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fixture, openFixture } from './measure-member-labels.mjs';

const output='C:/Users/shing/AppData/Local/Temp/claude/c--Users-shing-OneDrive--------ChatGPT-------/e5aa9c38-eb07-490c-ac06-62f047c4c161/scratchpad/shots-panel';
const origin='http://127.0.0.1:5377';
const server=await createServer({envFile:false,server:{host:'127.0.0.1',port:5377,strictPort:true},logLevel:'warn'});
await server.listen();const browser=await chromium.launch({headless:true});const results=[];const errors=[];
function panelFixture(grouped){
  const p=fixture(24);p.id=`panel-${grouped}`;p.title=`架空パネル${grouped}`;p.memberGroups=[];p.objectGroups=[];
  p.members[0].name='架空のとても長い名前を省略せず全文確認するメンバー';
  p.stageObjects=p.members.map((m,i)=>({id:`o${i}`,name:i===0?'架空のとても長い名前を省略せず全文確認する道具':`架空道具${i+1}`,color:'#e87924',type:'prop',shape:'rectangle',widthMeters:.3,heightMeters:.3,defaultX:1,defaultY:9,defaultRotation:0,visible:true,locked:false,zIndex:10}));
  p.frames[0].memberVisibility=Object.fromEntries(p.members.map((m,i)=>[m.id,i%3!==2]));
  p.frames[0].objectStates=Object.fromEntries(p.stageObjects.map((o,i)=>[o.id,{objectId:o.id,x:1+i*.4,y:9,widthMeters:.3,heightMeters:.3,rotation:0,visible:i%3!==2,zIndex:10}]));
  if(grouped){
    p.memberGroups=[{id:'g1',name:'青グループ',color:'#2563eb',memberIds:p.members.slice(0,10).map(m=>m.id)},{id:'g2',name:'緑グループ',color:'#0f766e',memberIds:p.members.slice(10,18).map(m=>m.id)},{id:'empty',name:'空グループ',memberIds:[]}];
    p.objectGroups=p.memberGroups.map(g=>({id:g.id,name:g.name,color:g.color,objectIds:g.memberIds.map(id=>id.replace('m','o'))}));
  }return p;
}
async function top(page){await page.locator('.tab-panel__content').evaluate(e=>e.scrollTop=0);await page.waitForTimeout(80);}
try{
 await fs.mkdir(output,{recursive:true});
 for(const native of (process.env.PANEL_MOVEMENT_ONLY?[]:[true,false]))for(const [width,height] of (native?[[1376,1032],[1032,1376]]:[[1376,1032]]))for(const grouped of [true,false]){
  const prefix=native?'':'web-';const p=panelFixture(grouped);const {context,page}=await openFixture(browser,origin,p,{width,height},native);page.on('pageerror',e=>errors.push(e.message));
  for(const [kind,label] of [['members','メンバー'],['objects','道具']]){
   await page.getByRole('tab',{name:label,exact:true}).click();await top(page);
   const picker=page.locator('.scene-visibility-picker'),owner=picker.locator('.scene-visibility-picker__scroll');
   await expect(picker.locator('.scene-visibility-chip')).toHaveCount(24);
   const geometry=await picker.evaluate(e=>{
    const owner=e.querySelector('.scene-visibility-picker__scroll'),grid=e.querySelector('.scene-visibility-picker__grid');
    return {portrait:e.classList.contains('is-portrait'),overflow:getComputedStyle(owner).overflowY,width:owner.clientWidth,scrollWidth:owner.scrollWidth,height:owner.clientHeight,columns:getComputedStyle(grid).gridTemplateColumns,
      heading:[...e.querySelectorAll('.scene-visibility-picker__group-heading')].map(h=>h.textContent),
      hits:[...e.querySelectorAll('.scene-visibility-chip__check,.scene-visibility-chip__name')].map(b=>({w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height})),
      gray:getComputedStyle(e.querySelector('.is-hidden .scene-visibility-chip__name')).color};
   });
   assert(geometry.hits.every(b=>b.w>=44&&b.h>=44));
   assert(!geometry.heading.some(h=>h.includes('空グループ')));assert(geometry.heading.at(-1).includes('未所属'));
   assert.equal(geometry.gray,'rgb(100, 116, 139)');
   if(width>height){assert(!geometry.portrait);assert.equal(geometry.overflow,'auto');assert(geometry.scrollWidth<=geometry.width+1);assert.equal(geometry.columns.split(' ').length,2);assert.equal(geometry.height,280);}
   const name=kind==='members'?p.members[0].name:p.stageObjects[0].name;
   await picker.getByRole('button',{name,exact:true}).click();await expect(picker.locator('.scene-visibility-picker__info')).toContainText(name);
   const info=await picker.locator('.scene-visibility-picker__info').evaluate(e=>({width:e.clientWidth,scrollWidth:e.scrollWidth,right:e.getBoundingClientRect().right,panelRight:e.closest('.tab-panel__content').getBoundingClientRect().right}));assert(info.scrollWidth<=info.width+1);assert(info.right<=info.panelRight+1);
   if(native && grouped) await page.screenshot({path:`${output}/${prefix}${width}x${height}-${kind}-${grouped?'groups':'ungrouped'}.png`});
   const groupHeading=page.getByText('グループ一覧',{exact:true});
   await groupHeading.evaluate(e=>{const owner=e.closest('.tab-panel__content');const sticky=parseFloat(getComputedStyle(owner).getPropertyValue('--panel-sticky-height'))||0;owner.scrollTop+=e.getBoundingClientRect().top-owner.getBoundingClientRect().top-sticky-16;});await page.waitForTimeout(80);
   if(native && grouped && width>height) await page.screenshot({path:`${output}/${prefix}${width}x${height}-${kind}-groups-management.png`});
   if(grouped){const remove=page.getByRole('button',{name:'グループ「青グループ」を削除',exact:true});const b=await remove.boundingBox();assert(b.width>=44&&b.height>=44);assert.equal(await remove.textContent(),'');
     await remove.click();const dialog=page.getByRole('dialog');await expect(dialog).toContainText('削除しますか');await dialog.getByRole('button',{name:'キャンセル',exact:true}).click();await expect(remove).toHaveCount(1);
   }
   await top(page);
   await picker.getByRole('button',{name:'すべて非表示',exact:true}).click();await expect(picker.locator('input:checked')).toHaveCount(0);
   await picker.getByRole('button',{name:'すべて表示',exact:true}).click();await expect(picker.locator('input:checked')).toHaveCount(24);
   if(width>height){await owner.evaluate(e=>e.scrollTop=90);await page.getByRole('tab',{name:kind==='members'?'道具':'メンバー',exact:true}).click();await page.getByRole('tab',{name:label,exact:true}).click();await expect(owner).toHaveJSProperty('scrollTop',90);}
   const {hits,...summary}=geometry; results.push({viewport:{width,height},native,grouped,kind,...summary,minHitWidth:Math.min(...hits.map(b=>b.w)),minHitHeight:Math.min(...hits.map(b=>b.h))});
  }
  if(native&&grouped&&width===1376){
    await page.getByRole('tab',{name:'メンバー',exact:true}).click();await top(page);
    await page.setViewportSize({width:1032,height:1376});await page.getByRole('searchbox').fill('全文確認');await expect(page.locator('.scene-visibility-chip')).toHaveCount(1);
    await page.setViewportSize({width:1376,height:1032});await expect(page.locator('.scene-visibility-chip')).toHaveCount(24);await expect(page.getByRole('searchbox')).toHaveCount(0);
    await page.setViewportSize({width:1032,height:1376});await expect(page.getByRole('searchbox')).toHaveValue('全文確認');await expect(page.locator('.scene-visibility-chip')).toHaveCount(1);
  }
  await context.close();console.log(`PASS panels ${width}x${height} grouped=${grouped}`);
 }
 // Confirmed deletion removes only the group; all entries remain available.
 const p=panelFixture(true),s=await openFixture(browser,origin,p,{width:1376,height:1032});
 for(const label of ['メンバー','道具']){
   await s.page.getByRole('tab',{name:label,exact:true}).click();const remove=s.page.getByRole('button',{name:'グループ「青グループ」を削除',exact:true});await remove.click();await s.page.getByRole('dialog').getByRole('button',{name:'削除する',exact:true}).click();await expect(remove).toHaveCount(0);await expect(s.page.locator('.scene-visibility-chip')).toHaveCount(24);
 }await s.context.close();assert.deepEqual(errors,[]);
 // Regression for the memoized stage tokens: commit, multi-drag, history and reload.
 const movementProject=fixture(200);
 // Keep other members clear of the path so the mouse hits the selected pair.
 for(let i=2;i<200;i++)movementProject.frames[0].positions['m'+i]={x:1+(i%20)*.6,y:1+Math.floor(i/20)*.15};
 const movement=await openFixture(browser,origin,movementProject,{width:1376,height:1032});
 const mp=movement.page;
 const m0=mp.locator('.stage-surface').getByRole('button',{name:'架空001',exact:true}),m1=mp.locator('.stage-surface').getByRole('button',{name:'架空002',exact:true});
 const position=loc=>loc.evaluate(e=>({left:e.style.left,top:e.style.top}));
 const initial=await position(m0);
 const drag=async()=>{const b=await m0.boundingBox();await mp.mouse.move(b.x+b.width/2,b.y+b.height/2);await mp.mouse.down();await mp.mouse.move(b.x+b.width/2+30,b.y+b.height/2+15,{steps:5});await mp.waitForTimeout(80);await mp.mouse.up();};
 await drag();await expect.poll(()=>position(m0)).not.toEqual(initial);const single=await position(m0);
 await mp.keyboard.press('Control+z');await expect.poll(()=>position(m0)).toEqual(initial);
 await mp.keyboard.press('Control+y');await expect.poll(()=>position(m0)).toEqual(single);
 await mp.locator('.group-card').getByRole('button',{name:'選択',exact:true}).click();await top(mp);
 await expect(mp.locator('.member-token.is-selected')).toHaveCount(2);
 const beforePair=await position(m1);await drag();await expect.poll(()=>position(m1)).not.toEqual(beforePair);
 const finalPair=await position(m1),finalFirst=await position(m0);
 await mp.locator('.toolbar-save-button').click();await mp.waitForTimeout(350);await mp.reload();
 await mp.getByRole('button',{name:movementProject.title+'を開く',exact:true}).click();
 await expect.poll(()=>position(m0)).toEqual(finalFirst);await expect.poll(()=>position(m1)).toEqual(finalPair);
 await movement.context.close();results.push({check:'stage-token single/multi drag, Undo/Redo, save/reload',pass:true});
 console.log('PASS stage token movement, history, save/reload');
 if(process.env.PANEL_MOVEMENT_ONLY)results.unshift(...JSON.parse(await fs.readFile('docs/ui-panel-browser-results.json','utf8')));
 await fs.writeFile('docs/ui-panel-browser-results.json',JSON.stringify(results,null,2));console.log(`PASS panel matrix, rotation, all visibility, cancel/confirm; screenshots ${output}`);
}finally{await browser.close();await server.close();}
