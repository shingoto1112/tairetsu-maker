import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import JSZip from "jszip";

const normalizeZipPath = (entryPath) => entryPath.replace(/\\/g, "/").replace(/^\/+/, "");

const getParentPath = (entryPath) => {
  const normalized = normalizeZipPath(entryPath);
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index + 1) : "";
};

const findProjectPair = (zip) => {
  const files = Object.values(zip.files).filter((entry) => !entry.dir);
  const manifests = files.filter((entry) => normalizeZipPath(entry.name).endsWith("manifest.json"));

  for (const manifestFile of manifests) {
    const basePath = getParentPath(manifestFile.name);
    const projectFile =
      zip.file(`${basePath}project.json`) ??
      files.find(
        (entry) =>
          getParentPath(entry.name) === basePath &&
          normalizeZipPath(entry.name).endsWith("project.json"),
      );
    if (projectFile) {
      return { basePath, manifestFile, projectFile };
    }
  }

  return null;
};

const loadProjectZip = async (zipPath) => {
  const buffer = await fs.readFile(zipPath);
  const zip = await JSZip.loadAsync(buffer);
  const pair = findProjectPair(zip);
  if (!pair) {
    throw new Error("manifest.json または project.json が見つかりません。");
  }

  const manifest = JSON.parse(await pair.manifestFile.async("string"));
  const project = JSON.parse(await pair.projectFile.async("string"));
  const entries = Object.keys(zip.files);
  const audioEntries = entries.filter((entry) => normalizeZipPath(entry).startsWith(`${pair.basePath}audio/`));

  return {
    audioEntries,
    entries,
    manifest,
    project,
    sizeBytes: buffer.byteLength,
  };
};

const countVisibleObjects = (frame) =>
  Object.values(frame.objectStates ?? {}).filter((state) => state?.visible !== false).length;

const countHiddenMembers = (project, frame) =>
  (project.members ?? []).filter((member) => {
    const explicitVisibility = frame.memberVisibility?.[member.id];
    const assigned = Object.values(frame.objectAssignments ?? {}).some((memberIds) =>
      Array.isArray(memberIds) && memberIds.includes(member.id),
    );
    return member.visible === false || explicitVisibility === false || assigned;
  }).length;

const findFrameTimeOrderIssues = (frames) => {
  const issues = [];
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1];
    const current = frames[index];
    if ((current.timeSec ?? 0) < (previous.timeSec ?? 0)) {
      issues.push({
        previousIndex: index,
        previousLabel: previous.label,
        previousTimeSec: previous.timeSec,
        index: index + 1,
        label: current.label,
        timeSec: current.timeSec,
      });
    }
  }
  return issues;
};

const summarizeProject = ({ audioEntries, entries, manifest, project, sizeBytes }) => {
  const frames = project.frames ?? [];
  const objects = project.stageObjects ?? [];
  const objectTypeCounts = objects.reduce((acc, object) => {
    const type = object.type ?? "unknown";
    acc[type] = (acc[type] ?? 0) + 1;
    return acc;
  }, {});

  const frameSummaries = frames.map((frame, index) => ({
    index: index + 1,
    id: frame.id,
    label: frame.label,
    timeSec: frame.timeSec,
    positions: Object.keys(frame.positions ?? {}).length,
    objectStates: Object.keys(frame.objectStates ?? {}).length,
    visibleObjects: countVisibleObjects(frame),
    hiddenOrAssignedMembers: countHiddenMembers(project, frame),
    assignments: Object.values(frame.objectAssignments ?? {}).reduce(
      (sum, memberIds) => sum + (Array.isArray(memberIds) ? memberIds.length : 0),
      0,
    ),
  }));

  return {
    source: {
      sizeBytes,
      zipEntries: entries,
    },
    manifest,
    project: {
      title: project.title,
      mode: project.mode ?? "stage",
      version: project.version,
      updatedAt: project.updatedAt,
      stage: project.stage,
      audio: project.audio,
      includesAudioFile: audioEntries.length > 0,
      audioEntries,
      counts: {
        members: project.members?.length ?? 0,
      memberGroups: project.memberGroups?.length ?? 0,
      stageObjects: objects.length,
      objectGroups: project.objectGroups?.length ?? 0,
      frames: frames.length,
      movementPlans: project.movementPlans?.length ?? 0,
      movementPaths: project.movementPaths?.length ?? 0,
      },
      frameTimeOrderIssues: findFrameTimeOrderIssues(frames),
      objectTypeCounts,
      memberGroups: (project.memberGroups ?? []).map((group) => ({
        id: group.id,
        name: group.name,
        members: group.memberIds?.length ?? 0,
      })),
      objectGroups: (project.objectGroups ?? []).map((group) => ({
        id: group.id,
        name: group.name,
        objects: group.objectIds?.length ?? 0,
      })),
      frames: frameSummaries,
    },
  };
};

const main = async () => {
  const zipPath = process.argv[2];
  if (!zipPath) {
    console.error("Usage: node scripts/analyze-project-zip.mjs <path-to-.zip-or-.tairetsu>");
    process.exitCode = 1;
    return;
  }

  const resolvedPath = path.resolve(zipPath);
  const payload = await loadProjectZip(resolvedPath);
  console.log(JSON.stringify(summarizeProject(payload), null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
