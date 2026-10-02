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

  it("describes only adding exported images to Photos in Japanese", () => {
    const description = infoPlist.match(/<key>NSPhotoLibraryAddUsageDescription<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
    expect(description).toBe("書き出した隊列表や名簿などの画像を写真アプリに保存するために使用します。");
    expect(description).toMatch(/[ぁ-んァ-ン一-龯]/);
    expect(infoPlist.match(/<key>NSPhotoLibraryAddUsageDescription<\/key>/g)).toHaveLength(1);
  });

  it("registers the export share plugin in the bridge and Xcode Sources", () => {
    const bridge = readFileSync(rootPath("ios", "App", "App", "TairetsuBridgeViewController.swift"), "utf8");
    const plugin = readFileSync(rootPath("ios", "App", "App", "ExportSharePlugin.swift"), "utf8");
    expect(bridge).toContain("registerPluginInstance(ExportSharePlugin())");
    expect(project).toContain("path = ExportSharePlugin.swift;");
    expect(project).toContain("A7A130012FE9D1A100000001 /* ExportSharePlugin.swift in Sources */,");
    expect(plugin).toContain('let jsName = "ExportShare"');
    expect(plugin).toContain("popover.sourceView = view");
    expect(plugin).toContain("popover.sourceRect = CGRect");
    expect(plugin).not.toContain("requestAuthorization");
  });

  it("keeps scene lifecycle wiring and the iOS 15 minimum deployment target", () => {
    const sceneDelegate = readFileSync(rootPath("ios", "App", "App", "SceneDelegate.swift"), "utf8");
    expect(infoPlist).toContain("UIApplicationSceneManifest");
    expect(infoPlist).toContain("$(PRODUCT_MODULE_NAME).SceneDelegate");
    expect(sceneDelegate).toContain("UIWindowSceneDelegate");
    expect(sceneDelegate).toContain("TairetsuBridgeViewController()");
    expect(sceneDelegate).toContain("SceneDelegateProxy.shared.scene");
    expect(project).toContain("SceneDelegate.swift in Sources");
    const targets = [...project.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([\d.]+);/g)];
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every((match) => match[1] === "15.0")).toBe(true);
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
