import { TransportError } from "./transport";

const tokenPattern = /^[0-9a-f]{64}$/;
export function displayName(value: string): string {
  const name = value.trim();
  if (!name || [...name].length > 80 || /[\u0000-\u001f\u007f-\u009f]/.test(name))
    throw new TransportError("validation", "INVALID_DISPLAY_NAME");
  return name;
}
/** Tokens never enter query/path parameters, analytics or unauthenticated RPCs. */
export function invitationToken(link: string, allowedOrigins: readonly string[]): string {
  try {
    const url = new URL(link.trim());
    const params = new URLSearchParams(url.hash.slice(1));
    const token = params.get("invite");
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password ||
      !allowedOrigins.includes(url.origin) || url.search || params.size !== 1 || !token || !tokenPattern.test(token)) throw new Error();
    return token;
  } catch { throw new TransportError("validation", "INVALID_INVITE_LINK"); }
}
export function invitationLink(baseUrl: string, token: string): string {
  const url = new URL(baseUrl);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || !tokenPattern.test(token))
    throw new TransportError("validation", "INVALID_INVITE_LINK");
  url.search = ""; url.hash = `invite=${token}`;
  return url.href;
}
/** UI-independent route description. Neither branch fetches document contents. */
export function invitationEntry(link: string, origins: readonly string[], platform: "web" | "ipad", signedIn: boolean) {
  invitationToken(link, origins);
  return { action: signedIn ? "join" : platform === "ipad" ? "sign-in" : "guest-name", canPasteInApp: true,
    ipadHelp: "iPadアプリでログインし、招待リンクを貼り付けて参加してください。" } as const;
}
/** Call at the Web invitation entry before analytics; keep returned link only
 * in memory. Clipboard participation uses invitationToken directly. */
export function takeInvitationLink(origins: readonly string[], browser: Pick<Window, "location" | "history"> = window): string {
  const link = browser.location.href;
  invitationToken(link, origins);
  const clean = new URL(link); clean.hash = "";
  browser.history.replaceState(browser.history.state, "", clean.href);
  return link;
}
