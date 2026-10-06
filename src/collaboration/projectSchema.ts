// Closed vocabulary shared by model, commands and Edge. No storage/UI dependencies.
export const fieldNames = {
  members: ["name", "color", "visible", "zIndex"],
  stageObjects: ["type", "name", "color", "shape", "visible", "locked", "zIndex"],
  scenes: ["label", "section", "timeSec"],
  memberGroups: ["name", "color"], objectGroups: ["name", "color", "defaultType", "defaultShape"],
  movementPlans: ["fromFrameId", "toFrameId", "targetType", "targetId", "enabled", "startSec", "endSec", "note"],
  movementPaths: ["fromFrameId", "toFrameId", "targetType", "targetId", "memberId", "visible"],
};
export const atoms: Partial<Record<string, Record<string, string[]>>> = {
  stageObjects: { geometry: ["defaultX", "defaultY", "widthMeters", "heightMeters", "defaultRotation"] },
  scenes: { stageSize: ["stageWidthMeters", "stageDepthMeters"] },
  objectState: { geometry: ["x", "y", "widthMeters", "heightMeters", "rotation"] },
  movementPlans: { path: ["pathType", "controlPoint", "waypoints"] },
  movementPaths: { path: ["pathType", "type", "controlPoint"] },
};
export const sceneMaps = ["positions", "objectStates", "memberVisibility", "groupVisibility", "memberAppearanceOverrides", "objectAssignments"] as const;

export const settingAtoms: Record<string, string[]> = {
  title: ["title"], mode: ["mode"],
  width: ["stage.widthMeters", "paradeSettings.width"],
  depth: ["stage.depthMeters", "paradeSettings.totalDistance", "paradeSettings.backwardDistanceMeters"],
  grid: ["stage.gridSizeMeters", "stage.gridIntervalM", "paradeSettings.cellSizeMeters"],
  horizontal: ["stage.horizontalGuideMode", "stage.horizontalDisplayMode", "paradeSettings.horizontalMeasureMode"],
  diameter: ["stage.memberDiameterMeters", "stage.memberCircleDiameterM"],
  globalSize: ["useGlobalStageSize", "useGlobalStageWidth", "stage.fixedForAllScenes"],
};
for (const field of ["emphasizeHorizontalNumbers", "emphasizeHorizontalEvery5", "emphasizeHorizontalEvery10", "emphasizeVerticalNumbers", "emphasizeVerticalEvery5m", "emphasizeVerticalEvery10m", "showGrid", "showCenterLine", "audienceSide", "showStageLabels", "frontDirection", "originMode", "showCenterMarker"])
  settingAtoms[`stage.${field}`] = [`stage.${field}`];
for (const field of ["emphasizeHorizontalNumbers", "emphasizeHorizontalEvery5", "emphasizeHorizontalEvery10", "emphasizeVerticalNumbers", "direction", "rulerPosition", "emphasizeEvery5m", "emphasizeEvery10m"])
  settingAtoms[`paradeSettings.${field}`] = [`paradeSettings.${field}`];
for (const field of ["membersEnabled", "objectsEnabled", "curtainsEnabled"])
  settingAtoms[`animationSettings.${field}`] = [`animationSettings.${field}`];
for (const field of ["snapGuideEnabled", "snapToGuideEnabled"])
  settingAtoms[`guideSettings.${field}`] = [`guideSettings.${field}`];

/** New optional OFF flags do not create atoms merely through normalization. */
export const emphasisSettingPaths = new Set(["stage.emphasizeHorizontalNumbers","stage.emphasizeHorizontalEvery5","stage.emphasizeHorizontalEvery10","stage.emphasizeVerticalNumbers","stage.emphasizeVerticalEvery5m","stage.emphasizeVerticalEvery10m","paradeSettings.emphasizeHorizontalNumbers","paradeSettings.emphasizeHorizontalEvery5","paradeSettings.emphasizeHorizontalEvery10","paradeSettings.emphasizeVerticalNumbers"]);
