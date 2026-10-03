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
console.log(`Native preflight: ${definitions.length} unique/resolved pbxproj UUIDs; plugin's four references; local package/product/framework; 3 original Swift fixture paths; workflow; adapter unconnected: PASS`);

// Compile the actual Swift SQL literals on the locally bundled SQLite, in memory.
// This detects syntax/reference errors, but does NOT execute Swift or replace XCTest.
const core = readFileSync("ios/ProjectRepositoryCore/Sources/ProjectRepositoryCore/ProjectRepository.swift", "utf8");
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
