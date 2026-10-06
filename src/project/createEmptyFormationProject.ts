import type { NewFormationInput } from "../components/FormationLibrary";
import type { AudioMeta, Project } from "../types";
import { createId } from "../utils/ids";
import { createDefaultParadeSettings, createProjectId } from "./defaults";

/** Factory for a brand-new formation. Defaults here apply to new projects only; normalizeProject owns old-data fallbacks. */
export const createEmptyFormationProject = (
  title: string,
  settings: Pick<
    NewFormationInput,
    | "widthMeters"
    | "heightMeters"
    | "useGlobalStageSize"
    | "gridSizeMeters"
    | "horizontalGuideMode"
    | "memberDiameterMeters"
    | "formationMode"
    | "paradeSettings"
  >,
  audio: AudioMeta | null,
): Project => {
  const now = new Date().toISOString();
  const formationMode = settings.formationMode ?? "stage";
  const paradeSettings =
    formationMode === "parade"
      ? createDefaultParadeSettings(
          settings.paradeSettings ?? {
            width: settings.widthMeters,
            totalDistance: settings.heightMeters,
            cellSizeMeters: settings.gridSizeMeters,
          },
        )
      : undefined;
  const widthMeters =
    formationMode === "parade"
      ? paradeSettings?.width ?? 20
      : Math.max(1, settings.widthMeters);
  const depthMeters =
    formationMode === "parade"
      ? paradeSettings?.totalDistance ?? 100
      : Math.max(1, settings.heightMeters);
  const gridSizeMeters =
    formationMode === "parade"
      ? paradeSettings?.cellSizeMeters ?? 1
      : Math.max(0.05, settings.gridSizeMeters);
  const memberDiameterMeters = Math.min(
    1,
    Math.max(0.1, settings.memberDiameterMeters),
  );
  return {
    id: createProjectId(),
    version: 1,
    title,
    mode: formationMode,
    paradeSettings,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    audio,
    stage: {
      widthMeters,
      depthMeters,
      gridSizeMeters,
      showGrid: true,
      showCenterLine: true,
      audienceSide: "bottom",
      // New formations start without 上手/下手 labels (user decision 2026-10-06); existing data keeps its value.
      showStageLabels: false,
      frontDirection: "bottom",
      originMode: "center",
      showCenterMarker: true,
      memberDiameterMeters,
      horizontalGuideMode: settings.horizontalGuideMode,
      fixedForAllScenes: settings.useGlobalStageSize,
      gridIntervalM: gridSizeMeters,
      horizontalDisplayMode: settings.horizontalGuideMode,
      memberCircleDiameterM: memberDiameterMeters,
    },
    useGlobalStageSize: settings.useGlobalStageSize,
    useGlobalStageWidth: settings.useGlobalStageSize,
    members: [],
    memberGroups: [],
    stageObjects: [],
    objectGroups: [],
    movementPaths: [],
    movementPlans: [],
    animationSettings: {
      membersEnabled: false,
      objectsEnabled: false,
      curtainsEnabled: false,
    },
    guideSettings: {
      snapGuideEnabled: true,
      snapToGuideEnabled: false,
    },
    focusMemberId: undefined,
    // New stages open in the dancers' view (最前 0m at the top; user decision 2026-10-07). Parade always uses the audience view.
    viewerPerspective: formationMode === "parade" ? "audience" : "performer",
    frames: [
      {
        id: createId("f"),
        label: "Scene 1",
        timeSec: 0,
        sceneViewState: undefined,
        positions: {},
        objectStates: {},
      },
    ],
  };
};
