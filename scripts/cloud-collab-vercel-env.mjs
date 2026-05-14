#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const loadDotEnv = (filePath) => {
  if (!existsSync(filePath)) {
    return;
  }

  const text = readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
};

loadDotEnv(path.resolve(".env"));
loadDotEnv(path.resolve(".env.local"));

const requiredEnv = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];
const missing = requiredEnv.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing required env: ${missing.join(", ")}`);
  console.error("Create .env first, then run npm run cloud:vercel-env.");
  process.exit(1);
}

const environments = (
  process.env.CLOUD_VERCEL_ENVIRONMENTS ?? "production"
)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const allowed = new Set(["production", "preview", "development"]);
const invalid = environments.filter((item) => !allowed.has(item));
if (invalid.length > 0) {
  console.error(`Invalid Vercel environment: ${invalid.join(", ")}`);
  process.exit(1);
}

const createNpxCommand = (args) => {
  if (process.platform !== "win32") {
    return {
      args,
      command: "npx",
    };
  }

  return {
    args: ["/d", "/s", "/c", ["npx", ...args].join(" ")],
    command: "cmd.exe",
  };
};

for (const environment of environments) {
  for (const key of requiredEnv) {
    console.log(`Setting ${key} for ${environment}...`);
    const npxCommand = createNpxCommand([
      "vercel",
      "env",
      "add",
      key,
      environment,
      "--force",
      "--yes",
      "--non-interactive",
    ]);
    const result = spawnSync(
      npxCommand.command,
      npxCommand.args,
      {
        encoding: "utf8",
        shell: false,
        input: `${process.env[key]}\n`,
        stdio: ["pipe", "inherit", "inherit"],
      },
    );

    if (result.status !== 0) {
      console.error(
        `Failed to set ${key} for ${environment}. Is this directory linked to the Vercel project and are you logged in?`,
      );
      process.exit(result.status ?? 1);
    }
  }
}

console.log("Vercel environment variables updated.");
