import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// Windows preflight only: no Xcode, Swift, package resolution or workflow execution.
const projectPath = "ios/App/App.xcodeproj/project.pbxproj";
const text = readFileSync(projectPath, "utf8");
const definitions = [...text.matchAll(/^\t\t([A-F0-9]{24})(?: \/\*.*?\*\/)? = \{/gm)].map(m => m[1]);
assert.equal(new Set(definitions).size, definitions.length, "duplicate pbxproj object UUID");
for (const match of text.matchAll(/\b[A-F0-9]{24}\b/g)) assert.ok(definitions.includes(match[0]), `unresolved UUID ${match[0]}`);
const section = name => {
  const match = text.match(new RegExp(`/\\* Begin ${name} section \\*/([\\s\\S]*?)/\\* End ${name} section \\*/`));
  assert.ok(match, `missing ${name}`); return match[1];
};
const file = "A7A140002FE9D1A100000001", build = "A7A140012FE9D1A100000001";
assert.ok(section("PBXBuildFile").includes(`${build} /* ProjectRepositoryPlugin.swift in Sources */ = {isa = PBXBuildFile; fileRef = ${file}`));
assert.ok(section("PBXFileReference").includes(`${file} /* ProjectRepositoryPlugin.swift */ = {isa = PBXFileReference;`));
assert.ok(section("PBXGroup").includes(`${file} /* ProjectRepositoryPlugin.swift */,`));
assert.ok(section("PBXSourcesBuildPhase").includes(`${build} /* ProjectRepositoryPlugin.swift in Sources */,`));
assert.ok(existsSync("ios/App/App/ProjectRepositoryPlugin.swift"));
assert.ok(section("PBXFrameworksBuildPhase").includes("A7A140042FE9D1A100000001"));
assert.ok(section("PBXNativeTarget").includes("A7A140032FE9D1A100000001"));
assert.ok(section("PBXProject").includes("A7A140022FE9D1A100000001"));
assert.ok(section("XCSwiftPackageProductDependency").includes("package = A7A140022FE9D1A100000001"));
assert.ok(section("XCLocalSwiftPackageReference").includes('relativePath = "../ProjectRepositoryCore"'));
assert.ok(existsSync(path.resolve("ios/App", "../ProjectRepositoryCore/Package.swift")));
const testFile = "ios/ProjectRepositoryCore/Tests/ProjectRepositoryCoreTests/RepositoryTests.swift";
let fixtureRoot = path.resolve(testFile);
for (let i = 0; i < 5; i++) fixtureRoot = path.dirname(fixtureRoot);
for (const name of ["operations", "commitProjects", "ids"]) {
  const filePath = path.join(fixtureRoot, "src/repositories/contract/fixtures", `${name}.json`);
  assert.ok(existsSync(filePath), `Swift fixture path ${name}`);
  JSON.parse(readFileSync(filePath, "utf8"));
}
const workflow = readFileSync(".github/workflows/ios-build.yml", "utf8");
assert.ok(!/^\s+push:/m.test(workflow), "push trigger must be absent");
assert.ok(workflow.includes("swift test --package-path ios/ProjectRepositoryCore"));
assert.ok(workflow.includes("cancel-in-progress: true"));
assert.ok(workflow.includes('if: ${{ !cancelled() }}'));
const appFiles = ["src/App.tsx", "src/main.tsx", "src/platform/index.ts"];
for (const filePath of appFiles) if (existsSync(filePath)) assert.ok(!readFileSync(filePath, "utf8").includes("nativeSqliteRepository"));
console.log(`Native preflight: ${definitions.length} unique/resolved pbxproj UUIDs; plugin's four references; local package/product/framework; 3 original Swift fixture paths; workflow; adapter behind lazy boundary: PASS`);

// Compile the actual Swift SQL literals on the locally bundled SQLite, in memory.
// This detects syntax/reference errors, but does NOT execute Swift or replace XCTest.
const core = readFileSync("ios/ProjectRepositoryCore/Sources/ProjectRepositoryCore/ProjectRepository.swift", "utf8");
const bridge = readFileSync("ios/App/App/ProjectRepositoryPlugin.swift", "utf8");
const methods = [...bridge.matchAll(/CAPPluginMethod\(name: "([^"]+)"/g)].map(m => m[1]);
assert.equal(methods.length, 17);
assert.equal(new Set(methods).size, methods.length);
for (const method of methods) {
  assert.ok(bridge.includes(`@objc func ${method}(`), `bridge method ${method}`);
  assert.ok(core.includes(`"${method}"`), `core dispatch ${method}`);
}
assert.ok(core.includes('CREATE TABLE migration_items (source_key TEXT PRIMARY KEY, state_json TEXT NOT NULL)'));
assert.ok(core.includes('size.int64Value == 0 || size.int64Value >= 100'));
assert.ok(core.includes('rows("SELECT name FROM sqlite_master").isEmpty'));
assert.ok(core.includes('try scan("SELECT source_key FROM migration_items")'));
const swiftTests = readFileSync(testFile, "utf8");
assert.ok(swiftTests.includes('environment["REPOSITORY_PERF"] == "1" ? 1000 : 200'));
assert.ok(swiftTests.includes('reopen=%.2fms'));
for (const method of ["testEmptyDatabaseAfterInterruptedCreationIsNew", "testMigrationStateContractAndResponseLossDoesNotOverwriteEdits",
  "testMigrationAtomicRollbackAndResume", "testMigrationRecoveryDuplicateDraftAndDeletedTarget"]) assert.ok(swiftTests.includes(`func ${method}(`));
const bootstrap = readFileSync("src/storage/bootstrap.ts", "utf8");
for (const module of ["migrationCoordinator", "nativeSqliteRepository", "indexedDbRepository"]) {
  assert.ok(bootstrap.includes(`import("${module === "migrationCoordinator" ? "./" : "../repositories/"}${module}")`));
}
const readers = readFileSync("src/storage/legacyReaders.ts", "utf8");
assert.ok(!/Filesystem\.(writeFile|deleteFile|rename|mkdir|copy|appendFile)/.test(readers));
assert.ok(readers.includes('e.code === "OS-PLUG-FILE-0008"'));
for (const filePath of appFiles) if (existsSync(filePath)) assert.ok(!/storage\/bootstrap|migrationCoordinator/.test(readFileSync(filePath, "utf8")));
const appStorage = readFileSync("src/storage/appRepository.ts", "utf8");
assert.ok(appStorage.includes('import("./bootstrap")'));
assert.ok(appStorage.includes("includeDrafts: false"));
assert.ok(readFileSync("src/App.tsx", "utf8").includes("await prepareAppRepository("));
console.log("Migration/maintenance preflight: 17 fixed bridge methods; reserved SQLite schema 1; empty DB guard; connected lazy bootstrap; read-only readers: PASS");
const database = new DatabaseSync(":memory:");
try {
  database.exec("PRAGMA foreign_keys=ON");
  const blocks = [...core.matchAll(/try run\("""\s*([\s\S]*?)\s*"""/g)].map(m => m[1]);
  for (const table of ["project_bodies", "project_previous"]) {
    const foreign = table === "project_previous" ? ", FOREIGN KEY(id) REFERENCES project_bodies(id) ON DELETE CASCADE" : "";
    database.exec(blocks[0].replaceAll("\\(table)", table).replaceAll("\\(foreign)", foreign));
  }
  database.exec(blocks[1]);
  for (const match of core.matchAll(/try run\("(CREATE (?:INDEX|TABLE).*?)"\)/g)) database.exec(match[1]);
  for (const sql of blocks.slice(2)) {
    if (sql.startsWith("CREATE ")) database.exec(sql); else database.prepare(sql);
  }
  let count = 0;
  for (const match of core.matchAll(/(?:rows|run|scan)\("((?:SELECT|DELETE|INSERT|BEGIN|COMMIT|ROLLBACK|PRAGMA)[^"\n]*)"/g)) {
    if (match[1].includes("\\(")) continue;
    database.prepare(match[1]); count++;
  }
  assert.equal(database.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get().n, 6);
  assert.equal(0x544d5632, 1414354482);
  const ids = JSON.parse(readFileSync("src/repositories/contract/fixtures/ids.json", "utf8"));
  assert.equal(ids.length, 24);
  console.log(`SQLite SQL preflight: 6 tables / 2 explicit indexes; mutation blocks + ${count} literal statements prepare; 24 ID fixture entries: PASS (not a Swift runtime test)`);
} finally { database.close(); }

// Audio lives in the same local package; its bridge extends the already-linked picker.
const audioCorePath = "ios/ProjectRepositoryCore/Sources/ProjectRepositoryCore/AudioStore.swift";
const audioTestPath = "ios/ProjectRepositoryCore/Tests/ProjectRepositoryCoreTests/AudioStoreTests.swift";
const audioCore = readFileSync(audioCorePath, "utf8");
const audioTests = readFileSync(audioTestPath, "utf8");
const audioBridge = readFileSync("ios/App/App/AudioDocumentPickerPlugin.swift", "utf8");
const audioMethods = [...audioBridge.matchAll(/CAPPluginMethod\(name: "([^"]+)"/g)].map(m => m[1]);
assert.equal(audioMethods.length, 6);
assert.equal(new Set(audioMethods).size, 6);
for (const method of audioMethods) assert.ok(audioBridge.includes(`@objc func ${method}(`));
for (const name of ["PBXBuildFile", "PBXFileReference", "PBXGroup", "PBXSourcesBuildPhase"]) {
  assert.ok(section(name).includes("AudioDocumentPickerPlugin.swift"), `existing picker reference ${name}`);
}
assert.deepEqual([...audioCore.matchAll(/^import (\w+)$/gm)].map(m => m[1]), ["Foundation"]);
assert.ok(audioCore.includes("completeUntilFirstUserAuthentication"));
assert.ok(!audioCore.includes("isExcludedFromBackup = true"));
assert.ok(audioCore.includes("try fm.replaceItemAt(index, withItemAt: pending)"));
assert.ok(audioCore.includes("try equalFiles(source, staged)"));
assert.ok(!/Filesystem\.(writeFile|deleteFile)/.test(readFileSync("src/platform/audioStorage.ts", "utf8")));
assert.equal((audioTests.match(/func test\w+\(/g) ?? []).length, 15);
assert.ok(core.includes('if method == "restoreRecoveryBackup"'));
assert.ok(core.includes('try restoreRecoveryBackupLocked(); try connection(); return "null"'));
assert.ok(core.includes('guard input.isEmpty else'));
assert.ok(core.includes('try backupReferences()'));
assert.ok(core.includes('private func draftAudioReferences()'));
assert.ok(core.includes('try draftAudioReferences()'));
for (const method of ["testFixedBridgeRecoveryClosesRestoresReopensAndRejectsOtherConnection", "testRecoveryBackupScheduleAndLowSpaceSkip", "testRepositoryAudioGCProtectsPreviousRecoveryIncompleteAndBackup"]) assert.ok(swiftTests.includes(`func ${method}(`));
assert.ok(audioCore.includes('Self.activeUploadPaths'));
assert.ok(audioCore.includes('record.pending == true'));
console.log("Audio/maintenance preflight: 6 picker methods / Foundation-only audio core / 15 XCTest cases / pending and active upload protection / fixed restore+reopen: PASS (not Swift compilation)");
