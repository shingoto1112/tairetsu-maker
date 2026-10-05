import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const round12Dimensions = [[744,1133],[1133,744],[834,1210],[1210,834],[1032,1376],[1376,1032],[390,844]];
// Optional evidence capture for existing suites. No network or application mutations.
export async function checkRound12Layout(page, label, selector) {
  if (!process.env.ROUND12_SHOT_DIR) return;
  const geometry = await page.evaluate(selector => {
    const rect = el => { const r = el.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height }; };
    const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    const root = document.querySelector(selector);
    if (!root) throw Error(`Missing ${selector}`);
    const buttons = [...root.querySelectorAll('button, summary, .collab-status-pill, .remote-avatar, p, h2, h3, label, time, small, .help-page-content li')].filter(visible).map(el => {
      const range = document.createRange(); range.selectNodeContents(el);
      return { label:el.textContent, box:rect(el), strictHeight:el.matches('button, summary, .collab-status-pill, .remote-avatar'), clientWidth:el.clientWidth, scrollWidth:el.scrollWidth,
        text:[...range.getClientRects()].filter(r => r.width && r.height).map(r => ({left:r.left,right:r.right,top:r.top,bottom:r.bottom})) };
    });
    const bar = document.querySelector('.toolbar');
    const controls = bar ? [...bar.querySelectorAll(':scope > .toolbar__brand > *')].filter(visible).map(el => ({label:el.getAttribute('aria-label') || el.textContent,box:rect(el)})) : [];
    return { viewport:{width:innerWidth,height:innerHeight}, root:rect(root), clientWidth:root.clientWidth, scrollWidth:root.scrollWidth, buttons, controls };
  }, selector);
  const {width,height} = geometry.viewport;
  assert(geometry.root.left >= -.5 && geometry.root.right <= width + .5, `${label}: root outside viewport`);
  assert(geometry.scrollWidth <= geometry.clientWidth + 1, `${label}: root horizontal overflow`);
  for (const item of geometry.buttons) {
    assert(item.scrollWidth <= item.clientWidth + 1, `${label}: button overflow ${JSON.stringify(item)}`);
    // Normal heading glyphs can extend beyond their CSS line box without clipping.
    // Button/status boxes have padding and must contain the complete text vertically.
    for (const r of item.text) assert(r.left >= item.box.left - 1 && r.right <= item.box.right + 1 && (!item.strictHeight || r.top >= item.box.top - 1 && r.bottom <= item.box.bottom + 1),
      `${label}: text clipped ${JSON.stringify(item)}`);
  }
  for (let i=0;i<geometry.controls.length;i++) {
    const a=geometry.controls[i];
    assert(a.box.left >= -.5 && a.box.right <= width+.5 && a.box.top>=0 && a.box.bottom<=height, `${label}: toolbar outside viewport ${JSON.stringify(a)}`);
    for (const b of geometry.controls.slice(i+1)) {
      const area = Math.max(0,Math.min(a.box.right,b.box.right)-Math.max(a.box.left,b.box.left)) * Math.max(0,Math.min(a.box.bottom,b.box.bottom)-Math.max(a.box.top,b.box.top));
      assert(area <= 1, `${label}: toolbar overlap ${JSON.stringify({a,b,area})}`);
    }
  }
  await mkdir(process.env.ROUND12_SHOT_DIR,{recursive:true});
  await writeFile(path.join(process.env.ROUND12_SHOT_DIR,`${label}-${width}x${height}.geometry.json`),JSON.stringify(geometry,null,2));
}
