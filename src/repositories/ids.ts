import { RepositoryError } from "./types";

/** Shared TS/Swift logical-ID rules (not a filesystem path or storage key):
 * - nonempty string, UTF-8 length <= 255 bytes, no trimming/normalization;
 * - reject slash, backslash, colon (absolute/drive paths), any ".." substring;
 * - reject U+0000..001F and U+007F..009F (C0/C1 including NUL/DEL);
 * - reject unpaired UTF-16 surrogates (Swift strings cannot represent them).
 * UUID, project_..., project-..., audio-... and Unicode are accepted.
 * Never concatenate accepted IDs into paths; native storage keys are separate.
 */
export const isValidStorageId = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length === 0 || value.length > 255) return false;
  if (/[\\/:\u0000-\u001f\u007f-\u009f]/.test(value) || value.includes("..")) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return new TextEncoder().encode(value).byteLength <= 255;
};

export const assertStorageId = (value: unknown): string => {
  if (!isValidStorageId(value)) throw new RepositoryError("INVALID_ID");
  return value;
};
