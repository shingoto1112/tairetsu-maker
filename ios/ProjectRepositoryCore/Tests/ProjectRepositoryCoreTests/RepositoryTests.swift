import Foundation
import XCTest
import SQLite3
@testable import ProjectRepositoryCore

private final class CASResults {
    private let lock = NSLock()
    private(set) var successes = 0
    private(set) var codes: [String] = []
    func record(_ error: Error? = nil) {
        lock.lock(); defer { lock.unlock() }
        if let e = error { codes.append((e as? RepositoryError)?.code ?? "unknown") } else { successes += 1 }
    }
}

final class RepositoryTests: XCTestCase {
    private var directory: URL!
    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("repository-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try FileManager.default.removeItem(at: directory) }
    private func repo(_ name: String = "repository.sqlite") -> ProjectRepository { ProjectRepository(databaseURL: directory.appendingPathComponent(name)) }
    private func fixture(_ name: String) throws -> Data {
        // #filePath -> Tests -> ProjectRepositoryCore -> ios -> checkout root.
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try Data(contentsOf: root.appendingPathComponent("src/repositories/contract/fixtures/\(name).json"))
    }
    private func fixtureObject(_ name: String) throws -> [String: Any] {
        let data = try fixture(name)
        let value = try JSONSerialization.jsonObject(with: data)
        return try XCTUnwrap(value as? [String: Any])
    }
    private func execute(_ r: ProjectRepository, _ method: String, _ input: [String: Any] = [:]) throws -> Any {
        let text = try r.execute(method, requestJSON: RepositoryValidation.json(input))
        return try JSONSerialization.jsonObject(with: Data(text.utf8), options: [.fragmentsAllowed])
    }
    private func request(_ step: [String: Any], _ projects: [String: Any]) throws -> [String: Any] {
        var p = try XCTUnwrap(projects[step["projectKey"] as? String ?? ""] as? [String: Any])
        for (key, value) in step["patch"] as? [String: Any] ?? [:] { p[key] = value }
        return ["id":p["id"]!,"json":try RepositoryValidation.json(p),"operationId":step["operationId"]!,
                "localRevision":step["localRevision"]!,"expectedRepositoryRevision":step["expectedRepositoryRevision"]!]
    }
    private func initial(_ operation: String = "create") throws -> [String: Any] {
        let projects = try fixtureObject("commitProjects")
        return try request(["projectKey":"stage","patch":[String: Any](),"operationId":operation,"localRevision":"1","expectedRepositoryRevision":NSNull()], projects)
    }
    private func record(_ r: ProjectRepository, _ id: String) throws -> Any {
        let raw = try execute(r, "readProject", ["id":id])
        guard var obj = raw as? [String: Any] else { return raw }
        obj["project"] = try JSONSerialization.jsonObject(with: Data((obj.removeValue(forKey: "json") as! String).utf8))
        return obj
    }
    private func subset(_ actual: Any?, _ expected: Any, _ context: String, file: StaticString = #filePath, line: UInt = #line) {
        if let dict = expected as? [String: Any] {
            guard let actual = actual as? [String: Any] else { XCTFail("\(context): missing object", file: file, line: line); return }
            for (key, value) in dict { subset(actual[key], value, context + "." + key, file: file, line: line) }
        } else if let array = expected as? [Any] {
            guard let actual = actual as? [Any] else { XCTFail("\(context): missing array", file: file, line: line); return }
            XCTAssertEqual(actual.count, array.count, context, file: file, line: line)
            for (a, e) in zip(actual, array) { subset(a, e, context, file: file, line: line) }
        } else {
            // Report paths only, never member names or project bodies.
            XCTAssertTrue((actual as? NSObject)?.isEqual(expected) == true, context, file: file, line: line)
        }
    }
    private func verifySummary(_ r: ProjectRepository, _ s: [String: Any]) throws {
        let value = try record(r, s["id"] as! String)
        let obj = try XCTUnwrap(value as? [String: Any])
        let p = obj["project"] as! [String: Any]
        var expected: [String: Any] = ["id":p["id"]!,"title":p["title"]!,"mode":p["mode"] ?? "stage",
            "createdAt":p["createdAt"] ?? p["updatedAt"]!,"updatedAt":p["updatedAt"]!,
            "memberCount":(p["members"] as! [Any]).count,"sceneCount":(p["frames"] as! [Any]).count,
            "repositoryRevision":obj["repositoryRevision"]!,"syncStatus":"local"]
        expected["lastOpenedAt"] = p["lastOpenedAt"]
        expected["audioId"] = (p["audio"] as? [String: Any])?["id"]
        XCTAssertTrue(NSDictionary(dictionary: s).isEqual(to: expected), "summary/body mismatch")
    }
    private func verifyReceipt(_ r: ProjectRepository, _ value: Any, request: [String: Any]? = nil) throws {
        let receipt = try XCTUnwrap(value as? [String: Any]), s = try XCTUnwrap(receipt["summary"] as? [String: Any])
        subset(receipt, ["id":s["id"]!,"repositoryRevision":s["repositoryRevision"]!], "receipt")
        if let current = try record(r, receipt["id"] as! String) as? [String: Any],
           current["repositoryRevision"] as? String == receipt["repositoryRevision"] as? String {
            try verifySummary(r, s)
            subset(current, ["localRevision":receipt["localRevision"]!], "stored revision")
            if let req = request {
                let project = try JSONSerialization.jsonObject(with: Data((req["json"] as! String).utf8))
                XCTAssertTrue((current["project"] as? NSDictionary)?.isEqual(project) == true, "snapshot mismatch")
            }
        }
        if let req = request { subset(receipt, ["operationId":req["operationId"]!,"localRevision":req["localRevision"]!], "submitted snapshot") }
    }

    func testSharedJSONContract() throws {
        let projects = try fixtureObject("commitProjects"), operations = try fixtureObject("operations")
        XCTAssertEqual(operations["formatVersion"] as? Int, 1)
        var count = 0
        for (scenarioIndex, scenario) in (operations["scenarios"] as! [[String: Any]]).enumerated() {
            let r = repo("scenario-\(scenarioIndex).sqlite"); defer { r.close() }
            subset(try execute(r, "initialize"), ["status":"ready","errors":[String]()] as [String: Any], "initialize")
            var previousCursor: String?
            for (index, step) in (scenario["steps"] as! [[String: Any]]).enumerated() {
                let op = step["op"] as! String, expected = step["expect"]!
                let context = "scenario \(scenarioIndex), step \(index+1), \(op)"
                var result: Any = NSNull()
                do {
                    switch op {
                    case "commit":
                        let req = try request(step, projects)
                        result = try execute(r, "commitProject", req); try verifyReceipt(r, result, request: req)
                    case "get":
                        result = try record(r, step["id"] as! String)
                        if var detached = result as? [String: Any], var p = detached["project"] as? [String: Any] {
                            p["title"] = "detached mutation"; detached["project"] = p
                            XCTAssertTrue((try record(r, step["id"] as! String) as? NSDictionary)?.isEqual(result) == true, "detached read")
                        }
                    case "list":
                        var q = step["query"] as! [String: Any]
                        if q.removeValue(forKey: "usePreviousCursor") as? Bool == true { q["cursor"] = try XCTUnwrap(previousCursor) }
                        let page = try execute(r, "listSummaries", q) as! [String: Any]
                        previousCursor = page["nextCursor"] as? String
                        let items = page["items"] as! [[String: Any]]
                        for s in items { try verifySummary(r, s) }
                        result = ["ids":items.map { $0["id"]! },"hasNext":previousCursor != nil] as [String: Any]
                    case "rename":
                        result = try execute(r, "renameProject", step["input"] as! [String: Any]); try verifyReceipt(r, result)
                    case "remove": result = try execute(r, "removeProject", step["input"] as! [String: Any])
                    case "touchOpened":
                        result = try execute(r, "touchOpened", ["id":step["id"]!,"openedAt":step["at"]!]); try verifySummary(r, result as! [String: Any])
                    case "duplicate":
                        let source = try record(r, step["sourceId"] as! String) as! [String: Any]
                        var p = source["project"] as! [String: Any]
                        for key in ["id","title"] { p[key] = step[key] }
                        p["createdAt"] = step["at"]; p["updatedAt"] = step["at"]; p.removeValue(forKey: "lastOpenedAt")
                        let req: [String: Any] = ["id":p["id"]!,"json":try RepositoryValidation.json(p),"operationId":step["operationId"]!,"localRevision":"1","expectedRepositoryRevision":NSNull()]
                        result = try execute(r, "commitProject", req); try verifyReceipt(r, result, request: req)
                    case "concurrentCommits":
                        // Same-instance queue is covered here; independent connections below race on SQLite.
                        var successes = 0, errors: [String] = []
                        for req in step["requests"] as! [[String: Any]] {
                            let input = try request(req, projects)
                            do { let receipt = try execute(r, "commitProject", input); successes += 1; try verifyReceipt(r, receipt, request: input) }
                            catch let e as RepositoryError { errors.append(e.code) }
                        }
                        result = ["successes":successes,"errors":errors] as [String: Any]
                    case "commitWithEdit":
                        let req = try request(step, projects), snapshot = req["json"] as! String
                        let receipt = try execute(r, "commitProject", req) as! [String: Any]
                        // String request is a detached captured snapshot. Editor changes cannot alter it.
                        var editor = try RepositoryValidation.object(snapshot); editor["title"] = step["editedTitle"]
                        XCTAssertNotEqual(try RepositoryValidation.json(editor), snapshot, "editor changed")
                        try verifyReceipt(r, receipt, request: req)
                        result = ["receiptLocalRevision":receipt["localRevision"]!,"editorLocalRevision":step["editorLocalRevision"]!,
                                  "dirty":RepositoryValidation.greater(step["editorLocalRevision"] as! String, receipt["localRevision"] as! String)] as [String: Any]
                    default: XCTFail("unhandled fixture operation"); continue
                    }
                } catch let e as RepositoryError {
                    if let code = (expected as? [String: Any])?["error"] as? String {
                        XCTAssertEqual(e.code, code, context); count += 1; continue
                    }
                    XCTFail(context + ": " + e.code); throw e
                }
                XCTAssertNil((expected as? [String: Any])?["error"], context + ": expected failure")
                subset(result, expected, context); count += 1
            }
        }
        XCTAssertEqual(count, 50)
        print("Repository contract: 2 scenarios, \(count) steps")
    }

    func testUnmodifiedIDFixture() throws {
        let data = try fixture("ids")
        let text = try XCTUnwrap(String(data: data, encoding: .utf8))
        // Foundation cannot decode lone UTF-16 surrogates into Swift Strings.
        // Read each original object separately so those two negative cases do not
        // prevent all the remaining fixture cases from being decoded.
        var objects: [String] = [], start: String.Index?, inString = false, escaped = false
        for i in text.indices {
            let c = text[i]
            if inString {
                if escaped { escaped = false } else if c == "\\" { escaped = true } else if c == "\"" { inString = false }
            } else if c == "\"" { inString = true }
            else if c == "{" { start = i }
            else if c == "}", let s = start { objects.append(String(text[s...i])); start = nil }
        }
        XCTAssertEqual(objects.count, 24)
        for raw in objects {
            if raw.contains("\\ud800") || raw.contains("\\udc00") {
                XCTAssertTrue(raw.contains("\"valid\": false"))
                XCTAssertTrue(RepositoryValidation.hasUnpairedSurrogateEscape(raw))
                XCTAssertThrowsError(try RepositoryValidation.object(raw), "lone surrogate must not enter native String")
            } else {
                let obj = try RepositoryValidation.object(raw)
                XCTAssertEqual(RepositoryValidation.validID(obj["value"]), obj["valid"] as? Bool, "ID fixture")
            }
        }
    }

    // Raw SQL is confined to XCTest; no production SQL/path API is exposed.
    private func raw(_ body: (OpaquePointer) throws -> Void) throws {
        var h: OpaquePointer?
        XCTAssertEqual(sqlite3_open(directory.appendingPathComponent("repository.sqlite").path, &h), SQLITE_OK)
        let handle = try XCTUnwrap(h); defer { sqlite3_close(handle) }; try body(handle)
    }
    private func snapshot() throws -> [String] {
        var values: [String] = []
        try raw { h in
            for table in ["project_bodies","project_summaries","project_previous","operation_receipts","personal_sync","migration_items"] {
                var s: OpaquePointer?
                XCTAssertEqual(sqlite3_prepare_v2(h, "SELECT * FROM \(table) ORDER BY 1", -1, &s, nil), SQLITE_OK)
                let statement = try XCTUnwrap(s); defer { sqlite3_finalize(statement) }
                while sqlite3_step(statement) == SQLITE_ROW {
                    var columns: [String] = []
                    for i in 0..<sqlite3_column_count(statement) {
                        if let p = sqlite3_column_text(statement, i) {
                            let bytes = Data(bytes: p, count: Int(sqlite3_column_bytes(statement, i)))
                            columns.append(try XCTUnwrap(String(data: bytes, encoding: .utf8)))
                        } else { columns.append("<null>") }
                    }
                    values.append(table + columns.joined(separator: "|"))
                }
            }
        }
        return values
    }
    func testFailureInjectionLeavesAllTablesUnchanged() throws {
        let r = repo(); defer { r.close() }
        _ = try execute(r, "commitProject", initial())
        var update = try initial("update")
        update["expectedRepositoryRevision"] = "1"; update["localRevision"] = "2"
        for phase in ["afterPrevious","afterBody","afterSummary","afterReceipt","beforeCommit"] {
            let before = try snapshot()
            r.fault = { if $0 == phase { throw RepositoryError("NO_SPACE") } }
            XCTAssertThrowsError(try execute(r, "commitProject", update)) { XCTAssertEqual(($0 as? RepositoryError)?.code, "NO_SPACE") }
            r.fault = nil
            XCTAssertTrue(try snapshot() == before, "all tables unchanged at \(phase)")
        }
        let metadataFailures: [(String, [String: Any])] = [
            ("renameProject", ["id":"project_a","title":"rename-fail","updatedAt":"2026-01-02T00:00:00.000Z","localRevision":"2","expectedRepositoryRevision":"1","operationId":"rename-fail"]),
            ("touchOpened", ["id":"project_a","openedAt":"2026-01-03T00:00:00.000Z"])
        ]
        for (method, input) in metadataFailures {
            let before = try snapshot()
            r.fault = { if $0 == "afterSummary" { throw RepositoryError("IO_ERROR") } }
            XCTAssertThrowsError(try execute(r, method, input))
            r.fault = nil
            XCTAssertTrue(try snapshot() == before, "\(method) preserves body, previous, summary, receipts")
        }
        _ = try execute(r, "commitProject", update)
        let before = try snapshot()
        r.fault = { if $0 == "afterReceipt" { throw RepositoryError("IO_ERROR") } }
        XCTAssertThrowsError(try execute(r, "removeProject", ["id":"project_a","expectedRepositoryRevision":"2","operationId":"remove-fail"]))
        r.fault = nil
        XCTAssertTrue(try snapshot() == before, "delete cascades and receipt rolled back")
    }
    func testReopenPersistenceAndOldReceiptAfterFurtherEditsAndDelete() throws {
        let r = repo(), create = try initial()
        let receipt = try r.execute("commitProject", requestJSON: RepositoryValidation.json(create))
        r.close()
        let reopened = repo(); defer { reopened.close() }
        XCTAssertEqual(try reopened.execute("commitProject", requestJSON: RepositoryValidation.json(create)), receipt)
        var update = try initial("update"); update["localRevision"] = "999999999999999999999999999999"; update["expectedRepositoryRevision"] = "1"
        _ = try execute(reopened, "commitProject", update)
        _ = try execute(reopened, "removeProject", ["id":"project_a","expectedRepositoryRevision":"2","operationId":"delete"])
        reopened.close()
        XCTAssertEqual(try reopened.execute("commitProject", requestJSON: RepositoryValidation.json(create)), receipt)
        XCTAssertTrue(try record(reopened, "project_a") is NSNull)
    }
    func testTwoConnectionsCAS() throws {
        let first = repo(), second = repo(); defer { first.close(); second.close() }
        _ = try execute(first, "commitProject", initial()); _ = try execute(second, "initialize")
        let group = DispatchGroup(), results = CASResults()
        for (i, r) in [first, second].enumerated() {
            var update = try initial("cas-\(i)"); update["expectedRepositoryRevision"] = "1"; update["localRevision"] = "2"
            let json = try RepositoryValidation.json(update)
            group.enter()
            DispatchQueue.global().async {
                defer { group.leave() }
                do { _ = try r.execute("commitProject", requestJSON: json); results.record() }
                catch { results.record(error) }
            }
        }
        XCTAssertEqual(group.wait(timeout: .now() + 15), .success)
        XCTAssertEqual(results.successes, 1); XCTAssertEqual(results.codes, ["CONFLICT"])
    }
    func testNOTADBIsPreservedAndCRCDetectsCorruption() throws {
        let path = directory.appendingPathComponent("repository.sqlite")
        let corrupt = Data(repeating: 0x41, count: 512); try corrupt.write(to: path)
        let r = repo(); defer { r.close() }
        XCTAssertThrowsError(try execute(r, "initialize")) { XCTAssertEqual(($0 as? RepositoryError)?.code, "CORRUPT") }
        XCTAssertEqual(try Data(contentsOf: path), corrupt)
        // A fresh separate database proves integrity checks reject logical body corruption.
        try FileManager.default.removeItem(at: path)
        _ = try execute(r, "commitProject", initial())
        try raw { XCTAssertEqual(sqlite3_exec($0, "UPDATE project_bodies SET json='{}'", nil, nil, nil), SQLITE_OK) }
        XCTAssertThrowsError(try record(r, "project_a")) { XCTAssertEqual(($0 as? RepositoryError)?.code, "CORRUPT") }
        // Listing still reads only the summary table; corrupt body isn't parsed for list.
        XCTAssertEqual((try execute(r, "listSummaries", ["limit":100]) as? [String: Any])?["items"] as? [[String: Any]] != nil, true)
        XCTAssertThrowsError(try execute(r, "createRecoveryBackup"))
    }
    func testBackupValidationReplacementAndRestore() throws {
        let r = repo(); defer { r.close() }
        _ = try execute(r, "commitProject", initial())
        _ = try execute(r, "createRecoveryBackup")
        _ = try execute(r, "createRecoveryBackup") // Exercise replacement of an existing valid backup.
        let backup = directory.appendingPathComponent("recovery/repository.backup.sqlite")
        let originalBackup = try Data(contentsOf: backup)
        try raw { XCTAssertEqual(sqlite3_exec($0, "UPDATE project_bodies SET crc32='bad'", nil, nil, nil), SQLITE_OK) }
        XCTAssertThrowsError(try execute(r, "createRecoveryBackup"))
        XCTAssertEqual(try Data(contentsOf: backup), originalBackup, "failed backup preserves last verified copy")
        let other = repo(); _ = try execute(other, "initialize")
        XCTAssertThrowsError(try r.restoreRecoveryBackup()) { XCTAssertEqual(($0 as? RepositoryError)?.code, "BUSY") }
        other.close(); r.close()
        try Data(repeating: 0x42, count: 512).write(to: directory.appendingPathComponent("repository.sqlite"))
        try r.restoreRecoveryBackup()
        subset(try record(r, "project_a"), ["repositoryRevision":"1","localRevision":"1"], "restored")
        let names = try FileManager.default.contentsOfDirectory(atPath: directory.path)
        XCTAssertTrue(names.contains { $0.hasPrefix("repository.quarantine-") })
    }
    func testInvalidBackupDoesNotReplaceCurrentDatabase() throws {
        let r = repo(); defer { r.close() }
        _ = try execute(r, "commitProject", initial())
        _ = try execute(r, "createRecoveryBackup")
        let before = try snapshot()
        try Data(repeating: 0x43, count: 512).write(to: directory.appendingPathComponent("recovery/repository.backup.sqlite"))
        XCTAssertThrowsError(try r.restoreRecoveryBackup()) { XCTAssertEqual(($0 as? RepositoryError)?.code, "CORRUPT") }
        XCTAssertTrue(try snapshot() == before, "unverified backup never overwrites current DB")
    }
    func testFixedBridgeRecoveryClosesRestoresReopensAndRejectsOtherConnection() throws {
        let r = repo(); defer { r.close() }
        _ = try execute(r, "commitProject", initial())
        _ = try execute(r, "createRecoveryBackup")
        let other = repo(); _ = try execute(other, "initialize")
        XCTAssertThrowsError(try execute(r, "restoreRecoveryBackup")) { XCTAssertEqual(($0 as? RepositoryError)?.code, "BUSY") }
        other.close(); r.close()
        try Data(repeating: 0x42, count: 512).write(to: directory.appendingPathComponent("repository.sqlite"))
        XCTAssertThrowsError(try execute(r, "initialize")) { XCTAssertEqual(($0 as? RepositoryError)?.code, "CORRUPT") }
        XCTAssertThrowsError(try execute(r, "restoreRecoveryBackup", ["path": "/anywhere"])) { XCTAssertEqual(($0 as? RepositoryError)?.code, "INVALID_ARGUMENT") }
        _ = try execute(r, "restoreRecoveryBackup")
        subset(try record(r, "project_a"), ["repositoryRevision": "1", "localRevision": "1"], "bridge restored")
        _ = try execute(r, "listSummaries", ["limit": 100])
    }
    func testRecoveryBackupScheduleAndLowSpaceSkip() throws {
        let now = Date(timeIntervalSince1970: 1_000_000)
        let ample: Int64 = 100 * 1024 * 1024
        XCTAssertTrue(ProjectRepository.recoveryBackupDue(now: now, last: nil, freeBytes: ample, databaseBytes: 1024))
        XCTAssertFalse(ProjectRepository.recoveryBackupDue(now: now, last: now.addingTimeInterval(-86399), freeBytes: ample, databaseBytes: 1024))
        XCTAssertTrue(ProjectRepository.recoveryBackupDue(now: now, last: now.addingTimeInterval(-86400), freeBytes: ample, databaseBytes: 1024))
        XCTAssertFalse(ProjectRepository.recoveryBackupDue(now: now, last: nil, freeBytes: 0, databaseBytes: 1024))
        XCTAssertFalse(ProjectRepository.recoveryBackupDue(now: now, last: nil, freeBytes: Int64.max, databaseBytes: Int64.max))
        let r = repo(); defer { r.close() }
        _ = try execute(r, "commitProject", initial())
        let first = try execute(r, "createRecoveryBackup", ["ifDue": true])
        let second = try execute(r, "createRecoveryBackup", ["ifDue": true])
        subset(first, ["created": true], "first scheduled backup")
        subset(second, ["created": false], "within 24 hours")
    }
    func testRepositoryAudioGCProtectsPreviousRecoveryIncompleteAndBackup() throws {
        let documents = directory.appendingPathComponent("Documents", isDirectory: true)
        let audioRoot = directory.appendingPathComponent("audio", isDirectory: true)
        let store = AudioStore(directory: audioRoot, legacyDirectory: documents.appendingPathComponent("audio"))
        let source = directory.appendingPathComponent("source.mp3")
        try Data([UInt8(1), 2, 3, 4, 5]).write(to: source)
        for id in ["current", "previous", "recovery", "incomplete", "backup-only", "draft-only", "unused", "uncommitted"] {
            _ = try store.importFile(source, meta: StoredAudioMeta(id: id, name: "anonymous.mp3", type: "audio/mpeg", size: 5))
            if id != "uncommitted" { try store.confirmReference(id: id) }
        }
        let r = ProjectRepository(databaseURL: directory.appendingPathComponent("repository.sqlite"), documentsURL: documents)
        defer { r.close() }
        let create = try initial()
        let originalJSON = try XCTUnwrap(create["json"] as? String)
        var p = try RepositoryValidation.object(originalJSON)
        let meta: (String) -> [String: Any] = { ["id": $0, "name": "anonymous.mp3", "type": "audio/mpeg", "size": 5] }
        let draftRoot = documents.appendingPathComponent("personal-cloud-drafts", isDirectory: true)
        try FileManager.default.createDirectory(at: draftRoot, withIntermediateDirectories: true)
        let draft: [String: Any] = ["cloudProjectId": "anonymous-cloud", "savedAt": "2026-01-01T00:00:00Z", "baseUpdatedAt": NSNull(), "project": ["audio": meta("draft-only")] as [String: Any]]
        let draftJSON = try RepositoryValidation.json(draft)
        try Data(draftJSON.utf8).write(to: draftRoot.appendingPathComponent("anonymous-cloud.pending.json"))
        p["audio"] = meta("previous")
        var request = create; request["json"] = try RepositoryValidation.json(p)
        _ = try execute(r, "commitProject", request)
        p["audio"] = meta("current")
        request["json"] = try RepositoryValidation.json(p); request["localRevision"] = "2"; request["expectedRepositoryRevision"] = "1"; request["operationId"] = "audio-current"
        _ = try execute(r, "commitProject", request)
        p["audio"] = meta("recovery")
        var candidate = try migrationItem("gc-recovery", disposition: "recovery")
        candidate["json"] = try RepositoryValidation.json(p)
        candidate = try advance(r, candidate, state: "discovered", expected: NSNull())
        candidate = try advance(r, candidate, state: "validated", expected: "discovered")
        candidate = try advance(r, candidate, state: "written", expected: "validated")
        candidate = try advance(r, candidate, state: "verified", expected: "written")
        _ = try advance(r, candidate, state: "completed", expected: "verified")
        p["audio"] = meta("incomplete")
        var pending = try migrationItem("gc-incomplete")
        pending["json"] = try RepositoryValidation.json(p)
        pending = try advance(r, pending, state: "discovered", expected: NSNull())
        _ = try advance(r, pending, state: "validated", expected: "discovered")
        var batch: [String: Any] = ["kind": "batch", "id": "legacy-projects-v1", "state": "discovered", "itemIds": ["gc-recovery"],
            "sources": [["source": "anonymous", "status": "ok"] as [String: Any]], "issues": [[String: Any]]()]
        _ = try advance(r, batch, state: "discovered", expected: NSNull())
        batch["counts"] = ["migratedCount": 0, "recoveryCount": 1, "duplicateCount": 0] as [String: Any]
        _ = try advance(r, batch, state: "completed", expected: "discovered")
        _ = try execute(r, "updateMaintenance", ["action": "started"])
        p["id"] = "backup-project"; p["audio"] = meta("backup-only")
        _ = try execute(r, "commitProject", ["id": "backup-project", "json": try RepositoryValidation.json(p), "operationId": "backup-project-create", "localRevision": "1", "expectedRepositoryRevision": NSNull()] as [String: Any])
        _ = try execute(r, "createRecoveryBackup")
        _ = try execute(r, "removeProject", ["id": "backup-project", "expectedRepositoryRevision": "1", "operationId": "backup-project-remove"])
        let orphan = audioRoot.appendingPathComponent(UUID().uuidString.lowercased()).appendingPathExtension("partial")
        try Data([UInt8(1), 2, 3, 4, 5]).write(to: orphan)
        let stats = try execute(r, "collectUnusedAudio")
        subset(stats, ["count": 2, "bytes": 10, "skipped": false] as [String: Any], "only unused and partial")
        for id in ["current", "previous", "recovery", "incomplete", "backup-only", "draft-only", "uncommitted"] { XCTAssertNotNil(try store.resolve(id: id)) }
        XCTAssertNil(try store.resolve(id: "unused"))
        let second = try execute(r, "collectUnusedAudio")
        subset(second, ["skipped": true], "one GC per day")
    }
    func testErrorClassificationAndIntegrityVectors() {
        for (rc, code) in [(SQLITE_FULL,"NO_SPACE"),(SQLITE_BUSY,"BUSY"),(SQLITE_LOCKED,"BUSY"),(SQLITE_CORRUPT,"CORRUPT"),
                           (SQLITE_NOTADB,"CORRUPT"),(SQLITE_CANTOPEN,"ACCESS_DENIED"),(SQLITE_PERM,"ACCESS_DENIED"),(SQLITE_IOERR,"IO_ERROR")] {
            XCTAssertEqual(RepositoryError.sqlite(rc).code, code)
        }
        XCTAssertEqual(RepositoryError.sqlite(SQLITE_IOERR, systemErrno: 28).code, "NO_SPACE")
        XCTAssertEqual(RepositoryError.sqlite(SQLITE_CANTOPEN, protectedDataAvailable: false).code, "DEVICE_LOCKED")
        XCTAssertEqual(Integrity.crc32("123456789"), "cbf43926")
        XCTAssertEqual("隊列😀".utf8.count, 10)
        XCTAssertEqual(Integrity.crc32("隊列😀"), "51699122")
        XCTAssertEqual(Integrity.sha256(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        XCTAssertEqual(Integrity.sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        XCTAssertEqual(RepositoryValidation.increment("999999999999999999999999"), "1000000000000000000000000")
        XCTAssertFalse(RepositoryValidation.hasUnpairedSurrogateEscape(#"{"id":"\ud83d\ude00"}"#))
        XCTAssertFalse(RepositoryValidation.hasUnpairedSurrogateEscape(#"{"id":"\\ud800"}"#))
        XCTAssertEqual(RepositoryValidation.time("2026-01-01"), 1767225600000)
        XCTAssertEqual(RepositoryValidation.time("2026-01-01T00:00:00.0009Z"), 1767225600000)
        XCTAssertNil(RepositoryValidation.time("invalid"))
    }
    func testProjectTimingLogs() throws {
        let count = ProcessInfo.processInfo.environment["REPOSITORY_PERF"] == "1" ? 1000 : 200
        let r = repo(); defer { r.close() }
        let base = try initial()
        var p = try RepositoryValidation.object(base["json"] as! String)
        p["anonymousPerformancePadding"] = String(repeating: "x", count: 230 * 1024)
        let seedStart = Date()
        for i in 0..<count {
            p["id"] = "perf-\(i)"
            _ = try execute(r, "commitProject", ["id":p["id"]!,"json":try RepositoryValidation.json(p),"operationId":"perf-create-\(i)","localRevision":"1","expectedRepositoryRevision":NSNull()])
        }
        let seedSeconds = Date().timeIntervalSince(seedStart)
        r.close()
        let reopenStart = Date(); _ = try execute(r, "initialize"); let reopenMS = Date().timeIntervalSince(reopenStart) * 1000
        let middle = "perf-\(count / 2)"
        let listStart = Date(); _ = try execute(r, "listSummaries", ["limit":100]); let listMS = Date().timeIntervalSince(listStart) * 1000
        let readStart = Date(); _ = try execute(r, "readProject", ["id":middle]); let readMS = Date().timeIntervalSince(readStart) * 1000
        p["id"] = middle
        let commitStart = Date()
        _ = try execute(r, "commitProject", ["id":p["id"]!,"json":try RepositoryValidation.json(p),"operationId":"perf-update","localRevision":"2","expectedRepositoryRevision":"1"])
        print(String(format: "Repository timing (%d x ~230KiB; log only; quick_check retained): seed=%.2fs reopen=%.2fms list100=%.2fms get=%.2fms commit=%.2fms", count, seedSeconds, reopenMS, listMS, readMS, Date().timeIntervalSince(commitStart)*1000))
    }

    func testEmptyDatabaseAfterInterruptedCreationIsNew() throws {
        let path = directory.appendingPathComponent("repository.sqlite")
        let short = Data(repeating: 0x41, count: 64)
        try short.write(to: path)
        let invalid = repo(); defer { invalid.close() }
        XCTAssertThrowsError(try execute(invalid, "initialize")) { XCTAssertEqual(($0 as? RepositoryError)?.code, "CORRUPT") }
        XCTAssertEqual(try Data(contentsOf: path), short)
        try Data().write(to: path)
        let empty = repo(); _ = try execute(empty, "initialize"); empty.close()
        try FileManager.default.removeItem(at: path)
        try raw { h in
            // Header-only, user_version=0, no application tables.
            XCTAssertEqual(sqlite3_exec(h, "PRAGMA journal_mode=DELETE; VACUUM", nil, nil, nil), SQLITE_OK)
        }
        let header = repo(); _ = try execute(header, "initialize"); header.close()
        try FileManager.default.removeItem(at: path)
        try raw { h in XCTAssertEqual(sqlite3_exec(h, "CREATE TABLE unknown_user_data(value TEXT)", nil, nil, nil), SQLITE_OK) }
        let before = try Data(contentsOf: path)
        let foreign = repo(); defer { foreign.close() }
        XCTAssertThrowsError(try execute(foreign, "initialize")) { XCTAssertEqual(($0 as? RepositoryError)?.code, "CORRUPT") }
        XCTAssertEqual(try Data(contentsOf: path), before, "version 0 with user data must not be recreated")
    }

    private func migrationItem(_ name: String = "migration-native-one", disposition: String = "import") throws -> [String: Any] {
        let create = try initial()
        let json = try XCTUnwrap(create["json"] as? String)
        return ["kind":"item","id":name,"state":"discovered","sourceHash":Integrity.sha256(json),
                "sources":["anonymous-fixture"],"targetId":"project_a","json":json,
                "disposition":disposition,"reason":"anonymous migration contract"] as [String: Any]
    }
    private func advance(_ r: ProjectRepository, _ entry: [String: Any], state: String, expected: Any) throws -> [String: Any] {
        var next = entry; next["state"] = state
        if state == "written" && next["outcome"] == nil { next["outcome"] = "imported" }
        // Call outside XCTUnwrap: XCTUnwrap records a thrown error as a failure even when
        // the caller expects it inside XCTAssertThrowsError.
        let response = try execute(r, "writeMigration", ["entry":next,"expectedState":expected] as [String: Any])
        return try XCTUnwrap(response as? [String: Any])
    }
    func testMigrationStateContractAndResponseLossDoesNotOverwriteEdits() throws {
        let r = repo(); defer { r.close() }
        var item = try advance(r, migrationItem(), state: "discovered", expected: NSNull())
        XCTAssertThrowsError(try advance(r, item, state: "written", expected: "discovered")) { XCTAssertEqual(($0 as? RepositoryError)?.code, "CONFLICT") }
        item = try advance(r, item, state: "validated", expected: "discovered")
        let submitted = item
        item = try advance(r, item, state: "written", expected: "validated")
        subset(item, ["state":"written","outcome":"imported"], "atomic import")
        r.close()
        _ = try execute(r, "renameProject", ["id":"project_a","title":"anonymous later edit","updatedAt":"2026-02-01T00:00:00Z",
                       "localRevision":"2","expectedRepositoryRevision":"1","operationId":"migration-later-edit"] as [String: Any])
        let replay = try advance(r, submitted, state: "written", expected: "validated")
        XCTAssertEqual(try RepositoryValidation.json(replay), try RepositoryValidation.json(item), "written ledger is response-loss receipt")
        subset(try record(r, "project_a"), ["repositoryRevision":"2","project":["title":"anonymous later edit"] as [String: Any]] as [String: Any], "new edit retained")
        item = try advance(r, item, state: "verified", expected: "written")
        item = try advance(r, item, state: "completed", expected: "verified")
        var batch: [String: Any] = ["kind":"batch","id":"legacy-projects-v1","state":"discovered","itemIds":["migration-native-one"],
                                  "sources":[["source":"anonymous-fixture","status":"ok"] as [String: Any]],"issues":[[String: Any]]()]
        _ = try advance(r, batch, state: "discovered", expected: NSNull())
        batch["counts"] = ["migratedCount":1,"recoveryCount":0,"duplicateCount":0] as [String: Any]
        _ = try advance(r, batch, state: "completed", expected: "discovered")
        _ = try execute(r, "createRecoveryBackup") // Backup validates ledger envelopes too.
        var changed = item; changed["json"] = "{}"
        XCTAssertThrowsError(try advance(r, changed, state: "completed", expected: "verified")) { XCTAssertEqual(($0 as? RepositoryError)?.code, "CONFLICT") }
        print("Migration contract: discovered -> validated -> written -> verified -> completed; atomic receipt / reopen / later edit / batch / backup: PASS")
    }
    func testMigrationAtomicRollbackAndResume() throws {
        let r = repo(); defer { r.close() }
        var item = try advance(r, migrationItem(), state: "discovered", expected: NSNull())
        item = try advance(r, item, state: "validated", expected: "discovered")
        for phase in ["afterBody", "afterSummary", "migrationAfterBody", "migrationAfterLedger", "beforeCommit"] {
            let before = try snapshot()
            r.fault = { if $0 == phase { throw RepositoryError("NO_SPACE") } }
            XCTAssertThrowsError(try advance(r, item, state: "written", expected: "validated")) { XCTAssertEqual(($0 as? RepositoryError)?.code, "NO_SPACE") }
            r.fault = nil
            XCTAssertEqual(try snapshot(), before, "all six tables unchanged: \(phase)")
            r.close()
            let ledger = try execute(r, "readMigration", ["id":"migration-native-one"])
            subset(ledger, ["state":"validated"], "restart phase")
        }
        _ = try advance(r, item, state: "written", expected: "validated")
        subset(try record(r, "project_a"), ["repositoryRevision":"1"], "resumed creation exactly once")
    }
    func testMigrationRecoveryDuplicateDraftAndDeletedTarget() throws {
        let r = repo(); defer { r.close() }
        var imported = try advance(r, migrationItem(), state: "discovered", expected: NSNull())
        imported = try advance(r, imported, state: "validated", expected: "discovered")
        _ = try advance(r, imported, state: "written", expected: "validated")
        var duplicate = try advance(r, migrationItem("migration-duplicate"), state: "discovered", expected: NSNull())
        duplicate = try advance(r, duplicate, state: "validated", expected: "discovered")
        duplicate = try advance(r, duplicate, state: "written", expected: "validated")
        subset(duplicate, ["outcome":"duplicate"], "same id/body")
        var candidate = try migrationItem("migration-recovery", disposition: "recovery")
        candidate["json"] = "{\"anonymousInvalid\":true}"
        candidate["draft"] = ["cloudProjectId":"anonymous-cloud","baseUpdatedAt":NSNull(),"savedAt":"2026-02-01T00:00:00Z","status":"pending"] as [String: Any]
        candidate = try advance(r, candidate, state: "discovered", expected: NSNull())
        candidate = try advance(r, candidate, state: "validated", expected: "discovered")
        candidate = try advance(r, candidate, state: "written", expected: "validated")
        subset(candidate, ["outcome":"recovery","draft":["status":"pending","baseUpdatedAt":NSNull()] as [String: Any]] as [String: Any], "recovery retains JSON and draft provenance")
        _ = try execute(r, "removeProject", ["id":"project_a","expectedRepositoryRevision":"1","operationId":"migration-delete"])
        var another = try advance(r, migrationItem("migration-new-evidence"), state: "discovered", expected: NSNull())
        another = try advance(r, another, state: "validated", expected: "discovered")
        another = try advance(r, another, state: "written", expected: "validated")
        subset(another, ["outcome":"recovery"], "retained target receipt prevents revival")
        XCTAssertTrue(try execute(r, "readProject", ["id":"project_a"]) is NSNull)
        try raw { h in XCTAssertEqual(sqlite3_exec(h, "UPDATE migration_items SET state_json='{}' WHERE source_key='migration-recovery'", nil, nil, nil), SQLITE_OK) }
        XCTAssertThrowsError(try execute(r, "readMigration", ["id":"migration-recovery"])) { XCTAssertEqual(($0 as? RepositoryError)?.code, "CORRUPT") }
    }
}
