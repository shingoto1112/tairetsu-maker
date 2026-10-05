/* @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import CollaborationHistoryPanel from './CollaborationHistoryPanel';
import type { HistoryController } from '../collaboration/historyController';
import { SharedSessionStore } from '../storage/sharedSessionState';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it.each([false, true])('opens one row with keyboard, preserves confirmations and creator-only delete; creator=%s', async creator => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  const items = [{ id: 'auto', serverAt: '2026-10-05T00:00:00Z', automatic: true, reason: 'automatic' },
    { id: 'manual', serverAt: '2026-10-05T00:01:00Z', automatic: false, reason: 'manual', requestedBy: 'tester' }];
  const state = { loaded: true, busy: false, items, cursor: null, error: null, notice: null, restore: null, retry: false };
  const fake = { subscribe: () => () => {}, getSnapshot: () => state, run: (fn: () => Promise<void>) => fn(), list: vi.fn(), manual: vi.fn(), copy: vi.fn(), restore: vi.fn(), remove: vi.fn() };
  const open = vi.fn(), user = userEvent.setup();
  render(<CollaborationHistoryPanel controller={fake as unknown as HistoryController} members={[]} creator={creator} session={new SharedSessionStore()} open={open} />);
  await user.click(screen.getByRole('button', { name: '控えを見る' }));
  const automatic = screen.getByRole('button', { name: /自動で残した控え/ });
  expect(automatic.textContent).not.toContain('自動 ·');
  expect(screen.queryByRole('button', { name: '新しい隊列表として開く' })).toBeNull();
  automatic.focus(); await user.keyboard('{Enter}');
  expect(automatic.getAttribute('aria-expanded')).toBe('true');
  await user.click(screen.getByRole('button', { name: '新しい隊列表として開く' }));
  expect(fake.copy).toHaveBeenCalledWith('auto', open);
  const manual = screen.getByRole('button', { name: /手動で残した控え/ });
  await user.click(manual); expect(automatic.getAttribute('aria-expanded')).toBe('false');
  await user.click(screen.getByRole('button', { name: '共有中の隊列表をこの状態に戻す' }));
  const confirm = screen.getByRole('group', { name: '共有中の隊列表を戻す確認' });
  expect(document.activeElement).toBe(confirm);
  await user.click(within(confirm).getByRole('button', { name: 'キャンセル' }));
  expect(fake.restore).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '共有中の隊列表をこの状態に戻す' }));
  await user.click(screen.getByRole('button', { name: '全員の隊列表を戻す' }));
  expect(fake.restore).toHaveBeenCalledWith('manual');
  if (creator) {
    await user.click(screen.getByRole('button', { name: '控えを削除' }));
    await user.click(screen.getByRole('button', { name: '控えを削除する' }));
    expect(fake.remove).toHaveBeenCalledWith('manual');
  } else expect(screen.queryByRole('button', { name: '控えを削除' })).toBeNull();
});
