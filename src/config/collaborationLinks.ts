import { publicSiteUrl } from "./publicLinks";
/** Invitation origins are separate from Edge CORS/WebView origins. */
export const invitationBaseUrl = import.meta.env.VITE_COLLABORATION_INVITATION_URL?.trim() || publicSiteUrl;
export const invitationOrigins = (() => {
  try { return [new URL(invitationBaseUrl).origin]; }
  catch { return []; } // Bad optional configuration cannot break V2-OFF boot.
})();
