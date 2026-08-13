const DEFAULT_PUBLIC_SITE_URL = "https://tairetsu-maker.vercel.app";

const publicSiteUrl =
  import.meta.env.VITE_PUBLIC_SITE_URL?.trim().replace(/\/$/, "") ||
  DEFAULT_PUBLIC_SITE_URL;

export const PUBLIC_LINKS = {
  privacy: `${publicSiteUrl}/privacy.html`,
  support: `${publicSiteUrl}/support.html`,
  terms: `${publicSiteUrl}/terms.html`,
} as const;
