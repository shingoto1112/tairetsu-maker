#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
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

const requiredEnv = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "CLOUD_OWNER_EMAIL",
  "CLOUD_OWNER_PASSWORD",
  "CLOUD_EDITOR_EMAIL",
  "CLOUD_EDITOR_PASSWORD",
];

const optionalViewerEnv = ["CLOUD_VIEWER_EMAIL", "CLOUD_VIEWER_PASSWORD"];

const missing = requiredEnv.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing required env: ${missing.join(", ")}`);
  console.error(
    [
      "Example:",
      "$env:VITE_SUPABASE_URL='https://...supabase.co'",
      "$env:VITE_SUPABASE_ANON_KEY='anon-or-publishable-key'",
      "$env:CLOUD_OWNER_EMAIL='owner@example.com'",
      "$env:CLOUD_OWNER_PASSWORD='...'",
      "$env:CLOUD_EDITOR_EMAIL='editor@example.com'",
      "$env:CLOUD_EDITOR_PASSWORD='...'",
      "node scripts/cloud-collab-smoke.mjs",
    ].join("\n"),
  );
  process.exit(1);
}

const partialViewerEnv = optionalViewerEnv.filter((key) => process.env[key]);
if (partialViewerEnv.length === 1) {
  console.error(
    "Set both CLOUD_VIEWER_EMAIL and CLOUD_VIEWER_PASSWORD to verify viewer permissions.",
  );
  process.exit(1);
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL.replace(/\/+$/, "");
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

const requestJson = async (url, options) => {
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
  if (!response.ok) {
    throw new Error(
      `Request failed ${response.status}: ${JSON.stringify(json)}`,
    );
  }
  return json;
};

const signIn = async (email, password) =>
  requestJson(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    body: JSON.stringify({ email, password }),
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

const rpc = async (session, functionName, payload) =>
  requestJson(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    body: JSON.stringify(payload),
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

const randomToken = () => {
  return randomBytes(32)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

const expectSuccess = (label, result) => {
  const row = Array.isArray(result) ? result[0] : result;
  if (!row?.success) {
    throw new Error(`${label} failed: ${JSON.stringify(row)}`);
  }
  console.log(`OK ${label}`);
  return row;
};

const expectFailure = (label, result, expectedReason) => {
  const row = Array.isArray(result) ? result[0] : result;
  if (row?.success || row?.reason !== expectedReason) {
    throw new Error(
      `${label} expected ${expectedReason}: ${JSON.stringify(row)}`,
    );
  }
  console.log(`OK ${label}: ${expectedReason}`);
  return row;
};

const schemaVersion = 1;
const createSmokeDraft = () => {
  const title = `Codex cloud smoke ${new Date().toISOString()}`;
  const member = {
    color: "#ef476f",
    id: "m-smoke",
    name: "smoke",
    visible: true,
    zIndex: 20,
  };
  const stage = {
    audienceSide: "bottom",
    centerLineMode: "center",
    depthMeters: 8,
    frontDirection: "bottom",
    gridIntervalM: 1,
    gridSizeMeters: 1,
    horizontalGuideMode: "meters",
    memberDiameterMeters: 0.5,
    originMode: "center",
    showCenterLine: true,
    showCenterMarker: true,
    showGrid: true,
    widthMeters: 12,
  };
  const frames = [
    { id: "scene-smoke-1", label: "Smoke 1", timeSec: 0 },
    { id: "scene-smoke-2", label: "Smoke 2", timeSec: 10 },
  ];
  const sceneData = (x, y) => ({
    groupVisibility: {},
    memberAppearanceOverrides: {},
    memberVisibility: {},
    notes: "",
    objectAssignments: {},
    objectStates: {},
    positions: {
      [member.id]: { x, y },
    },
    sceneViewState: undefined,
    stageDepthMeters: undefined,
    stageWidthMeters: undefined,
  });

  return {
    project: {
      legacyProjectId: `smoke-${Date.now()}`,
      mode: "stage",
      schemaVersion,
      title,
    },
    resources: [
      {
        data: { memberGroups: [], members: [member] },
        resourceKey: "members",
        schemaVersion,
        version: 1,
      },
      {
        data: { objectGroups: [], stageObjects: [] },
        resourceKey: "objects",
        schemaVersion,
        version: 1,
      },
      {
        data: {
          animationSettings: { membersEnabled: false, objectsEnabled: false },
          focusMemberId: undefined,
          guideSettings: {
            snapGuideEnabled: true,
            snapToGuideEnabled: false,
          },
          mode: "stage",
          paradeSettings: undefined,
          stage,
          useGlobalStageSize: true,
          useGlobalStageWidth: true,
          viewerPerspective: "audience",
        },
        resourceKey: "settings",
        schemaVersion,
        version: 1,
      },
      {
        data: { audio: null },
        resourceKey: "audio",
        schemaVersion,
        version: 1,
      },
      {
        data: {
          frames,
          movementPaths: [],
          movementPlans: [],
        },
        resourceKey: "sceneOrder",
        schemaVersion,
        version: 1,
      },
    ],
    scenes: [
      {
        data: sceneData(3, 3),
        sceneId: frames[0].id,
        schemaVersion,
        version: 1,
      },
      {
        data: sceneData(4, 4),
        sceneId: frames[1].id,
        schemaVersion,
        version: 1,
      },
    ],
  };
};

const main = async () => {
  const owner = await signIn(
    process.env.CLOUD_OWNER_EMAIL,
    process.env.CLOUD_OWNER_PASSWORD,
  );
  const editor = await signIn(
    process.env.CLOUD_EDITOR_EMAIL,
    process.env.CLOUD_EDITOR_PASSWORD,
  );
  const viewer =
    process.env.CLOUD_VIEWER_EMAIL && process.env.CLOUD_VIEWER_PASSWORD
      ? await signIn(
          process.env.CLOUD_VIEWER_EMAIL,
          process.env.CLOUD_VIEWER_PASSWORD,
        )
      : null;

  const draft = createSmokeDraft();
  const created = expectSuccess(
    "create_cloud_project",
    await rpc(owner, "create_cloud_project", {
      p_legacy_project_id: draft.project.legacyProjectId,
      p_mode: draft.project.mode,
      p_resources: draft.resources,
      p_schema_version: draft.project.schemaVersion,
      p_scenes: draft.scenes,
      p_title: draft.project.title,
    }),
  );
  const projectId = created.project_id;

  const inviteToken = randomToken();
  expectSuccess(
    "create_project_invite",
    await rpc(owner, "create_project_invite", {
      p_invite_token: inviteToken,
      p_invited_email: process.env.CLOUD_EDITOR_EMAIL,
      p_project_id: projectId,
      p_role: "editor",
    }),
  );
  expectSuccess(
    "accept_project_invite",
    await rpc(editor, "accept_project_invite", {
      p_invite_token: inviteToken,
    }),
  );

  if (viewer) {
    const viewerInviteToken = randomToken();
    expectSuccess(
      "create viewer invite",
      await rpc(owner, "create_project_invite", {
        p_invite_token: viewerInviteToken,
        p_invited_email: process.env.CLOUD_VIEWER_EMAIL,
        p_project_id: projectId,
        p_role: "viewer",
      }),
    );
    expectSuccess(
      "accept viewer invite",
      await rpc(viewer, "accept_project_invite", {
        p_invite_token: viewerInviteToken,
      }),
    );
  }

  const ownerLockToken = randomToken();
  expectSuccess(
    "owner acquire scene 1",
    await rpc(owner, "acquire_edit_lock", {
      p_lock_token: ownerLockToken,
      p_project_id: projectId,
      p_target_id: "scene-smoke-1",
      p_target_type: "scene",
    }),
  );

  expectFailure(
    "editor blocked from same scene",
    await rpc(editor, "acquire_edit_lock", {
      p_lock_token: randomToken(),
      p_project_id: projectId,
      p_target_id: "scene-smoke-1",
      p_target_type: "scene",
    }),
    "scene_lock_active",
  );

  if (viewer) {
    expectFailure(
      "viewer blocked from scene edit",
      await rpc(viewer, "acquire_edit_lock", {
        p_lock_token: randomToken(),
        p_project_id: projectId,
        p_target_id: "scene-smoke-1",
        p_target_type: "scene",
      }),
      "permission_denied",
    );
  }

  const editorLockToken = randomToken();
  expectSuccess(
    "editor acquire scene 2",
    await rpc(editor, "acquire_edit_lock", {
      p_lock_token: editorLockToken,
      p_project_id: projectId,
      p_target_id: "scene-smoke-2",
      p_target_type: "scene",
    }),
  );

  expectSuccess(
    "editor save scene 2",
    await rpc(editor, "save_scene_with_lock", {
      p_base_version: 1,
      p_data: {
        ...draft.scenes[1].data,
        notes: "saved by editor smoke test",
        positions: { "m-smoke": { x: 5, y: 5 } },
      },
      p_lock_token: editorLockToken,
      p_project_id: projectId,
      p_scene_id: "scene-smoke-2",
      p_schema_version: schemaVersion,
      p_summary: "smoke editor save",
    }),
  );

  expectSuccess(
    "owner save scene 1",
    await rpc(owner, "save_scene_with_lock", {
      p_base_version: 1,
      p_data: {
        ...draft.scenes[0].data,
        notes: "saved by owner smoke test",
        positions: { "m-smoke": { x: 2, y: 2 } },
      },
      p_lock_token: ownerLockToken,
      p_project_id: projectId,
      p_scene_id: "scene-smoke-1",
      p_schema_version: schemaVersion,
      p_summary: "smoke owner save",
    }),
  );

  expectSuccess(
    "owner release scene 1",
    await rpc(owner, "release_edit_lock", {
      p_lock_token: ownerLockToken,
      p_project_id: projectId,
      p_target_id: "scene-smoke-1",
      p_target_type: "scene",
    }),
  );
  expectSuccess(
    "editor release scene 2",
    await rpc(editor, "release_edit_lock", {
      p_lock_token: editorLockToken,
      p_project_id: projectId,
      p_target_id: "scene-smoke-2",
      p_target_type: "scene",
    }),
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        projectId,
        title: draft.project.title,
        viewerChecked: Boolean(viewer),
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
