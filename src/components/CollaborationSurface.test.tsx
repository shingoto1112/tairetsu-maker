/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CollaborationSurface from './CollaborationSurface';
import { CollaborationUiService } from '../collaboration/uiService';
import type { CollaborationUiOptions } from '../collaboration/uiTypes';
import { SharedSessionStore } from '../storage/sharedSessionState';
import { forgetInvitation } from '../storage/invitationMemory';
import { installInvitationRouting } from '../collaboration/invitationRouting';
import { clearCloudAuthSession, saveCloudAuthSession } from '../cloud/session';

const link = `${location.origin}/#invite=${'a'.repeat(64)}`;
function setup(platform: 'web' | 'ipad' = 'web') {
  const options: CollaborationUiOptions = { config: null, platform, mock: true, repository: () => null, active: () => null,
    store: new SharedSessionStore(), summaries: () => [], open: vi.fn(), transform: vi.fn(), localRemoved: vi.fn() };
  const service = new CollaborationUiService(() => options);
  service.invitation('');
  render(<CollaborationSurface bridge={{ options, get: async () => service }} view="editor" />);
  return service;
}
beforeEach(() => { forgetInvitation(); history.replaceState({}, '', '/'); });
afterEach(() => { cleanup(); forgetInvitation(); vi.restoreAllMocks(); });
it('hides password change for guests and destroys credentials on account/screen changes', async () => {
  const options = { config:null,platform:'web',mock:true,repository:()=>null,active:()=>null,
    store:new SharedSessionStore(),summaries:()=>[],open:vi.fn(),transform:vi.fn(),localRemoved:vi.fn() } as CollaborationUiOptions;
  const service = new CollaborationUiService(()=>options);
  vi.spyOn(service,'initialize').mockResolvedValue();
  let snapshot: ReturnType<typeof service.getSnapshot> = { ...service.getSnapshot(), screen:'account',
    auth:{status:'signed-in',userId:'owner',isGuest:true,displayName:'ゲスト',sessionPersistence:'browser-data'} };
  vi.spyOn(service,'getSnapshot').mockImplementation(()=>snapshot);
  render(<CollaborationSurface bridge={{options,get:async()=>service}} view="editor" />);
  await screen.findByRole('dialog'); expect(screen.queryByRole('button',{name:'パスワードを変更'})).toBeNull();
  act(()=>{ snapshot={...snapshot,auth:{status:'signed-in',userId:'owner',isGuest:false,displayName:'本人',sessionPersistence:'existing-account'}}; service.account(); });
  fireEvent.click(await screen.findByRole('button',{name:'パスワードを変更'}));
  fireEvent.change(screen.getByLabelText('現在のパスワード'),{target:{value:'private-value'}});
  act(()=>{ clearCloudAuthSession(); saveCloudAuthSession({accessToken:'mock',refreshToken:'mock',expiresAt:Date.now()+3600000,tokenType:'bearer',user:{id:'other'}}); snapshot={...snapshot,auth:{...snapshot.auth,status:'signed-in',userId:'other',isGuest:false,sessionPersistence:'existing-account'}}; service.account(); });
  fireEvent.click(await screen.findByRole('button',{name:'パスワードを変更'})); expect((screen.getByLabelText('現在のパスワード') as HTMLInputElement).value).toBe('');
  fireEvent.change(screen.getByLabelText('現在のパスワード'),{target:{value:'private-value'}});
  act(()=>{ snapshot={...snapshot,screen:null};service.close(); });
  act(()=>{ snapshot={...snapshot,screen:'account'};service.account(); });
  fireEvent.click(await screen.findByRole('button',{name:'パスワードを変更'})); expect((screen.getByLabelText('現在のパスワード') as HTMLInputElement).value).toBe('');
  clearCloudAuthSession();
});
it('shows multi-use statuses/counts and preserves old single-use labels', async () => {
  const options: CollaborationUiOptions = { config:null,platform:'web',mock:true,repository:()=>null,
    active:()=>({attached:true,localId:'local'}) as ReturnType<CollaborationUiOptions['active']>,
    store:new SharedSessionStore(),summaries:()=>[],open:vi.fn(),transform:vi.fn(),localRemoved:vi.fn() };
  const service = new CollaborationUiService(()=>options);
  vi.spyOn(service,'initialize').mockResolvedValue();
  const snapshot: ReturnType<typeof service.getSnapshot> = { ...service.getSnapshot(),screen:'manage',
    auth:{status:'signed-in',userId:'owner',isGuest:false,displayName:'作成者',sessionPersistence:'existing-account'},
    members:[{userId:'owner',displayName:'作成者',isCreator:true,isGuest:false}],
    invites:[
      {inviteId:'a',expiresAt:'2026-10-12',status:'active',multiUse:true,joinedCount:7},
      {inviteId:'b',expiresAt:'2026-10-12',status:'used',multiUse:true,joinedCount:64},
      {inviteId:'c',expiresAt:'2026-10-12',status:'used'},
    ] };
  vi.spyOn(service,'getSnapshot').mockReturnValue(snapshot);
  render(<CollaborationSurface bridge={{options,get:async()=>service}} view="editor" localId="local" attached />);
  await screen.findByText('このリンクは7日間、何人でも参加に使えます（作成者を含めて合計8人まで）。参加した人に期限はありません。');
  expect(screen.getByText(/有効 · このリンクで参加：7人/)).toBeTruthy();
  expect(screen.getByText(/上限に達しました · このリンクで参加：64人/)).toBeTruthy();
  expect(screen.getByText(/使用済み$/)).toBeTruthy();
  expect(screen.getAllByRole('button',{name:'招待を取り消す'})).toHaveLength(1);
  expect(screen.getByText('取り消すと、まだ参加していない人はこのリンクで参加できなくなります。参加済みの人はそのままです。')).toBeTruthy();
});
it.each(['web', 'ipad'] as const)('pastes using the actual service outside busy; platform=%s', async platform => {
  const readText = vi.fn().mockResolvedValue(link);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText } });
  const service = setup(platform);
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: 'クリップボードから貼り付け' }));
  expect(readText).toHaveBeenCalledOnce(); expect(service.getSnapshot().busy).toBe(false);
  await waitFor(() => expect((screen.getByRole('textbox', { name: '招待リンク' }) as HTMLInputElement).value).toBe(link));
  expect(!!screen.queryByText('iPadアプリで参加する場合')).toBe(platform === 'web');
  expect(!!screen.queryByRole('button', { name: 'リンクをコピー' })).toBe(platform === 'web');
});
it('shows a local manual paste hint on read failure without exposing the error', async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: vi.fn().mockRejectedValue(new Error(link)) } });
  setup(); await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: 'クリップボードから貼り付け' }));
  await screen.findByText('入力欄を長押し（PC は Ctrl+V）して貼り付けてください');
  expect(screen.queryByRole('alert')).toBeNull(); expect(document.body.textContent).not.toContain(link);
});
it('opens invitations on hashchange without opening a project, and removes valid/invalid hashes', async () => {
  const service = setup(); await screen.findByRole('dialog');
  act(() => service.close());
  const release = installInvitationRouting([location.origin]);
  try {
    act(() => { history.replaceState({ editor: 'unchanged' }, '', link); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await screen.findByRole('dialog', { name: '招待されています' });
    expect(service.getSnapshot().link).toBe(link); expect(location.hash).toBe('');
    expect(history.state).toEqual({ editor: 'unchanged' }); expect(service.optionsNow.open).not.toHaveBeenCalled();
    act(() => { history.replaceState(history.state, '', '/#invite=bad'); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await screen.findByRole('alert'); expect(service.getSnapshot().error).toContain('招待リンクを確認'); expect(location.hash).toBe('');
  } finally { release(); }
});
