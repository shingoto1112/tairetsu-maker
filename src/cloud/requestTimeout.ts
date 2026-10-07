export const ACCOUNT_REQUEST_TIMEOUT_MS = 20_000;

/** Keep the deadline through response body consumption, not just response headers. */
export async function withRequestTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, message: string): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(message));
    }, ACCOUNT_REQUEST_TIMEOUT_MS);
  });
  try { return await Promise.race([operation(controller.signal), deadline]); }
  catch (error) { if (controller.signal.aborted) throw new Error(message); throw error; }
  finally { clearTimeout(timer); }
}
