import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "jp.tairetsu.maker",
  appName: "隊列メーカー",
  webDir: "dist",
  loggingBehavior: "none",
  ios: {
    allowsLinkPreview: false,
    contentInset: "never",
    preferredContentMode: "mobile",
    scrollEnabled: true,
    zoomEnabled: false,
  },
};

export default config;
