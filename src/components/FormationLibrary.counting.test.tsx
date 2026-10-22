// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { FormationLibrary } from "./FormationLibrary";
import { createEmptyFormationProject } from "../project/createEmptyFormationProject";
import { normalizeProject } from "../project/normalizeProject";
afterEach(cleanup);
const setup=()=>{const onCreate=vi.fn();render(<FormationLibrary projects={[]} onCreate={onCreate} onOpenProject={vi.fn()} onRenameProject={vi.fn()} onDuplicateProject={vi.fn()} onExportProject={vi.fn()} onImportProjectFile={vi.fn()} onDeleteProject={vi.fn()}/>);return onCreate;};
const open=async(mode:string)=>{await userEvent.click(screen.getByRole('button',{name:/追加/}));await userEvent.click(screen.getByRole('button',{name:/新しく作る/}));await userEvent.click(screen.getByRole('button',{name:mode==='stage'?/ステージ隊列/:/パレード隊列/}));};
it('rejects parade creation above 500m with an accessible reason and accepts 500m', async () => {
 const create=setup(); await open('parade');
 fireEvent.change(screen.getByRole('textbox',{name:'隊列表名'}),{target:{value:'上限'}});
 const distance=screen.getByRole('spinbutton',{name:'全体距離'});
 fireEvent.change(distance,{target:{value:'501'}});
 fireEvent.submit(screen.getByRole('dialog',{name:'新しい隊列表を作成'}));
 expect(create).not.toHaveBeenCalled(); expect(distance.getAttribute('aria-invalid')).toBe('true');
 expect(document.getElementById(distance.getAttribute('aria-describedby')!)?.textContent).toContain('500m');
 fireEvent.change(distance,{target:{value:'500'}});
 fireEvent.submit(screen.getByRole('dialog',{name:'新しい隊列表を作成'}));
 expect(create).toHaveBeenCalledOnce(); expect(create.mock.calls[0][0].paradeSettings.totalDistance).toBe(500);
});
for(const mode of ['stage','parade']) {
 it(mode+' defaults and reset use split; first choice saves existing values',async()=>{
  const create=setup();await open(mode);
  expect((screen.getAllByRole('radio')[1] as HTMLInputElement).checked).toBe(true);
  await userEvent.click(screen.getAllByRole('radio')[0]);await userEvent.click(screen.getByRole('button',{name:'キャンセル'}));await open(mode);
  expect((screen.getAllByRole('radio')[1] as HTMLInputElement).checked).toBe(true);
  await userEvent.type(screen.getByRole('textbox',{name:'隊列表名'}),'テスト');await userEvent.click(screen.getAllByRole('radio')[0]);await userEvent.click(screen.getByRole('button',{name:'作成する'}));
  expect(create).toHaveBeenCalledOnce();const input=create.mock.calls[0][0];
  expect(mode==='stage'?input.horizontalGuideMode:input.paradeSettings.horizontalMeasureMode).toBe(mode==='stage'?'meters':'normalMeter');
 });
 // A7: 0.2m is the normalizer's retained minimum for member circles.
 it(mode+' reveals hidden errors, links descriptions and focuses invalid input',async()=>{
  const create=setup();await open(mode);await userEvent.type(screen.getByRole('textbox',{name:'隊列表名'}),'テスト');
  const details=document.querySelector('details')!;details.open=true;fireEvent(details,new Event('toggle'));
  const input=document.querySelector<HTMLInputElement>('[name="memberDiameterMeters"]')!;
  fireEvent.change(input,{target:{value:'0'}});details.open=false;fireEvent(details,new Event('toggle'));
  fireEvent.submit(screen.getByRole('dialog',{name:'新しい隊列表を作成'}));
  await waitFor(()=>expect(details.open).toBe(true));await waitFor(()=>expect(document.activeElement).toBe(input));
  expect(input.getAttribute('aria-invalid')).toBe('true');expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toContain('0.2');expect(create).not.toHaveBeenCalled();
 });
}

