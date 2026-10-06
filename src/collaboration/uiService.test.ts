import { beforeEach, expect, it, vi } from 'vitest';
import { CollaborationUiService } from './uiService';
import type { CollaborationUiOptions } from './uiTypes';
import { forgetInvitation } from '../storage/invitationMemory';
import type { ParticipantAuthState } from './guestAuth';
import { SharedSessionStore } from '../storage/sharedSessionState';
beforeEach(forgetInvitation);
const setup = () => {
  const service = new CollaborationUiService(() => ({ config: null } as CollaborationUiOptions));
  service.invitation('original'); return service;
};
it('setLink/paste respect busy and do not even read while busy', async () => {
  const service = setup(), read = vi.fn().mockResolvedValue('clipboard');
  let finish!: () => void;
  const running = service.run(() => new Promise<void>(resolve => { finish = resolve; }));
  service.setLink('ignored'); await service.paste(read);
  expect(read).not.toHaveBeenCalled(); expect(service.getSnapshot().link).toBe('original');
  await vi.waitFor(() => expect(finish).toBeTypeOf('function')); finish(); await running;
});
it.each(['change-back', 'close', 'new-invite', 'busy'] as const)('discards pending clipboard reads after %s', async operation => {
  const service = setup(); let finish!: (value: string) => void;
  const paste = service.paste(() => new Promise(resolve => { finish = resolve; }));
  if (operation === 'change-back') { service.setLink('edited'); service.setLink('original'); }
  if (operation === 'close') service.close();
  if (operation === 'new-invite') service.invitation('new');
  if (operation === 'busy') await service.run(async () => {});
  finish('clipboard'); await paste;
  expect(service.getSnapshot().link).toBe(operation === 'new-invite' ? 'new' : 'original');
});
it('preserves a fixed join save retry for setters, paste and hash invitations', async () => {
  const service = setup();
  // Model a prepared join whose repository commit must be retried.
  Object.assign(service, { fixed: { request: {}, epoch: 0 } });
  const read = vi.fn().mockResolvedValue('clipboard');
  service.setLink('ignored'); await service.paste(read);
  expect(service.receiveInvitation({ link: 'new' })).toBe(false);
  expect(service.getSnapshot().link).toBe('original'); expect(read).not.toHaveBeenCalled(); expect(service.saveRetry).toBe(true);
});

function cloudSetup(auth: ParticipantAuthState = { status: 'signed-in', userId: 'owner', isGuest: false, displayName: '作成者', sessionPersistence: 'existing-account' }) {
  const startSharing = vi.fn().mockResolvedValue({ project: { id: 'target' } });
  const createInvite = vi.fn();
  const options: CollaborationUiOptions = { config: null, platform: 'web', mock: true,
    repository: () => null, active: () => null, store: new SharedSessionStore(), summaries: () => [], open: vi.fn(), localRemoved: vi.fn(),
    transform: vi.fn(async (action, expected) => { if (!expected?.current()) throw Error('対象が変わりました'); await action(expected.localId); }) };
  const service = new CollaborationUiService(() => options);
  Object.assign(service, { auth: { state: () => auth }, api: { startSharing, createInvite } });
  vi.spyOn(service, 'initialize').mockResolvedValue();
  service.authChanged();
  return { service, options, startSharing, createInvite };
}
it.each([
  { status: 'signed-out', guestRecovery: 'new-invite-required' },
  { status: 'signed-in', userId: 'guest', isGuest: true, sessionPersistence: 'browser-data' },
] as ParticipantAuthState[])('cloud save guides non-permanent accounts on home without opening or auto-starting', async auth => {
  const { service, options, startSharing, createInvite } = cloudSetup(auth);
  const open = vi.fn().mockResolvedValue(true);
  await service.saveLocalToCloud('target', { open, current: () => true });
  expect(service.getSnapshot().screen).toBe('account');
  expect(service.getSnapshot().notice).toContain('クラウドに保存するにはログイン');
  expect(open).not.toHaveBeenCalled(); expect(options.transform).not.toHaveBeenCalled();
  expect(startSharing).not.toHaveBeenCalled(); expect(createInvite).not.toHaveBeenCalled();
  expect((service as unknown as { afterLogin: unknown }).afterLogin).toBeNull();
});
it('holds busy from opening until start completes, uses the fixed ID, and never opens management or invites', async () => {
  const { service, options, startSharing, createInvite } = cloudSetup();
  let opened!: (success: boolean) => void, started!: () => void;
  const open = vi.fn(() => new Promise<boolean>(resolve => { opened = resolve; }));
  startSharing.mockImplementation(() => new Promise(resolve => { started = () => resolve({ project: { id: 'target' } }); }));
  const operation = { open, current: () => true };
  const saving = service.saveLocalToCloud('target', operation);
  await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
  expect(service.getSnapshot().busy).toBe(true);
  await service.saveLocalToCloud('other', operation); expect(open).toHaveBeenCalledOnce();
  opened(true); await vi.waitFor(() => expect(startSharing).toHaveBeenCalledWith('target', '作成者'));
  expect(service.getSnapshot().busy).toBe(true);
  await service.saveLocalToCloud('other', operation); expect(startSharing).toHaveBeenCalledOnce();
  started(); await saving;
  expect(options.transform).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ localId: 'target' }));
  expect(service.getSnapshot()).toMatchObject({ screen: null, busy: false, notice: 'クラウドに保存しました。別の端末でも開けます。' });
  expect(createInvite).not.toHaveBeenCalled();
});
it.each(['read-failed', 'generation-changed', 'wrong-id', 'changed-in-transform'] as const)('does not start sharing after %s', async failure => {
  const { service, options, startSharing } = cloudSetup(); let current = true;
  const open = vi.fn(async () => { if (failure === 'generation-changed') current = false; return failure !== 'read-failed'; });
  if (failure === 'wrong-id' || failure === 'changed-in-transform') options.transform = vi.fn(async action => {
    if (failure === 'changed-in-transform') current = false;
    await action(failure === 'wrong-id' ? 'other' : 'target');
  });
  await service.saveLocalToCloud('target', { open, current: () => current });
  expect(startSharing).not.toHaveBeenCalled(); expect(service.getSnapshot().error).toBeTruthy(); expect(service.getSnapshot().busy).toBe(false);
});
it('uses captured options across open instead of waiting for the bridge to update', async () => {
  const { service, options, startSharing } = cloudSetup();
  const transform = options.transform;
  await service.saveLocalToCloud('target', { open: async () => { options.transform = vi.fn().mockRejectedValue(Error('must not depend on new render')); return true; }, current: () => true });
  expect(transform).toHaveBeenCalledOnce(); expect(startSharing).toHaveBeenCalledOnce(); expect(service.getSnapshot().error).toBeNull();
});
it('retains retryability after network and personal-sync errors and issues no invitations', async () => {
  const { service, startSharing, createInvite } = cloudSetup(); const operation = { open: vi.fn().mockResolvedValue(true), current: () => true };
  startSharing.mockRejectedValueOnce(new Error('通信に失敗しました')).mockRejectedValueOnce(Object.assign(new Error('sync'), { code: 'PERSONAL_SYNC_CONFLICT' }));
  await service.saveLocalToCloud('target', operation); expect(service.getSnapshot().error).toContain('通信');
  await service.saveLocalToCloud('target', operation); expect(service.getSnapshot().error).toContain('ホームで複製');
  await service.saveLocalToCloud('target', operation); expect(service.getSnapshot().notice).toContain('クラウドに保存しました');
  expect(startSharing).toHaveBeenCalledTimes(3); expect(createInvite).not.toHaveBeenCalled();
});
