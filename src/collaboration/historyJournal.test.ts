// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { webcrypto } from 'node:crypto';
import { nativeHistoryJournal, type HistoryOperation } from './historyJournal';
const state=vi.hoisted(()=>({files:new Map<string,string>(),failRename:false,failCleanup:false}));
vi.mock('@capacitor/filesystem',()=>({Directory:{LibraryNoCloud:'private-library'},Encoding:{UTF8:'utf8'},Filesystem:{
  readdir:vi.fn(async({path,directory})=>{expect(directory).toBe('private-library');const files=[...state.files.keys()].filter(p=>p.startsWith(path+'/')).map(p=>({name:p.slice(path.length+1)}));if(!files.length)throw{code:'OS-PLUG-FILE-0008'};return{files};}),
  readFile:vi.fn(async({path})=>({data:state.files.get(path)})),
  writeFile:vi.fn(async({path,data,directory})=>{expect(directory).toBe('private-library');state.files.set(path,data);}),
  rename:vi.fn(async({from,to})=>{if(state.failRename)throw{code:'OS-PLUG-FILE-0013'};state.files.set(to,state.files.get(from)!);state.files.delete(from);}),
  deleteFile:vi.fn(async({path})=>{if(state.failCleanup)throw Error('cleanup');state.files.delete(path);}),
}}));
const operation=(revision:number):HistoryOperation=>({version:1,revision,copy:{checkpointId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',request:{} as never,message:'試験',saved:false}});
beforeEach(()=>{state.files.clear();state.failRename=false;state.failCleanup=false;vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('navigator',{locks:{request:async(_key:string,work:()=>Promise<void>)=>work()}});});
afterEach(()=>vi.unstubAllGlobals());
describe('9d private native operation publication',()=>{
  it('publishes immutable revisions under private Application Support and reopens the newest; retains two',async()=>{
    expect(await nativeHistoryJournal.read('document-a')).toBeNull();
    for(let i=1;i<=4;i++)await nativeHistoryJournal.write('document-a',i-1,operation(i));
    expect(await nativeHistoryJournal.read('document-a')).toEqual(operation(4));expect(state.files.size).toBe(2);expect([...state.files.keys()].every(p=>p.startsWith('Application Support/collaboration-operations/'))).toBe(true);
  });
  it('a stopped rename leaves an ignored temporary file; the previous intent survives',async()=>{
    await nativeHistoryJournal.write('document-a',0,operation(1));state.failRename=true;
    await expect(nativeHistoryJournal.write('document-a',1,operation(2))).rejects.toMatchObject({code:'IO_ERROR'});
    expect(await nativeHistoryJournal.read('document-a')).toEqual(operation(1));state.failRename=false;await nativeHistoryJournal.write('document-a',1,operation(2));expect((await nativeHistoryJournal.read('document-a'))?.revision).toBe(2);
  });
  it('never falls back to an older request after a corrupt newest revision, and isolates another key',async()=>{
    await nativeHistoryJournal.write('document-a',0,operation(1));await nativeHistoryJournal.write('document-a',1,operation(2));await nativeHistoryJournal.write('document-b',0,operation(1));
    const newest=[...state.files.keys()].find(p=>p.includes('/000000000002-'))!;state.files.set(newest,'{broken');
    await expect(nativeHistoryJournal.read('document-a')).rejects.toMatchObject({code:'CORRUPT'});expect((await nativeHistoryJournal.read('document-b'))?.revision).toBe(1);
  });
  it('fences stale revisions and refuses mutation without cross-view locking',async()=>{
    await nativeHistoryJournal.write('document-a',0,operation(1));await expect(nativeHistoryJournal.write('document-a',0,operation(1))).rejects.toMatchObject({code:'CONFLICT'});
    vi.stubGlobal('navigator',{});await expect(nativeHistoryJournal.write('document-a',1,operation(2))).rejects.toMatchObject({code:'UNSUPPORTED_SCHEMA'});expect((await nativeHistoryJournal.read('document-a'))?.revision).toBe(1);
  });
  it('cleanup failure cannot erase the published request',async()=>{
    state.failCleanup=true;for(let i=1;i<=3;i++)await nativeHistoryJournal.write('document-a',i-1,operation(i));expect((await nativeHistoryJournal.read('document-a'))?.revision).toBe(3);
  });
});
