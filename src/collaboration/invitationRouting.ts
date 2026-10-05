import { takeInvitationLink } from "./invitations";
import { rememberInvitation } from "../storage/invitationMemory";

/** Consume synchronously before notifying UI or installing diagnostics. */
export function consumeInvitationHash(origins: readonly string[], browser: Pick<Window, "location" | "history"> = window) {
  if (!new URLSearchParams(browser.location.hash.slice(1)).has("invite")) return;
  try { rememberInvitation(takeInvitationLink(origins, browser)); }
  catch {
    const clean = new URL(browser.location.href); clean.hash = "";
    browser.history.replaceState(browser.history.state, "", clean.href);
    rememberInvitation("", true);
  }
}
export function installInvitationRouting(origins: readonly string[], browser: Window = window) {
  const consume = () => consumeInvitationHash(origins, browser);
  browser.addEventListener("hashchange", consume);
  consume();
  return () => browser.removeEventListener("hashchange", consume);
}
