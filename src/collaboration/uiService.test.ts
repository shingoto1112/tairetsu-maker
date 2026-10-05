import { beforeEach, expect, it, vi } from 'vitest';
import { CollaborationUiService } from './uiService';
import type { CollaborationUiOptions } from './uiTypes';
import { forgetInvitation } from '../storage/invitationMemory';
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
