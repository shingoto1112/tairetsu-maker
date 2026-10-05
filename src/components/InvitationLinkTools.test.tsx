/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import InvitationLinkTools from './InvitationLinkTools';

const link = `https://app.example.invalid/#invite=${'a'.repeat(64)}`;
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
it('starts copying synchronously and announces success beside the button for two seconds', async () => {
  vi.useFakeTimers();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<InvitationLinkTools link={link} label="作成した招待リンク" disabled={false} />);
  const button = screen.getByRole('button', { name: 'リンクをコピー' });
  fireEvent.click(button); expect(writeText).toHaveBeenCalledWith(link);
  await act(async () => {});
  expect(screen.getByRole('button', { name: 'コピーしました ✓' })).toBeTruthy();
  expect(within(button.parentElement!.parentElement!).getByRole('status').textContent).toBe('リンクをコピーしました。');
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.getByRole('button', { name: 'リンクをコピー' })).toBeTruthy();
});
it.each([false, true])('selects the readOnly link on failure; share available=%s', async ipad => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
  const share = vi.fn();
  render(<InvitationLinkTools link={link} label="作成した招待リンク" disabled={false} share={ipad ? share : undefined} />);
  fireEvent.click(screen.getByRole('button', { name: 'リンクをコピー' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('コピーできませんでした。'));
  const input = screen.getByRole('textbox') as HTMLInputElement;
  expect(document.activeElement).toBe(input); expect(input.readOnly).toBe(true);
  expect(input.selectionStart).toBe(0); expect(input.selectionEnd).toBe(link.length);
  expect(screen.getByRole('status').textContent).not.toContain(link);
  if (ipad) { fireEvent.click(screen.getByRole('button', { name: '共有シートを開く' })); expect(share).toHaveBeenCalledOnce(); }
  else expect(screen.queryByRole('button', { name: '共有シートを開く' })).toBeNull();
});
it('ignores a completed copy of a replaced link', async () => {
  let resolve!: () => void;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => new Promise<void>(done => { resolve = done; }) } });
  const view = render(<InvitationLinkTools link={link} label="リンク" disabled={false} />);
  fireEvent.click(screen.getByRole('button')); view.rerender(<InvitationLinkTools link="changed" label="リンク" disabled={false} />);
  await act(async () => resolve()); expect(screen.getByRole('status').textContent).toBe('');
});
