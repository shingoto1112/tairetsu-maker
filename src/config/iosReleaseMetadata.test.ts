import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

const rootPath = (...parts: string[]) => resolve(process.cwd(), ...parts);

describe("iPad App Store release metadata", () => {
  const infoPlist = readFileSync(rootPath("ios", "App", "App", "Info.plist"), "utf8");
  const project = readFileSync(
    rootPath("ios", "App", "App.xcodeproj", "project.pbxproj"),
    "utf8",
  );
  const audioDocumentPicker = readFileSync(
    rootPath("ios", "App", "App", "AudioDocumentPickerPlugin.swift"),
    "utf8",
  );

  it("declares the Japanese-only iPad app accurately", () => {
    expect(infoPlist).toMatch(
      /<key>CFBundleDevelopmentRegion<\/key>\s*<string>ja<\/string>/,
    );
    expect(infoPlist).toMatch(
      /<key>CFBundleLocalizations<\/key>\s*<array>\s*<string>ja<\/string>\s*<\/array>/,
    );
    expect(project).toContain("developmentRegion = ja;");
    expect(project).toMatch(/knownRegions = \(\s*ja,\s*Base,/);
    expect(project.match(/TARGETED_DEVICE_FAMILY = 2;/g)).toHaveLength(2);
    expect(project.match(/CODE_SIGN_IDENTITY = "iPhone Developer";/g)).toHaveLength(1);
    expect(project).not.toContain('CODE_SIGN_IDENTITY = "Apple Distribution";');
  });

  it("does not request capture permissions and declares exempt encryption", () => {
    expect(infoPlist).toMatch(
      /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/,
    );
    expect(infoPlist).not.toContain("NSCameraUsageDescription");
    expect(infoPlist).not.toContain("NSMicrophoneUsageDescription");
    expect(infoPlist).not.toContain("NSPhotoLibraryUsageDescription");
  });

  it("uses an audio-only document picker without a camera capture path", () => {
    expect(audioDocumentPicker).toContain("UIDocumentPickerViewController");
    expect(audioDocumentPicker).toMatch(/forOpeningContentTypes:\s*\[\.audio\]/);
    expect(audioDocumentPicker).not.toContain("UIImagePickerController");
    expect(audioDocumentPicker).not.toContain("AVCapture");
  });

  it("ships a final opaque 1024px App Store icon", () => {
    const icon = PNG.sync.read(
      readFileSync(
        rootPath(
          "ios",
          "App",
          "App",
          "Assets.xcassets",
          "AppIcon.appiconset",
          "AppIcon-512@2x.png",
        ),
      ),
    );

    expect(icon.width).toBe(1024);
    expect(icon.height).toBe(1024);
    let isOpaque = true;
    for (let alphaIndex = 3; alphaIndex < icon.data.length; alphaIndex += 4) {
      if (icon.data[alphaIndex] !== 255) {
        isOpaque = false;
        break;
      }
    }
    expect(isOpaque).toBe(true);
  });
});
