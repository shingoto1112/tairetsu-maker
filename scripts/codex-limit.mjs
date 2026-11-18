// Codex CLI 0.164 ends a run that exhausted its usage window with one of:
//   "ERROR: You've hit your usage limit. ... try again at 3:42 PM."     (resets today, local time)
//   "ERROR: You've hit your usage limit. ... try again at Nov 15th, 2026 3:42 AM."
//   "ERROR: You've hit your usage limit. ... Try again later."
// The sentence must open one of the final lines, so that a task, an answer or
// tool output that merely quotes it is not taken for the CLI's own error.
const LIMIT_LINE = /^[^A-Za-z]*(?:error:?\s+)?You.ve hit your usage limit/i;
const FINAL_LINES = 5;
const RESET_PATTERN =
  /try again at\s+(?:([A-Za-z]{3}) (\d{1,2})(?:st|nd|rd|th), (\d{4}) )?(\d{1,2}):(\d{2})\s*([AP]M)/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const HOUR_MS = 60 * 60 * 1000;

/**
 * Returns null when the output does not end in a usage-limit error. Otherwise
 * returns `{ resetAt }`, where `resetAt` is a Date, or null when the time is
 * missing or ambiguous. `receivedAt` is when Codex printed the error.
 */
export function findUsageLimit(output, receivedAt = new Date()) {
  const finalLines = output.split(/\r?\n/).filter((line) => line.trim()).slice(-FINAL_LINES);
  const limitLine = finalLines.findLast((line) => LIMIT_LINE.test(line));
  if (!limitLine) {
    return null;
  }

  const reset = limitLine.match(RESET_PATTERN);
  if (!reset) {
    return { resetAt: null };
  }

  const [, monthName, day, year, hour, minute, meridiem] = reset;
  const hour24 = (Number(hour) % 12) + (meridiem.toUpperCase() === 'PM' ? 12 : 0);
  if (monthName) {
    const month = MONTHS.indexOf(monthName.toLowerCase());
    return {
      resetAt: month < 0 ? null : new Date(Number(year), month, Number(day), hour24, Number(minute)),
    };
  }

  const resetAt = new Date(
    receivedAt.getFullYear(), receivedAt.getMonth(), receivedAt.getDate(), hour24, Number(minute),
  );
  // Codex omits the date only for a reset on the day it printed the message. A
  // time almost a full day ahead means midnight passed in between, and which
  // day was meant can no longer be told.
  return { resetAt: resetAt.getTime() - receivedAt.getTime() > 23 * HOUR_MS ? null : resetAt };
}