for(const mode of ['stage','parade']) it(mode+' creates with the new split default',async()=>{
 const create=setup();await open(mode);await userEvent.type(screen.getByRole('textbox',{name:'隊列表名'}),'既定値');await userEvent.click(screen.getByRole('button',{name:'作成する'}));
 expect(create).toHaveBeenCalledOnce();const input=create.mock.calls[0][0];expect(mode==='stage'?input.horizontalGuideMode:input.paradeSettings.horizontalMeasureMode).toBe('centerSplit');
 // New parades start 10m wide with 0.5m cells (2026-10-06).
 if(mode==='parade'){expect(input.paradeSettings.width).toBe(10);expect(input.paradeSettings.cellSizeMeters).toBe(.5);expect(input.widthMeters).toBe(10);}
});
it('validates all fields and reveals hidden errors while focusing the first visible error',async()=>{
 const create=setup();await open('stage');await userEvent.type(screen.getByRole('textbox',{name:'隊列表名'}),'検証');
 fireEvent.change(screen.getByRole('spinbutton',{name:'横幅'}),{target:{value:''}});
 const grid=document.querySelector<HTMLInputElement>('[name="gridSizeMeters"]')!;fireEvent.change(grid,{target:{value:'-1'}});
 fireEvent.submit(screen.getByRole('dialog',{name:'新しい隊列表を作成'}));
 await waitFor(()=>expect(document.querySelector('details')!.open).toBe(true));
 await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('spinbutton',{name:'横幅'})));
 expect(grid.getAttribute('aria-invalid')).toBe('true');expect(create).not.toHaveBeenCalled();
});

const numberCases = [
 ['stage', 'widthMeters', 1, undefined], ['stage', 'heightMeters', 1, undefined],
 ['stage', 'gridSizeMeters', .1, undefined], ['stage', 'memberDiameterMeters', .2, 1],
 ['parade', 'paradeTotalDistance', 1, 500], ['parade', 'paradeWidthMeters', 1, undefined],
 ['parade', 'paradeCellSizeMeters', .1, undefined], ['parade', 'memberDiameterMeters', .2, 1],
] as const;
it.each(numberCases)('A7: %s %s rejects out of range/blank and retains boundaries through factory/reload', async (mode, name, min, max) => {
 const create = setup(); await open(mode);
 fireEvent.change(screen.getByRole('textbox', { name: '隊列表名' }), { target: { value: '境界' } });
 const input = document.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
 expect(input.min).toBe(String(min));
 if (name === 'memberDiameterMeters') expect(input.max).toBe('1');
 for (const value of ['', String(min - .01), ...(max === undefined ? [] : [String(max + .01)])]) {
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(screen.getByRole('dialog', { name: '新しい隊列表を作成' }));
  expect(create).not.toHaveBeenCalled(); expect(input.getAttribute('aria-invalid')).toBe('true');
 }
 // Each successful submission closes the dialog; reopen for the upper boundary.
 for (const value of [min, ...(max === undefined ? [] : [max])]) {
  const field = document.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  fireEvent.change(screen.getByRole('textbox', { name: '隊列表名' }), { target: { value: '境界' } });
  fireEvent.change(field, { target: { value: String(value) } });
  fireEvent.submit(screen.getByRole('dialog', { name: '新しい隊列表を作成' }));
  await waitFor(() => expect(create).toHaveBeenCalled());
  const settings = create.mock.calls[create.mock.calls.length - 1][0];
  const project = createEmptyFormationProject(settings.title, settings, null);
  const normalized = normalizeProject(project);
  const reload = normalizeProject(JSON.parse(JSON.stringify(normalized)));
  const actual = name === 'memberDiameterMeters' ? project.stage.memberDiameterMeters
   : name === 'gridSizeMeters' ? project.stage.gridSizeMeters
   : name === 'heightMeters' ? project.stage.depthMeters
   : name === 'paradeTotalDistance' ? project.paradeSettings!.totalDistance
   : name === 'paradeCellSizeMeters' ? project.paradeSettings!.cellSizeMeters
   : project.stage.widthMeters;
  const dimensions = (p: typeof project) => [p.stage.widthMeters, p.stage.depthMeters, p.stage.gridSizeMeters, p.stage.memberDiameterMeters];
  expect(actual).toBe(value); expect(dimensions(normalized)).toEqual(dimensions(project));
  expect(dimensions(reload)).toEqual(dimensions(project)); expect(reload.paradeSettings).toEqual(project.paradeSettings);
  create.mockClear();
  if (value !== max && max !== undefined) {
   await waitFor(() => expect(screen.queryByRole('dialog', { name: '新しい隊列表を作成' })).toBeNull());
   await open(mode);
  }
 }
});
