/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CollaborationSurface from './CollaborationSurface';
import { CollaborationUiService } from '../collaboration/uiService';
import type { CollaborationUiOptions } from '../collaboration/uiTypes';
import { SharedSessionStore } from '../storage/sharedSessionState';
import { forgetInvitation } from '../storage/invitationMemory';
import { installInvitationRouting } from '../collaboration/invitationRouting';

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
