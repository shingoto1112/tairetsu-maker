import * as Y from "yjs";
import { REMOTE_ORIGIN } from "../model";

export type MemoryPacket = { id: number; from: number; to: number; update: Uint8Array };

/** Deterministic, deliberately non-durable test transport. Never use as a provider. */
export class MemoryTransport {
  private nextId = 0;
  private queue: MemoryPacket[] = [];
  private readonly listeners: ((update: Uint8Array, origin: unknown) => void)[];

  constructor(private readonly docs: readonly Y.Doc[]) {
    if (docs.length < 2 || docs.length > 5 || new Set(docs).size !== docs.length) {
      throw new Error("Memory transport requires 2–5 distinct documents");
    }
    this.listeners = docs.map((doc, from) => {
      const listener = (update: Uint8Array, origin: unknown) => {
        if (origin === REMOTE_ORIGIN) return;
        docs.forEach((_, to) => { if (to !== from) this.enqueue(from, to, update); });
      };
      doc.on("update", listener);
      return listener;
    });
  }

  get pending(): MemoryPacket[] { return this.queue.map(packet => ({ ...packet, update: packet.update.slice() })); }

  private enqueue(from: number, to: number, update: Uint8Array): number {
    const id = ++this.nextId;
    this.queue.push({ id, from, to, update: update.slice() });
    return id;
  }

  private take(id: number): MemoryPacket {
    const index = this.queue.findIndex(packet => packet.id === id);
    if (index < 0) throw new Error("Unknown memory packet");
    return this.queue.splice(index, 1)[0];
  }

  deliver(id: number): void {
    const packet = this.take(id);
    Y.applyUpdate(this.docs[packet.to], packet.update, REMOTE_ORIGIN);
  }
  drop(id: number): void { this.take(id); }
  duplicate(id: number): number {
    const packet = this.queue.find(packet => packet.id === id);
    if (!packet) throw new Error("Unknown memory packet");
    return this.enqueue(packet.from, packet.to, packet.update);
  }
  echo(id: number): number {
    const packet = this.queue.find(packet => packet.id === id);
    if (!packet) throw new Error("Unknown memory packet");
    return this.enqueue(packet.from, packet.from, packet.update);
  }
  resend(from: number, to: number): number {
    if (!this.docs[from] || !this.docs[to]) throw new Error("Unknown memory peer");
    return this.enqueue(from, to, Y.encodeStateAsUpdate(this.docs[from], Y.encodeStateVector(this.docs[to])));
  }
  flush(reverse = false): void {
    while (this.queue.length) this.deliver(this.queue[reverse ? this.queue.length - 1 : 0].id);
  }
  destroy(): void {
    this.docs.forEach((doc, index) => doc.off("update", this.listeners[index]));
    this.queue = [];
  }
}
