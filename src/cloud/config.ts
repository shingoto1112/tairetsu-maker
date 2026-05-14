export type CloudConfig = {
  anonKey: string;
  url: string;
};

export const getCloudConfig = (): CloudConfig | null => {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return null;
  }
  return {
    anonKey,
    url: url.replace(/\/+$/, ""),
  };
};

export const isCloudConfigured = (): boolean => getCloudConfig() !== null;
