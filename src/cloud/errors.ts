/** HTTP error shared by account lifecycle; independent of document APIs. */
export class CloudApiError extends Error {
  constructor(message: string, readonly status: number, readonly details: { code?: string; message?: string; details?: string; hint?: string } | null) {
    super(message); this.name = "CloudApiError";
  }
}
