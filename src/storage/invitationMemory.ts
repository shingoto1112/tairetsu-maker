// Never persist this capability or expose it to diagnostics/analytics.
let invitation: { link: string; invalid?: boolean } | null = null;
export const rememberInvitation = (link: string, invalid = false) => { invitation = { link, invalid }; };
export const readInvitation = () => invitation;
export const forgetInvitation = () => { invitation = null; };
