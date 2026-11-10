/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SUPABASE_URL?: string;
  /** "1" builds cloud saving and collaboration in; anything else is device-only. */
  readonly VITE_COLLABORATION_V2?: string;
  readonly VITE_COLLABORATION_INVITATION_URL?: string;
  readonly VITE_PUBLIC_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
