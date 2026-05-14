#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
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
  console.error(
    [
      "Create .env with:",
      "VITE_SUPABASE_URL=https://your-project.supabase.co",
      "VITE_SUPABASE_ANON_KEY=your-anon-public-or-publishable-key",
    ].join("\n"),
  );
  process.exit(1);
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL.replace(/\/+$/, "");
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

const requestJson = async (label, url, options) => {
  const response = await fetch(url, options);
  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }

  return {
    json,
    label,
    ok: response.ok,
    status: response.status,
  };
};

const headers = {
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
  "Content-Type": "application/json",
};

const rpc = (functionName, payload) =>
  requestJson(
    `rpc:${functionName}`,
    `${SUPABASE_URL}/rest/v1/rpc/${functionName}`,
    {
      body: JSON.stringify(payload),
      headers,
      method: "POST",
    },
  );

const tableProbe = () =>
  requestJson(
    "table:projects",
    `${SUPABASE_URL}/rest/v1/projects?select=id&limit=1`,
    {
      headers,
      method: "GET",
    },
  );

const printResult = (result) => {
  const suffix =
    typeof result.json === "string" ? result.json : JSON.stringify(result.json);
  console.log(
    `${result.ok ? "OK" : "NG"} ${result.label} ${result.status} ${suffix}`,
  );
};

const expectExistingUnauthedRpc = (result) => {
  if (!result.ok) {
    return false;
  }
  const row = Array.isArray(result.json) ? result.json[0] : result.json;
  return row?.success === false && row?.reason === "not_authenticated";
};

const main = async () => {
  const tableResult = await tableProbe();
  printResult(tableResult);
  if (!tableResult.ok) {
    throw new Error(
      "projects table is not reachable. Check the URL/anon key and run the SQL migrations.",
    );
  }

  const dummyProjectId = "00000000-0000-0000-0000-000000000000";
  const checks = [
    await rpc("create_cloud_project", {
      p_legacy_project_id: null,
      p_mode: "stage",
      p_resources: [],
      p_schema_version: 1,
      p_scenes: [],
      p_title: "cloud check",
    }),
    await rpc("acquire_edit_lock", {
      p_lock_token: "cloud-check",
      p_project_id: dummyProjectId,
      p_target_id: "scene-check",
      p_target_type: "scene",
    }),
    await rpc("create_project_invite", {
      p_invite_token: "cloud-check",
      p_invited_email: "check@example.com",
      p_project_id: dummyProjectId,
      p_role: "viewer",
    }),
    await rpc("accept_project_invite", {
      p_invite_token: "cloud-check",
    }),
    await rpc("save_scene_order_with_lock", {
      p_base_version: 1,
      p_data: {},
      p_deleted_scene_ids: [],
      p_lock_token: "cloud-check",
      p_new_scenes: [],
      p_project_id: dummyProjectId,
      p_schema_version: 1,
      p_summary: "cloud check",
    }),
    await rpc("import_cloud_project_with_lock", {
      p_lock_token: "cloud-check",
      p_mode: "stage",
      p_project_id: dummyProjectId,
      p_resources: [],
      p_scenes: [],
      p_schema_version: 1,
      p_summary: "cloud check",
      p_title: "cloud check",
    }),
  ];

  for (const result of checks) {
    printResult(result);
    if (!expectExistingUnauthedRpc(result)) {
      throw new Error(
        `${result.label} did not return the expected unauthenticated response. Check that both SQL migrations were applied.`,
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        message:
          "Supabase URL/anon key are reachable and the cloud collaboration RPC surface exists.",
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
