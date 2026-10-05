// Never persist this capability or expose it to diagnostics/analytics.
let invitation: { link: string; invalid?: boolean } | null = null;
const listeners = new Set<() => void>();
export const subscribeInvitation = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const rememberInvitation = (link: string, invalid = false) => { invitation = { link, invalid }; for (const listener of listeners) listener(); };
export const readInvitation = () => invitation;
export const forgetInvitation = () => { invitation = null; for (const listener of listeners) listener(); };
