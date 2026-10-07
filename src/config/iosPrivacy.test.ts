// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

function parsePlist(path: string): Record<string, unknown> {
  const xml = new DOMParser().parseFromString(readFileSync(path, "utf8"), "application/xml");
  expect(xml.querySelector("parsererror")).toBeNull();
  expect(xml.documentElement.tagName).toBe("plist");
  function value(element: Element): unknown {
    const children = [...element.children];
    if (element.tagName === "dict") {
      expect(children.length % 2).toBe(0); const result: Record<string, unknown> = {};
      for (let i = 0; i < children.length; i += 2) {
        expect(children[i].tagName).toBe("key"); const key = children[i].textContent!;
        expect(key in result).toBe(false); result[key] = value(children[i + 1]);
      }
      return result;
    }
    if (element.tagName === "array") return children.map(value);
    if (element.tagName === "true" || element.tagName === "false") return element.tagName === "true";
    expect(element.tagName).toBe("string"); return element.textContent;
  }
  expect(xml.documentElement.children).toHaveLength(1);
  return value(xml.documentElement.children[0]) as Record<string, unknown>;
}
it("validates Privacy Manifest XML/plist structure, adds disk capacity reason, preserves timestamp", () => {
  const manifest = parsePlist("ios/App/App/PrivacyInfo.xcprivacy");
  expect(manifest.NSPrivacyAccessedAPITypes).toEqual(expect.arrayContaining([
    { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryDiskSpace", NSPrivacyAccessedAPITypeReasons: ["E174.1"] },
    { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp", NSPrivacyAccessedAPITypeReasons: ["C617.1"] },
  ]));
});
it("validates Info.plist, disables Documents exposure, does not register document handling", () => {
  const info = parsePlist("ios/App/App/Info.plist");
  expect(info.UIFileSharingEnabled).toBeUndefined(); expect(info.LSSupportsOpeningDocumentsInPlace).toBeUndefined();
  expect(info.CFBundleDocumentTypes).toBeUndefined();
  expect(info.UTExportedTypeDeclarations).toBeUndefined();
  const delegate = readFileSync("ios/App/App/SceneDelegate.swift", "utf8");
  expect(delegate).toContain("SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)");
});
it("explicitly disables Capacitor logs and keeps sensitive ZIP contents out of console", () => {
  expect(readFileSync("capacitor.config.ts", "utf8")).toContain('loggingBehavior: "none"');
  expect(readFileSync("src/utils/tairetsuFile.ts", "utf8")).not.toMatch(/console\.(info|warn|log)/);
  expect(readFileSync("src/App.tsx", "utf8")).toContain('console.warn("iPadのログイン情報を復元できませんでした。");');
});
