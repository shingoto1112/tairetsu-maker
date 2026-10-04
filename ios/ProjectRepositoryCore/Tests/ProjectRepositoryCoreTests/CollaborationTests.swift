import Foundation
import SQLite3
import XCTest
@testable import ProjectRepositoryCore

final class CollaborationTests: XCTestCase {
    private var directory: URL!
    private var databaseURL: URL { directory.appendingPathComponent("repository.sqlite") }
    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("collaboration-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try FileManager.default.removeItem(at: directory) }
    private func repo() -> ProjectRepository { ProjectRepository(databaseURL: databaseURL, documentsURL: directory) }
    private func fixture(_ name: String = "collaboration") throws -> [String: Any] {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let data = try Data(contentsOf: root.appendingPathComponent("src/repositories/contract/fixtures/\(name).json"))
        let decoded = try JSONSerialization.jsonObject(with: data)
        return try XCTUnwrap(decoded as? [String: Any])
    }
    private func call(_ r: ProjectRepository, _ method: String, _ input: [String: Any] = [String: Any]()) throws -> Any {
        let json = try RepositoryValidation.json(input)
        let response = try r.execute(method, requestJSON: json)
        return try JSONSerialization.jsonObject(with: Data(response.utf8), options: [.fragmentsAllowed])
    }
    private func read(_ r: ProjectRepository, _ method: String = "readProject") throws -> [String: Any] {
        let response = try call(r, method, ["id": "project_a"] as [String: Any])
        return try XCTUnwrap(response as? [String: Any])
    }
    private func attachment(_ record: [String: Any]) throws -> [String: Any] {
        let json = try XCTUnwrap(record["collaborationJSON"] as? String)
        return try RepositoryValidation.object(json)
    }
    private func request(_ f: [String: Any], _ key: String, _ revision: Int, project: [String: Any]? = nil) throws -> [String: Any] {
        let projects = try fixture("commitProjects")
        let p: [String: Any]? = project ?? ((key == "initial" ? projects["stage"] : f["projectAfterEdits"]) as? [String: Any])
        let value = try XCTUnwrap(p)
        let expected: Any
        if revision == 1 { expected = NSNull() } else { expected = String(revision - 1) }
        return ["id": "project_a", "json": try RepositoryValidation.json(value),
                "collaborationJSON": try RepositoryValidation.json(f[key]!), "operationId": "shared-\(revision)",
                "localRevision": String(revision), "expectedRepositoryRevision": expected] as [String: Any]
    }
    private func error(_ code: String, _ work: () throws -> Any, file: StaticString = #filePath, line: UInt = #line) {
        do { _ = try work(); XCTFail("Expected \(code)", file: file, line: line) }
        catch { XCTAssertEqual((error as? RepositoryError)?.code, code, file: file, line: line) }
    }
    private func raw(_ work: (OpaquePointer) throws -> Void) throws {
        var handle: OpaquePointer?
        XCTAssertEqual(sqlite3_open(databaseURL.path, &handle), SQLITE_OK)
        let db = try XCTUnwrap(handle); defer { sqlite3_close(db) }
        try work(db)
    }
    private func sql(_ text: String) throws {
        try raw { db in XCTAssertEqual(sqlite3_exec(db, text, nil, nil, nil), SQLITE_OK) }
    }
    private func values(_ text: String) throws -> [String] {
        var result: [String] = []
        try raw { db in
            var handle: OpaquePointer?
            XCTAssertEqual(sqlite3_prepare_v2(db, text, -1, &handle, nil), SQLITE_OK)
            let statement = try XCTUnwrap(handle); defer { sqlite3_finalize(statement) }
            while true {
                let rc = sqlite3_step(statement)
                if rc == SQLITE_DONE { break }
                guard rc == SQLITE_ROW else { XCTFail("SQL scan failed"); break }
                for i in 0..<sqlite3_column_count(statement) {
                    if let bytes = sqlite3_column_text(statement, i) {
                        result.append(String(cString: bytes))
                    } else { result.append("<null>") }
                }
            }
        }
        return result
    }
    private func snapshot(legacy: Bool = false) throws -> [String] {
        var result: [String] = []
        for table in ["project_bodies", "project_previous", "project_summaries", "operation_receipts", "personal_sync", "migration_items"] {
            let columns = legacy && ["project_bodies", "project_previous"].contains(table)
                ? "id,json,byte_length,crc32,repository_revision,local_revision,schema_version,sync_json" : "*"
            result += try values("SELECT \(columns) FROM \(table) ORDER BY 1")
        }
        return result
    }
    private func schemaOne() throws -> [String] {
        let r = repo()
        let projects = try fixture("commitProjects")
        let json = try RepositoryValidation.json(projects["stage"]!)
        _ = try call(r, "commitProject", ["id": "project_a", "json": json, "operationId": "old-create", "localRevision": "1", "expectedRepositoryRevision": NSNull()] as [String: Any])
        _ = try call(r, "touchOpened", ["id": "project_a", "openedAt": "2026-01-02T00:00:00.000Z"] as [String: Any])
        let batch: [String: Any] = ["id": "legacy-projects-v1", "kind": "batch", "state": "discovered", "itemIds": [String](), "sources": [[String: Any]](), "issues": [[String: Any]]()]
        _ = try call(r, "writeMigration", ["entry": batch, "expectedState": NSNull()] as [String: Any])
        r.close()
        for table in ["project_bodies", "project_previous"] {
            for column in ["collaboration_json", "collaboration_byte_length", "collaboration_crc32"] {
                try sql("ALTER TABLE \(table) DROP COLUMN \(column)")
            }
        }
        try sql("PRAGMA user_version=1")
        return try snapshot()
    }

    func testFixtureContractCommitCompactionACKAndReopen() throws {
        let f = try fixture()
        XCTAssertEqual(f["requiresNativeSchema"] as? Int, 2)
        var r = repo(); defer { r.close() }
        for (offset, key) in ["initial", "committed", "compacted", "acknowledged"].enumerated() {
            let req = try request(f, key, offset + 1)
            let receipt = try call(r, "commitProject", req)
            let replay = try call(r, "commitProject", req)
            XCTAssertEqual(try RepositoryValidation.json(receipt), try RepositoryValidation.json(replay))
            var reordered = req
            let fixtureData = try XCTUnwrap(f[key] as? [String: Any])
            let members = try fixtureData.keys.sorted().reversed().map { name in
                try RepositoryValidation.json(name) + ":" + RepositoryValidation.json(fixtureData[name]!)
            }
            reordered["collaborationJSON"] = "{" + members.joined(separator: ",") + "}"
            let normalizedReplay = try call(r, "readCommitReceipt", reordered)
            XCTAssertEqual(try RepositoryValidation.json(receipt), try RepositoryValidation.json(normalizedReplay))
            r.close(); r = repo()
            let record = try read(r)
            let data = try attachment(record)
            XCTAssertEqual(try RepositoryValidation.json(data), try RepositoryValidation.json(f[key]!))
            XCTAssertEqual(record["repositoryRevision"] as? String, String(offset + 1))
            if offset > 0 {
                let previous = try read(r, "readPrevious")
                let oldData = try attachment(previous)
                XCTAssertEqual(try RepositoryValidation.json(oldData), try RepositoryValidation.json(f[["initial", "committed", "compacted"][offset - 1]]!))
            }
        }
        let saved = try read(r), data = try attachment(saved)
        XCTAssertEqual((data["outbox"] as? [[String: Any]])?.count, 2)
        XCTAssertEqual(data["serverCursor"] as? String, "7")
        _ = try call(r, "renameProject", ["id": "project_a", "title": "metadata only", "updatedAt": "2026-02-01T00:00:00.000Z", "operationId": "shared-rename", "expectedRepositoryRevision": "4", "localRevision": "5"] as [String: Any])
        _ = try call(r, "touchOpened", ["id": "project_a", "openedAt": "2026-02-02T00:00:00.000Z"] as [String: Any])
        let touched = try read(r), held = try attachment(touched)
        XCTAssertEqual(try RepositoryValidation.json(held), try RepositoryValidation.json(data))
        XCTAssertEqual(touched["repositoryRevision"] as? String, "6")
        _ = try call(r, "createRecoveryBackup") // validates current/previous/summary/receipts together
    }

    func testAtomicFailureAllStagesAndFixedRequestRetry() throws {
        let f = try fixture(), r = repo(); defer { r.close() }
        _ = try call(r, "commitProject", request(f, "initial", 1))
        let req = try request(f, "committed", 2)
        for phase in ["afterPrevious", "afterBody", "afterCollaboration", "afterSummary", "afterReceipt", "beforeCommit"] {
            let before = try snapshot()
            r.fault = { if $0 == phase { throw RepositoryError("NO_SPACE") } }
            error("NO_SPACE") { try self.call(r, "commitProject", req) }
            r.fault = nil
            XCTAssertEqual(try snapshot(), before, phase)
        }
        _ = try call(r, "commitProject", req)
        _ = try call(r, "createRecoveryBackup")
    }

    func testCASLoserReadsBaseJournalOutboxCursorAndSentForMerge() throws {
        let f = try fixture(), a = repo(), b = repo(); defer { a.close(); b.close() }
        _ = try call(a, "commitProject", request(f, "initial", 1))
        _ = try read(b)
        _ = try call(a, "commitProject", request(f, "committed", 2))
        var loser = try request(f, "committed", 2); loser["operationId"] = "cas-loser"
        error("CONFLICT") { try self.call(b, "commitProject", loser) }
        _ = try call(a, "commitProject", request(f, "acknowledged", 3))
        let saved = try read(b), data = try attachment(saved)
        XCTAssertEqual(try RepositoryValidation.json(data), try RepositoryValidation.json(f["acknowledged"]!))
        XCTAssertEqual(saved["repositoryRevision"] as? String, "3")
        var merged = try request(f, "acknowledged", 4)
        merged["operationId"] = "cas-merged"
        _ = try call(b, "commitProject", merged)
    }

    func testTransitionRejectsDetachCursorGenerationIDBytesACKAndOutboxLoss() throws {
        let f = try fixture(), r = repo(); defer { r.close() }
        _ = try call(r, "commitProject", request(f, "acknowledged", 1))
        let original = try XCTUnwrap(f["acknowledged"] as? [String: Any])
        var variants: [[String: Any]] = []
        for (name, value) in [("serverCursor", "6"), ("generation", "2"), ("sharedDocumentId", "different")] {
            var v = original; v[name] = value; variants.append(v)
        }
        var dropped = original; dropped["outbox"] = [[String: Any]](); variants.append(dropped)
        var ack = original, outbox = try XCTUnwrap(original["outbox"] as? [[String: Any]])
        outbox[0]["status"] = "pending"; ack["outbox"] = outbox; variants.append(ack)
        outbox[0]["bytes"] = "AQ=="; ack["outbox"] = outbox; variants.append(ack)
        let before = try snapshot()
        for variant in variants {
            var req = try request(f, "acknowledged", 2); req["collaborationJSON"] = try RepositoryValidation.json(variant)
            error("CONFLICT") { try self.call(r, "commitProject", req) }
        }
        var req = try request(f, "acknowledged", 2); req["collaborationJSON"] = NSNull()
        error("CONFLICT") { try self.call(r, "commitProject", req) }
        XCTAssertEqual(try snapshot(), before)
    }

    func testBindingAtomicFirstBindImmutableAndOldFieldOmission() throws {
        let f = try fixture(), r = repo(); defer { r.close() }
        let binding: [String: Any] = ["accountId": "11111111-1111-1111-1111-111111111111", "membershipGeneration": "22222222-2222-2222-2222-222222222222"]
        var data = try XCTUnwrap(f["initial"] as? [String: Any]); data["sharedDocumentId"] = NSNull()
        var req = try request(f, "initial", 1); req["collaborationJSON"] = try RepositoryValidation.json(data)
        _ = try call(r, "commitProject", req)
        data["sharedDocumentId"] = "shared-fixture"; data["transportBinding"] = binding
        req = try request(f, "initial", 2); req["collaborationJSON"] = try RepositoryValidation.json(data)
        _ = try call(r, "commitProject", req)
        let replacements: [Any] = [NSNull(), ["accountId": binding["accountId"]!, "membershipGeneration": "33333333-3333-3333-3333-333333333333"] as [String: Any]]
        for replacement in replacements {
            var changed = data
            if replacement is NSNull { changed.removeValue(forKey: "transportBinding") } else { changed["transportBinding"] = replacement }
            req = try request(f, "initial", 3); req["collaborationJSON"] = try RepositoryValidation.json(changed)
            error("CONFLICT") { try self.call(r, "commitProject", req) }
        }
        // A legacy shared attachment without binding cannot acquire new credentials.
        r.close(); try sql("DELETE FROM project_bodies; DELETE FROM operation_receipts")
        let old = repo(); defer { old.close() }
        _ = try call(old, "commitProject", request(f, "initial", 1))
        req = try request(f, "initial", 2); req["collaborationJSON"] = try RepositoryValidation.json(data)
        error("CONFLICT") { try self.call(old, "commitProject", req) }
    }

    func testNativeLimitsCanonicalBase64SchemaAndShape() throws {
        let f = try fixture(), original = try XCTUnwrap(f["initial"] as? [String: Any])
        var invalid = original; invalid["base"] = "AB=="
        error("INVALID_ARGUMENT") { try CollaborationValidation.parse(RepositoryValidation.json(invalid)) }
        invalid = original; invalid["documentSchema"] = 2
        error("UNSUPPORTED_SCHEMA") { try CollaborationValidation.parse(RepositoryValidation.json(invalid)) }
        invalid = original; invalid["transportBinding"] = ["accountId": "bad", "membershipGeneration": "bad"] as [String: Any]
        error("INVALID_ARGUMENT") { try CollaborationValidation.parse(RepositoryValidation.json(invalid)) }
        invalid = original; invalid["unexpected"] = true
        error("INVALID_ARGUMENT") { try CollaborationValidation.parse(RepositoryValidation.json(invalid)) }
        for (key, count, code) in [("base", CollaborationValidation.baseBytes, "QUOTA_EXCEEDED"), ("journal", CollaborationValidation.updateBytes, "QUOTA_EXCEEDED")] {
            invalid = original
            let bytes = Data(repeating: 1, count: count + 1).base64EncodedString()
            if key == "base" { invalid[key] = bytes }
            else { invalid[key] = [["updateId": "big", "bytes": bytes, "source": "remote"] as [String: Any]] }
            error(code) { try CollaborationValidation.parse(RepositoryValidation.json(invalid)) }
        }
        invalid = original
        invalid["journal"] = (0...CollaborationValidation.entries).map { ["updateId": "entry-\($0)", "bytes": "AQ==", "source": "remote"] as [String: Any] }
        error("QUOTA_EXCEEDED") { try CollaborationValidation.parse(RepositoryValidation.json(invalid)) }
        invalid = original; invalid["base"] = Data(repeating: 1, count: CollaborationValidation.baseBytes).base64EncodedString()
        invalid["journal"] = (0..<33).map { ["updateId": "total-\($0)", "bytes": Data(repeating: 1, count: CollaborationValidation.updateBytes).base64EncodedString(), "source": "remote"] as [String: Any] }
        error("QUOTA_EXCEEDED") { try CollaborationValidation.parse(RepositoryValidation.json(invalid)) }
        let oversized = String(repeating: " ", count: CollaborationValidation.jsonBytes + 1)
        error("QUOTA_EXCEEDED") { try CollaborationValidation.parse(oversized) }
        // Exact per-blob boundaries are accepted without interpreting Yjs.
        invalid = original; invalid["base"] = Data(repeating: 1, count: CollaborationValidation.baseBytes).base64EncodedString()
        _ = try CollaborationValidation.parse(RepositoryValidation.json(invalid))
        invalid["journal"] = (0..<32).map { ["updateId": "boundary-\($0)", "bytes": Data(repeating: 1, count: CollaborationValidation.updateBytes).base64EncodedString(), "source": "remote"] as [String: Any] }
        _ = try CollaborationValidation.parse(RepositoryValidation.json(invalid)) // exactly 16 MiB
        invalid = original
        invalid["outbox"] = (0...CollaborationValidation.entries).map { ["updateId": "outbox-\($0)", "bytes": "AQ==", "status": "pending"] as [String: Any] }
        error("QUOTA_EXCEEDED") { try CollaborationValidation.parse(RepositoryValidation.json(invalid)) }
        let r = repo(); defer { r.close() }
        var req = try request(f, "initial", 1)
        req["json"] = oversized
        error("QUOTA_EXCEEDED") { try self.call(r, "commitProject", req) }
    }

    func testSchemaOneMigrationRollbackAtEveryDDLAndVersionThenReexecution() throws {
        let baseline = try schemaOne()
        let audio = directory.appendingPathComponent("protected-audio.data")
        try Data([1, 2, 3]).write(to: audio)
        for phase in ["migrationAfter-project_bodies", "migrationAfter-project_previous", "migrationAfterVersion", "beforeCommit"] {
            let r = repo()
            r.fault = { if $0 == phase { throw RepositoryError("NO_SPACE") } }
            error("NO_SPACE") { try self.call(r, "initialize") }
            r.close()
            XCTAssertEqual(try values("PRAGMA user_version"), ["1"])
            XCTAssertEqual(try snapshot(), baseline)
            XCTAssertFalse(try values("PRAGMA table_info(project_bodies)").contains("collaboration_json"))
        }
        let r = repo(); defer { r.close() }
        let result = try call(r, "initialize")
        XCTAssertEqual((result as? [String: Any])?["schemaVersion"] as? Int, 2)
        XCTAssertEqual(try values("PRAGMA user_version"), ["2"])
        XCTAssertEqual(try snapshot(legacy: true), baseline, "old payloads, summaries, previous, receipts and ledger remain identical")
        let saved = try read(r)
        XCTAssertTrue(saved["collaborationJSON"] is NSNull)
        XCTAssertEqual(try Data(contentsOf: audio), Data([1, 2, 3]))
        _ = try call(r, "createRecoveryBackup")
        let projects = try fixture("commitProjects")
        let oldRequest: [String: Any] = ["id": "project_a", "json": try RepositoryValidation.json(projects["stage"]!), "operationId": "old-create", "localRevision": "1", "expectedRepositoryRevision": NSNull()]
        let oldReceipt = try call(r, "readCommitReceipt", oldRequest)
        XCTAssertEqual((oldReceipt as? [String: Any])?["repositoryRevision"] as? String, "1")
        r.close()
        let reopened = repo(); defer { reopened.close() }
        _ = try call(reopened, "initialize")
        XCTAssertEqual(try read(reopened)["repositoryRevision"] as? String, "2")
    }

    func testSchemaOneRecoveryBackupUpgradeAndRestore() throws {
        _ = try schemaOne()
        let backup = directory.appendingPathComponent("recovery/repository.backup.sqlite")
        try FileManager.default.createDirectory(at: backup.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: databaseURL, to: backup)
        let r = repo(); defer { r.close() }
        _ = try call(r, "initialize")
        _ = try call(r, "restoreRecoveryBackup")
        let record = try read(r)
        XCTAssertTrue(record["collaborationJSON"] is NSNull)
        XCTAssertEqual(try values("PRAGMA user_version"), ["2"])
    }

    func testBackupRestorePreservesBindingPendingPreviousAndReceipts() throws {
        var f = try fixture()
        let binding: [String: Any] = ["accountId": "11111111-1111-1111-1111-111111111111", "membershipGeneration": "22222222-2222-2222-2222-222222222222"]
        for key in ["initial", "committed", "acknowledged"] {
            var data = try XCTUnwrap(f[key] as? [String: Any]); data["transportBinding"] = binding; f[key] = data
        }
        let r = repo(); defer { r.close() }
        _ = try call(r, "commitProject", request(f, "initial", 1))
        let committed = try request(f, "committed", 2)
        let receipt = try call(r, "commitProject", committed)
        _ = try call(r, "createRecoveryBackup")
        let before = try snapshot()
        _ = try call(r, "commitProject", request(f, "acknowledged", 3))
        _ = try call(r, "restoreRecoveryBackup")
        XCTAssertEqual(try snapshot(), before)
        let record = try read(r), data = try attachment(record)
        XCTAssertEqual(try RepositoryValidation.json(data), try RepositoryValidation.json(f["committed"]!))
        let replay = try call(r, "commitProject", committed)
        XCTAssertEqual(try RepositoryValidation.json(receipt), try RepositoryValidation.json(replay))
        // Binding is identity history, never a persisted authentication grant.
        // TS provider must re-check account and membership before each append.
    }

    func testCorruptAttachmentReadPreviousAndBackupFailClosed() throws {
        let f = try fixture(), r = repo(); defer { r.close() }
        _ = try call(r, "commitProject", request(f, "initial", 1))
        _ = try call(r, "commitProject", request(f, "committed", 2))
        try sql("UPDATE project_previous SET collaboration_crc32='bad'")
        error("CORRUPT") { try self.call(r, "readPrevious", ["id": "project_a"] as [String: Any]) }
        error("CORRUPT") { try self.call(r, "createRecoveryBackup") }
        try sql("UPDATE project_bodies SET collaboration_byte_length=0")
        error("CORRUPT") { try self.call(r, "readProject", ["id": "project_a"] as [String: Any]) }
        let replay = try call(r, "readCommitReceipt", request(f, "committed", 2))
        XCTAssertEqual((replay as? [String: Any])?["repositoryRevision"] as? String, "2")
        var future = try XCTUnwrap(f["committed"] as? [String: Any]); future["documentSchema"] = 2
        let json = try RepositoryValidation.json(future)
        let escaped = json.replacingOccurrences(of: "'", with: "''")
        try sql("UPDATE project_bodies SET collaboration_json='\(escaped)',collaboration_byte_length=\(json.utf8.count),collaboration_crc32='\(Integrity.crc32(json))'")
        error("UNSUPPORTED_SCHEMA") { try self.call(r, "readProject", ["id": "project_a"] as [String: Any]) }
    }

    func testGCAndLegacyCleanupHoldForCurrentPreviousAndBackup() throws {
        let f = try fixture(), r = repo(); defer { r.close() }
        let batch: [String: Any] = ["id": "legacy-projects-v1", "kind": "batch", "state": "discovered", "itemIds": [String](), "sources": [[String: Any]](), "issues": [[String: Any]]()]
        _ = try call(r, "writeMigration", ["entry": batch, "expectedState": NSNull()] as [String: Any])
        var completed = batch; completed["state"] = "completed"
        _ = try call(r, "writeMigration", ["entry": completed, "expectedState": "discovered"] as [String: Any])
        _ = try call(r, "updateMaintenance", ["action": "started"] as [String: Any])
        _ = try call(r, "commitProject", request(f, "initial", 1))
        _ = try call(r, "createRecoveryBackup")
        for stage in 0..<3 {
            if stage == 1 { try sql("INSERT OR REPLACE INTO project_previous SELECT * FROM project_bodies; UPDATE project_bodies SET collaboration_json=NULL,collaboration_byte_length=NULL,collaboration_crc32=NULL") }
            if stage == 2 { try sql("DELETE FROM project_previous") }
            let gc = try call(r, "collectUnusedAudio")
            XCTAssertEqual((gc as? [String: Any])?["skipped"] as? Bool, true)
            let reasons = try call(r, "legacyCleanupStatus")
            XCTAssertTrue((reasons as? [String])?.contains(where: { $0.contains("共同編集") }) == true)
            error("CONFLICT") { try self.call(r, "cleanupLegacyData") }
        }
    }
}
