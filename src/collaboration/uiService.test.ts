import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CollaborationUiService } from './uiService';
import type { CollaborationUiOptions } from './uiTypes';
import { forgetInvitation } from '../storage/invitationMemory';
import type { ParticipantAuthState } from './guestAuth';
import { SharedSessionStore } from '../storage/sharedSessionState';
import { MemoryProjectRepository } from '../repositories/contract/testing/MemoryProjectRepository';
import { createSampleProject } from '../sampleProject';
import { RepositoryError } from '../repositories/types';
import type { SharingOperation } from './uiTypes';
import type { SharedDocumentSummary } from './managementTransport';
import type { ProjectRecord } from '../repositories/types';
beforeEach(forgetInvitation);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
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


async function cloudSetup(initialAuth: ParticipantAuthState = { status: 'signed-in', userId: 'owner', isGuest: false, displayName: '作成者', sessionPersistence: 'existing-account' }) {
  let auth = initialAuth;
  const repository = new MemoryProjectRepository();
  await repository.commit({ project: { ...createSampleProject(), id: 'target', title: '架空隊列' }, localRevision: '1', expectedRepositoryRevision: null, operationId: 'seed' });
  const startSharing = vi.fn(async () => (await repository.get('target'))!);
  const createInvite = vi.fn();
  const operation: SharingOperation = { localId: 'target', current: () => true,
    prepare: vi.fn(async () => (await repository.get('target'))!), settle: vi.fn() };
  const options: CollaborationUiOptions = { config: null, platform: 'web', mock: true,
    repository: () => repository, active: () => null, store: new SharedSessionStore(), summaries: () => [], open: vi.fn(), localRemoved: vi.fn(),
    sharingOperation: vi.fn(() => operation), transform: vi.fn() };
  const service = new CollaborationUiService(() => options);
  Object.assign(service, { auth: { state: () => auth }, api: { startSharing, createInvite } });
  vi.spyOn(service, 'initialize').mockResolvedValue();
  vi.spyOn(service, 'refresh').mockResolvedValue();
  service.authChanged();
  return { service, options, startSharing, createInvite, repository, operation, changeAuth: (next: ParticipantAuthState) => { auth = next; service.authChanged(); } };
}
it.each([
  { status: 'signed-out', guestRecovery: 'new-invite-required' },
  { status: 'signed-in', userId: 'guest', isGuest: true, sessionPersistence: 'browser-data' },
] as ParticipantAuthState[])('both entries guide non-permanent accounts without copying or auto-starting: %s', async auth => {
  const { service, options, operation, startSharing, createInvite, repository } = await cloudSetup(auth);
  await service.saveLocalToCloud('target', operation);
  await service.start('作成者');
  expect(service.getSnapshot().screen).toBe('account');
  expect(service.getSnapshot().notice).toContain('クラウドに保存するにはログイン');
  expect(operation.prepare).not.toHaveBeenCalled(); expect(options.open).not.toHaveBeenCalled();
  expect((await repository.list({ limit: 100 })).items).toHaveLength(1);
  expect(startSharing).not.toHaveBeenCalled(); expect(createInvite).not.toHaveBeenCalled();
  expect((service as unknown as { afterLogin: unknown }).afterLogin).toBeNull();
});
it('offline stops before reading/copying or sharing', async () => {
  const { service, operation, startSharing } = await cloudSetup();
  vi.stubGlobal('navigator', { onLine: false });
  await service.saveLocalToCloud('target', operation);
  expect(service.getSnapshot().error).toContain('オフライン');
  expect(operation.prepare).not.toHaveBeenCalled(); expect(startSharing).not.toHaveBeenCalled();
});
it.each(['home', 'editor'])('uses one common copy-before-sharing path and busy across the whole operation: %s', async entry => {
  const { service, options, startSharing, createInvite, repository, operation } = await cloudSetup();
  let finish!: () => void;
  startSharing.mockImplementation(async () => { await new Promise<void>(resolve => { finish = resolve; }); return (await repository.get('target'))!; });
  const saving = entry === 'home' ? service.saveLocalToCloud('target', operation) : service.start('作成者');
  await vi.waitFor(() => expect(startSharing).toHaveBeenCalledOnce());
  const copies = (await repository.list({ limit: 100 })).items.filter(item => item.id !== 'target');
  expect(copies).toHaveLength(1); expect(copies[0].title).toBe('架空隊列');
  expect((await repository.get(copies[0].id))?.collaboration).toBeFalsy();
  expect((await repository.get(copies[0].id))?.sync).toBeNull();
  expect(startSharing.mock.calls[0].slice(0, 2)).toEqual(['target', '作成者']);
  expect(service.getSnapshot().busy).toBe(true);
  await service.start('ignored'); await service.saveLocalToCloud('other', operation);
  expect(startSharing).toHaveBeenCalledOnce();
  finish(); await saving;
  expect(operation.settle).toHaveBeenCalledWith(true, true);
  expect(options.open).not.toHaveBeenCalled(); expect(options.transform).not.toHaveBeenCalled();
  expect(service.getSnapshot()).toMatchObject({ screen: null, busy: false, error: null });
  expect(service.getSnapshot().notice).toContain('独立したコピー'); expect(createInvite).not.toHaveBeenCalled();
});
it.each(['read-failed', 'generation-changed', 'wrong-id', 'account-changed'])('does not start or copy after invalid preparation: %s', async failure => {
  const { service, startSharing, operation, repository, changeAuth } = await cloudSetup();
  let current = true; operation.current = () => current;
  operation.prepare = vi.fn(async () => {
    if (failure === 'read-failed') throw new RepositoryError('ACCESS_DENIED');
    if (failure === 'generation-changed') current = false;
    if (failure === 'account-changed') changeAuth({ status: 'signed-in', userId: 'other', isGuest: false, sessionPersistence: 'existing-account' });
    const record = (await repository.get('target'))!;
    return failure === 'wrong-id' ? { ...record, project: { ...record.project, id: 'other' } } : record;
  });
  await service.saveLocalToCloud('target', operation);
  expect(startSharing).not.toHaveBeenCalled(); expect(service.getSnapshot().error).toBeTruthy();
  expect((await repository.list({ limit: 100 })).items).toHaveLength(1);
  expect(operation.settle).toHaveBeenCalledWith(false, false);
});
it('rejects old personal sync before committing a copy or calling sharing', async () => {
  const { service, startSharing, operation, repository } = await cloudSetup();
  const record = (await repository.get('target'))!;
  operation.prepare = vi.fn(async () => ({ ...record, sync: { accountId: 'owner', cloudProjectId: 'old', baseServerRevision: '1', syncedLocalRevision: '1', status: 'synced' as const } }));
  const commit = vi.spyOn(repository, 'commit');
  await service.start('作成者');
  expect(commit).not.toHaveBeenCalled(); expect(startSharing).not.toHaveBeenCalled();
  expect(service.getSnapshot().error).toContain('ホームで複製');
});
it('copy failure does not share, and a lost reply retry uses identical copy ID/operation/bytes', async () => {
  const { service, startSharing, operation, repository } = await cloudSetup();
  const commit = repository.commit.bind(repository);
  const spy = vi.spyOn(repository, 'commit').mockImplementationOnce(async request => { await commit(request); throw new RepositoryError('IO_ERROR'); });
  await service.saveLocalToCloud('target', operation);
  expect(startSharing).not.toHaveBeenCalled(); expect(operation.settle).toHaveBeenCalledWith(false, false);
  const fixed = spy.mock.calls[0][0];
  await service.start('作成者');
  expect(spy.mock.calls[1][0]).toEqual(fixed);
  expect((await repository.list({ limit: 100 })).items).toHaveLength(2);
  expect(startSharing).toHaveBeenCalledOnce();
});
it('keeps a copy after sharing failure, reuses it unchanged, and creates a new copy after editing', async () => {
  const { service, startSharing, operation, repository } = await cloudSetup();
  startSharing.mockRejectedValue(new Error('通信に失敗しました'));
  const commit = vi.spyOn(repository, 'commit');
  await service.saveLocalToCloud('target', operation);
  expect(service.getSnapshot().error).toContain('コピーは保存しました');
  expect(service.getSnapshot().error).toContain('クラウドへの保存は確認できません');
  await service.start('作成者');
  expect(commit.mock.calls[1][0]).toEqual(commit.mock.calls[0][0]);
  const saved = (await repository.get('target'))!;
  await repository.commit({ project: { ...saved.project, title: '作成者' }, localRevision: '2', expectedRepositoryRevision: saved.repositoryRevision, operationId: 'edit' });
  await service.start('作成者');
  expect((await repository.list({ limit: 100 })).items).toHaveLength(3);
  expect(commit.mock.calls[commit.mock.calls.length - 1][0].project.id).not.toBe(commit.mock.calls[0][0].project.id);
});
it('rechecks the original repository revision after copying', async () => {
  const { service, startSharing, operation, repository } = await cloudSetup();
  const commit = repository.commit.bind(repository);
  vi.spyOn(repository, 'commit').mockImplementationOnce(async request => {
    const receipt = await commit(request), record = (await repository.get('target'))!;
    await commit({ project: { ...record.project, title: '別画面の編集' }, localRevision: '2', expectedRepositoryRevision: record.repositoryRevision, operationId: 'other-edit' });
    return receipt;
  });
  await service.saveLocalToCloud('target', operation);
  expect(startSharing).not.toHaveBeenCalled(); expect(service.getSnapshot().error).toContain('更新されました');
  expect((await repository.list({ limit: 100 })).items).toHaveLength(2);
});
it('list refresh failure after sharing is independent of success', async () => {
  const { service, operation } = await cloudSetup();
  vi.mocked(service.refresh).mockRejectedValue(new Error('一覧に失敗'));
  await service.saveLocalToCloud('target', operation);
  expect(service.getSnapshot().error).toBeNull(); expect(service.getSnapshot().notice).toContain('クラウドに保存しました');
});
it('keeps the fixed account and generation while sharing is awaiting its reply', async () => {
  const { service, startSharing, operation, repository, changeAuth } = await cloudSetup();
  let finish!: () => void;
  startSharing.mockImplementation(async () => { await new Promise<void>(resolve => { finish = resolve; }); return (await repository.get('target'))!; });
  const saving = service.saveLocalToCloud('target', operation);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  changeAuth({ status: 'signed-in', userId: 'other', isGuest: false, sessionPersistence: 'existing-account' });
  finish(); await saving;
  expect(operation.settle).toHaveBeenCalledWith(false, true);
  expect(service.getSnapshot().error).toContain('ログイン状態が変わりました');
  expect((await repository.list({ limit: 100 })).items).toHaveLength(2);
});
it('clears old counts while the lightweight list is delayed, and rejects a stale account reply', async () => {
  const { service, changeAuth } = await cloudSetup();
  vi.mocked(service.refresh).mockRestore();
  const doc: SharedDocumentSummary = { documentId: 'doc', title: '架空隊列', createdAt: '2026-10-07', isCreator: true, memberCount: 3, documentSchema: 2 };
  let finish!: (page: { items: SharedDocumentSummary[]; nextCursor: null }) => void;
  const list = vi.fn().mockResolvedValue({ items: [doc], nextCursor: null });
  Object.assign(service, { api: { listMyDocuments: list } });
  await service.refresh(); expect(service.getSnapshot().documents).toEqual([doc]);
  list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const refreshing = service.refresh(); expect(service.getSnapshot().documents).toEqual([]);
  changeAuth({ status: 'signed-in', userId: 'other', isGuest: false, sessionPersistence: 'existing-account' });
  finish({ items: [doc], nextCursor: null }); await refreshing;
  expect(service.getSnapshot().documents).toEqual([]);
  vi.stubGlobal('navigator', { onLine: false });
  await service.refresh(); expect(list).toHaveBeenCalledTimes(2);
});
it('refreshes lightweight metadata after participant removal', async () => {
  const { service, repository } = await cloudSetup();
  const record = (await repository.get('target'))!;
  vi.spyOn(repository, 'get').mockResolvedValue({ ...record, collaboration: { sharedDocumentId: 'doc' } } as ProjectRecord);
  const removeMember = vi.fn(), members = vi.fn().mockResolvedValue([]), invites = vi.fn().mockResolvedValue([]);
  Object.assign(service, { api: { removeMember, members, invites } });
  service.manageLocal('target'); await vi.waitFor(() => expect(service.getSnapshot().busy).toBe(false));
  vi.mocked(service.refresh).mockClear();
  await service.remove('participant');
  expect(removeMember).toHaveBeenCalledWith('doc', 'participant'); expect(service.refresh).toHaveBeenCalledOnce();
});
it('rejects a different first lifecycle revision even if that newer record is stable', async () => {
  const { service, startSharing, operation, repository } = await cloudSetup();
  startSharing.mockImplementation(async (...args: unknown[]) => {
    const record = (await repository.get('target'))!;
    await repository.commit({ project: { ...record.project, title: '別画面の編集' }, localRevision: '2', expectedRepositoryRevision: record.repositoryRevision, operationId: 'credential-gap-edit' });
    await (args[3] as (record: ProjectRecord) => Promise<void>)((await repository.get('target'))!);
    return (await repository.get('target'))!;
  });
  await service.saveLocalToCloud('target', operation);
  expect(service.getSnapshot().error).toContain('更新されました'); expect(operation.settle).toHaveBeenCalledWith(false, true);
});
it('reports confirmed cloud/copy saves separately if editor setup then fails', async () => {
  const { service, operation, repository } = await cloudSetup();
  operation.settle = vi.fn().mockRejectedValue(new Error('編集画面に失敗しました'));
  await service.start('作成者');
  expect(service.getSnapshot().error).toContain('クラウドへの保存と開始時のコピー保存は完了しました');
  expect(service.getSnapshot().error).toContain('ホームから隊列表を開いてください');
  expect((await repository.list({ limit: 100 })).items).toHaveLength(2);
});
