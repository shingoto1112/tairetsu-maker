import * as Y from "yjs";
/** Old v2 scenes lack this container. Concurrent first use must insert the SAME
 * Yjs container identity, otherwise a winning parent register loses other lines.
 * Reserve a deterministic safe-integer client ID above the normal uint32 space,
 * derived from the immutable scene Item identity. Only this one insertion uses
 * it; ordinary editing keeps the device's random client identity. */
export function annotationMapUpgrade(doc: Y.Doc, sceneId: string): Uint8Array {
  const scene = doc.getMap<Y.Map<unknown>>("scenes").get(sceneId);
  if (!scene?._item || scene.has("annotationLines")) throw new Error("Invalid annotation map upgrade");
  const identity = `${scene._item.id.client}:${scene._item.id.clock}:annotationLines`;
  let hash = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(identity)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n);
  const client = 4294967296 + Number(hash % (4503599627370496n - 4294967296n));
  if (doc.store.clients.has(client)) throw new Error("Annotation upgrade identity collision");
  const temporary = new Y.Doc({ gc: false });
  try {
    Y.applyUpdate(temporary, Y.encodeStateAsUpdate(doc)); temporary.clientID = client;
    const vector = Y.encodeStateVector(temporary);
    temporary.getMap<Y.Map<unknown>>("scenes").get(sceneId)!.set("annotationLines", new Y.Map());
    return Y.encodeStateAsUpdate(temporary, vector);
  } finally { temporary.destroy(); }
}
