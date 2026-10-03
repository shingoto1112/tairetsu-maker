/** Queue requests synchronously (or in their success callbacks). Never await
 * network/crypto work inside an IndexedDB transaction. */
export const runIdbTransaction = <T>(
  db: IDBDatabase,
  stores: string | string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction, result: (value: T) => void, fail: (error: unknown) => void) => void,
  classify: (error: unknown) => Error = error => error instanceof Error ? error : new Error("IndexedDB処理に失敗しました。"),
): Promise<T> => new Promise((resolve, reject) => {
  let tx: IDBTransaction;
  try {
    if (mode === "readwrite") {
      try { tx = db.transaction(stores, mode, { durability: "strict" }); }
      catch (error) {
        // Older engines may reject the options dictionary. Do not retry I/O,
        // quota, closed-connection or schema errors with weaker durability.
        if (!(error instanceof TypeError)) throw error;
        tx = db.transaction(stores, mode);
      }
    } else tx = db.transaction(stores, mode);
  } catch (error) { reject(classify(error)); return; }
  let value: T;
  let ready = false;
  let failure: Error | undefined;
  const fail = (error: unknown) => {
    failure ??= classify(error);
    try { tx.abort(); } catch { /* Already aborted/completing; handlers settle. */ }
  };
  tx.oncomplete = () => {
    if (failure) reject(failure);
    else if (!ready) reject(classify(new Error("IndexedDB結果がありません。")));
    else resolve(value);
  };
  tx.onabort = () => reject(failure ?? classify(tx.error ?? new DOMException("Transaction aborted", "AbortError")));
  tx.onerror = event => {
    const request = event.target as IDBRequest | null;
    fail(request?.error ?? tx.error ?? new Error("IndexedDB処理に失敗しました。"));
  };
  try { work(tx, result => { value = result; ready = true; }, fail); }
  catch (error) { fail(error); }
});
