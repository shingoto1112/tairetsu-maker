import { afterEach, expect, it, vi } from 'vitest';
import { extractInvitationLink, invitationToken } from './invitations';

const token = 'a'.repeat(64), origin = 'https://app.example.invalid';
const link = `${origin}/#invite=${token}`;
afterEach(() => vi.restoreAllMocks());
it.each(['', '隊列表に参加してください ', '本文\n', '本文\t', '本文　'])('accepts one URL after %j', prefix => {
  expect(invitationToken(`${prefix}${link}\n参加お願いします`, [origin])).toBe(token);
});
it.each([... '。、．，.,)）]」』】!?！？'])('strips only trailing punctuation %s', suffix => {
  expect(extractInvitationLink(`本文 ${link}${suffix}`)).toBe(link);
  expect(invitationToken(`本文 ${link}${suffix}`, [origin])).toBe(token);
});
it('keeps the old zero-URL validation path and the length boundary', () => {
  expect(extractInvitationLink(' invalid ')).toBe('invalid');
  expect(() => invitationToken('invalid', [origin])).toThrow('INVALID_INVITE_LINK');
  expect(invitationToken(' '.repeat(2000 - link.length) + link, [origin])).toBe(token);
});
it.each([
  `${link} ${link}`, `${link}　https://other.invalid/`, `${origin}/?x=1#invite=${token}`,
  `${origin}/#invite=${token.toUpperCase()}`, `https://user:password@app.example.invalid/#invite=${token}`,
  `https://other.invalid/#invite=${token}`, 'x'.repeat(2001) + link,
  `${link};`, `${link}:`, `${link}…`, `${link}&other=1`, `${link}&invite=${token}`,
])('rejects unsafe or ambiguous input case %#', input => {
  expect(() => invitationToken(input, [origin])).toThrow('INVALID_INVITE_LINK');
});
it('does not depend on URLSearchParams.size in older Safari', () => {
  vi.spyOn(URLSearchParams.prototype, 'size', 'get').mockReturnValue(undefined as unknown as number);
  expect(invitationToken(link, [origin])).toBe(token);
  expect(() => invitationToken(`${link}&x=1`, [origin])).toThrow('INVALID_INVITE_LINK');
});
