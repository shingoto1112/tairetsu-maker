import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { parseFeed } from "./src/announcements/contract";

function announcements(): Plugin {
  const path = new URL("./src/announcements/announcements.v1.json", import.meta.url);
  let origins: string[] = [];
  const source = () => {
    const text = readFileSync(path, "utf8");
    if (!parseFeed(text, origins)) throw new Error("Invalid announcements.v1.json");
    return text;
  };
  const serve = (server: ViteDevServer) => {
    server.middlewares.use((req, res, next) => {
      if (req.url?.split("?")[0] !== "/announcements.v1.json") return next();
      try { const text = source(); res.setHeader("Content-Type", "application/json; charset=utf-8"); res.setHeader("Cache-Control", "no-cache"); res.end(text); }
      catch { res.statusCode = 500; res.end(); }
    });
  };
  return {
    name: "announcements-v1",
    configResolved(config) {
      const env = loadEnv(config.mode, config.envDir, "VITE_");
      origins = [new URL(process.env.VITE_PUBLIC_SITE_URL || env.VITE_PUBLIC_SITE_URL || "https://tairetsu-maker.vercel.app").origin, "https://apps.apple.com"];
    },
    buildStart() { source(); },
    generateBundle() { this.emitFile({ type: "asset", fileName: "announcements.v1.json", source: source() }); },
    configureServer: serve,
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== "/announcements.v1.json") return next();
        try { res.setHeader("Content-Type", "application/json; charset=utf-8"); res.setHeader("Cache-Control", "no-cache"); res.end(source()); }
        catch { res.statusCode = 500; res.end(); }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), announcements()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, "/");
          if (
            normalized.includes("/node_modules/react/") ||
            normalized.includes("/node_modules/react-dom/") ||
            normalized.includes("/node_modules/scheduler/")
          ) {
            return "react-vendor";
          }
          if (normalized.includes("/node_modules/lucide-react/")) {
            return "icons";
          }
          return undefined;
        },
      },
    },
  },
});
