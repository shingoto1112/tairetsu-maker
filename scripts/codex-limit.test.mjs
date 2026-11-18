import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findUsageLimit } from './codex-limit.mjs';

const receivedAt = new Date(2026, 10, 14, 13, 5, 30);

test('ordinary failures are not usage limits', () => {
  assert.equal(findUsageLimit('ERROR: stream disconnected before completion', receivedAt), null);
});

test('a reset later today is read in local time', () => {
  const output = 'ERROR: You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro) or try again at 3:42 PM.';
  assert.deepEqual(findUsageLimit(output, receivedAt), { resetAt: new Date(2026, 10, 14, 15, 42) });
});

test('midnight and noon use the 12-hour clock correctly', () => {
  assert.deepEqual(findUsageLimit("You've hit your usage limit. Try again at 12:07 PM.", receivedAt), {
    resetAt: new Date(2026, 10, 14, 12, 7),
  });
  assert.deepEqual(
    findUsageLimit("You've hit your usage limit. Try again at Nov 15th, 2026 12:07 AM.", receivedAt),
    { resetAt: new Date(2026, 10, 15, 0, 7) },
  );
});

test('a reset on another day carries its date', () => {
  const output = "ERROR: You've hit your usage limit. Try again at Nov 21st, 2026 9:15 AM.";
  assert.deepEqual(findUsageLimit(output, receivedAt), { resetAt: new Date(2026, 10, 21, 9, 15) });
});

test('a limit without a time is reported without a reset', () => {
  assert.deepEqual(findUsageLimit('ERROR: You’ve hit your usage limit. Try again later.', receivedAt), {
    resetAt: null,
  });
});

test('trailing lines after the error do not hide it', () => {
  const output = [
    'ERROR: You’ve hit your usage limit. Try again at 6:30 PM.',
    'tokens used',
    '1,234',
  ].join('\r\n');
  assert.deepEqual(findUsageLimit(output, receivedAt), { resetAt: new Date(2026, 10, 14, 18, 30) });
});

test('a quoted limit message is not the error of this run', () => {
  const quotedInTask = [
    'user',
    'Explain the message: ERROR: You’ve hit your usage limit. Try again at 6:30 PM.',
    'and what the caller should do about it.',
    'ERROR: unexpected status 500',
  ].join('\n');
  assert.equal(findUsageLimit(quotedInTask, receivedAt), null);

  const earlierInOutput = [
    'You’ve hit your usage limit. Try again at 6:30 PM.',
    ...Array.from({ length: 6 }, (_, index) => `tool output line ${index}`),
    'ERROR: unexpected status 500',
  ].join('\n');
  assert.equal(findUsageLimit(earlierInOutput, receivedAt), null);
});

test('a time that only fits the previous day is treated as unknown', () => {
  const justAfterMidnight = new Date(2026, 10, 15, 0, 0, 1);
  const output = 'ERROR: You’ve hit your usage limit. Try again at 11:59 PM.';
  assert.deepEqual(findUsageLimit(output, justAfterMidnight), { resetAt: null });
});
