import Foundation
import SQLite3

/// One connection per instance, always accessed on its own serial queue.
/// The bridge exposes only execute's fixed operations, never paths or SQL.
public final class ProjectRepository {
    private let queue = DispatchQueue(label: "jp.tairetsu.repository", qos: .userInitiated)
    private let url: URL
    private let protectedDataAvailable: () -> Bool
    private let documentsURL: URL?
    private var db: OpaquePointer?
    private var poisoned = false
    private static let lifecycle = NSLock()
    private static var openCounts: [String: Int] = [:]
    private static let applicationID = "1414354482" // TMV2
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    // Internal-only test hook; never part of the bridge API.
    var fault: ((String) throws -> Void)?

    public static func defaultDatabaseURL() throws -> URL {
        guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            throw RepositoryError("ACCESS_DENIED")
        }
        return base.appendingPathComponent("TairetsuMaker/v2", isDirectory: true).appendingPathComponent("repository.sqlite")
    }

    public init(databaseURL: URL, protectedDataAvailable: @escaping () -> Bool = { true }, documentsURL: URL? = nil) {
        url = databaseURL.standardizedFileURL
        self.protectedDataAvailable = protectedDataAvailable
        self.documentsURL = documentsURL
    }
    deinit { if let handle = db { sqlite3_close_v2(handle); unregister() } }

    public func close() { queue.sync { closeConnection() } }
    private func unregister() {
        Self.lifecycle.lock(); defer { Self.lifecycle.unlock() }
        Self.openCounts[url.path, default: 1] -= 1
    }
    private func closeConnection() {
        if let handle = db { sqlite3_close_v2(handle); db = nil; unregister() }
    }
    private func classified(_ error: Error) -> RepositoryError {
        RepositoryError.classify(error, protectedDataAvailable: protectedDataAvailable())
    }
    private func check(_ rc: Int32, handle: OpaquePointer? = nil) throws {
        if rc != SQLITE_OK {
            let systemErrno = (handle ?? db).map { sqlite3_system_errno($0) } ?? 0
            throw RepositoryError.sqlite(rc, systemErrno: systemErrno, protectedDataAvailable: protectedDataAvailable())
        }
    }
    private func protect(_ path: URL) throws {
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: path.path)
        #endif
        // Deliberately do not set isExcludedFromBackup.
    }
    private func directory(_ path: URL) throws {
        try FileManager.default.createDirectory(at: path, withIntermediateDirectories: true, attributes: nil)
        try protect(path)
    }

    private func connection() throws {
        if db != nil { return }
        Self.lifecycle.lock(); defer { Self.lifecycle.unlock() }
        let fm = FileManager.default
        var existed = false
        do {
            let attrs = try fm.attributesOfItem(atPath: url.path)
            existed = true
            guard attrs[.type] as? FileAttributeType == .typeRegular,
                  let size = attrs[.size] as? NSNumber,
                  size.int64Value == 0 || size.int64Value >= 100 else { throw RepositoryError("CORRUPT") }
        } catch let error as RepositoryError {
            throw error // Preserve validation codes before NSError bridging.
        } catch let error as NSError {
            if !(error.domain == NSCocoaErrorDomain && [NSFileReadNoSuchFileError, NSFileNoSuchFileError].contains(error.code)) { throw classified(error) }
        }
        try directory(url.deletingLastPathComponent())
        var handle: OpaquePointer?
        let rc = sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil)
        guard rc == SQLITE_OK, let opened = handle else {
            let error = RepositoryError.sqlite(rc, systemErrno: handle.map { sqlite3_system_errno($0) } ?? 0, protectedDataAvailable: protectedDataAvailable())
            if let h = handle { sqlite3_close_v2(h) }
            throw error
        }
        db = opened
        poisoned = false
        do {
            try check(sqlite3_extended_result_codes(opened, 1))
            try check(sqlite3_busy_timeout(opened, 3000))
            // Detect NOTADB before any schema creation; never delete/recreate on failure.
            if existed { try physicalCheck() }
            let initialVersion = try rows("PRAGMA user_version").first?["user_version"]
            if let version = initialVersion.flatMap(Int.init), version > 2 { throw RepositoryError("UNSUPPORTED_SCHEMA") }
            if existed && initialVersion == "0" {
                // A crash between sqlite3_open and the schema COMMIT can leave
                // zero bytes or a valid empty SQLite file. Only these are new.
                guard try rows("SELECT name FROM sqlite_master").isEmpty,
                      try rows("PRAGMA application_id").first?["application_id"] == "0" else { throw RepositoryError("CORRUPT") }
            }
            guard try rows("PRAGMA journal_mode=DELETE").first?["journal_mode"] == "delete" else { throw RepositoryError("BUSY") }
            try run("PRAGMA synchronous=EXTRA")
            try run("PRAGMA foreign_keys=ON")
            try run("PRAGMA fullfsync=ON")
            try run("PRAGMA trusted_schema=OFF")
            try run("PRAGMA temp_store=MEMORY")
            guard try rows("PRAGMA synchronous").first?["synchronous"] == "3",
                  try rows("PRAGMA foreign_keys").first?["foreign_keys"] == "1" else { throw RepositoryError("IO_ERROR") }
            // DDL and version publication share one rollback-journal transaction.
            try transaction {
                let version = try rows("PRAGMA user_version").first?["user_version"]
                if version == "0" {
                    try createSchema()
                    try run("PRAGMA application_id=\(Self.applicationID)")
                    try run("PRAGMA user_version=1")
                } else if version != "1" && version != "2" { throw RepositoryError("UNSUPPORTED_SCHEMA") }
                if version == "0" || version == "1" {
                    try schemaCheck(version: "1")
                    try migrateCollaborationSchema()
                    try run("PRAGMA user_version=2")
                    try fault?("migrationAfterVersion")
                }
                try schemaCheck()
                // Sharing summary is optional and written by normal saves.
                // Never validate every attachment here: one damaged document
                // must not prevent opening the repository for local recovery.
            }
            try protect(url)
            Self.openCounts[url.path, default: 0] += 1
        } catch {
            sqlite3_close_v2(opened); db = nil
            throw classified(error)
        }
    }

    private func createSchema() throws {
        for table in ["project_bodies", "project_previous"] {
            let foreign = table == "project_previous" ? ", FOREIGN KEY(id) REFERENCES project_bodies(id) ON DELETE CASCADE" : ""
            try run("""
                CREATE TABLE \(table) (
                id TEXT PRIMARY KEY COLLATE BINARY, json TEXT NOT NULL,
                byte_length INTEGER NOT NULL CHECK(byte_length>=0), crc32 TEXT NOT NULL,
                repository_revision TEXT NOT NULL, local_revision TEXT NOT NULL,
                schema_version INTEGER NOT NULL CHECK(schema_version=1), sync_json TEXT CHECK(sync_json IS NULL)
                \(foreign))
                """)
        }
        try run("""
            CREATE TABLE project_summaries (
            id TEXT PRIMARY KEY COLLATE BINARY REFERENCES project_bodies(id) ON DELETE CASCADE,
            json TEXT NOT NULL, byte_length INTEGER NOT NULL, crc32 TEXT NOT NULL,
            sort_time INTEGER NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('stage','parade')))
            """)
        try run("CREATE INDEX summary_order ON project_summaries(sort_time DESC,id ASC)")
        try run("CREATE INDEX summary_mode_order ON project_summaries(mode,sort_time DESC,id ASC)")
        try run("""
            CREATE TABLE operation_receipts (
            operation_id TEXT PRIMARY KEY COLLATE BINARY, signature TEXT NOT NULL, kind TEXT NOT NULL,
            result_json TEXT NOT NULL, byte_length INTEGER NOT NULL, crc32 TEXT NOT NULL)
            """)
        // Reserved minimal frames, no speculative sync behavior or arbitrary update API.
        try run("CREATE TABLE personal_sync (id TEXT PRIMARY KEY REFERENCES project_bodies(id) ON DELETE CASCADE, state_json TEXT NOT NULL)")
        try run("CREATE TABLE migration_items (source_key TEXT PRIMARY KEY, state_json TEXT NOT NULL)")
    }

    private func migrateCollaborationSchema() throws {
        // Additive: payloads, receipts and ledger remain byte-for-byte. Body
        // schema_version=1 describes Project encoding, not the database schema.
        for table in ["project_bodies", "project_previous"] {
            try run("ALTER TABLE \(table) ADD COLUMN collaboration_json TEXT")
            try run("ALTER TABLE \(table) ADD COLUMN collaboration_byte_length INTEGER")
            try run("ALTER TABLE \(table) ADD COLUMN collaboration_crc32 TEXT")
            try fault?("migrationAfter-\(table)")
        }
    }

    private func schemaCheck(version: String = "2") throws {
        guard try rows("PRAGMA application_id").first?["application_id"] == Self.applicationID,
              try rows("PRAGMA user_version").first?["user_version"] == version else { throw RepositoryError("CORRUPT") }
        var expected: [String: Set<String>] = [
            "project_bodies": ["id","json","byte_length","crc32","repository_revision","local_revision","schema_version","sync_json"],
            "project_previous": ["id","json","byte_length","crc32","repository_revision","local_revision","schema_version","sync_json"],
            "project_summaries": ["id","json","byte_length","crc32","sort_time","mode"],
            "operation_receipts": ["operation_id","signature","kind","result_json","byte_length","crc32"],
            "personal_sync": ["id","state_json"], "migration_items": ["source_key","state_json"]
        ]
        if version == "2" {
            for table in ["project_bodies", "project_previous"] {
                expected[table]?.formUnion(["collaboration_json", "collaboration_byte_length", "collaboration_crc32"])
            }
        }
        for (table, columns) in expected {
            guard Set(try rows("PRAGMA table_info(\(table))").compactMap { $0["name"] }) == columns else { throw RepositoryError("CORRUPT") }
        }
        for (index, columns) in ["summary_order": ["sort_time", "id"], "summary_mode_order": ["mode", "sort_time", "id"]] {
            guard try rows("PRAGMA index_info(\(index))").compactMap({ $0["name"] }) == columns else { throw RepositoryError("CORRUPT") }
        }
    }
    private func physicalCheck() throws {
        let result = try rows("PRAGMA quick_check")
        guard result.count == 1, result.first?["quick_check"] == "ok",
              try rows("PRAGMA foreign_key_check").isEmpty else { throw RepositoryError("CORRUPT") }
    }

    private func scan(_ sql: String, _ values: [String?] = [], handle: OpaquePointer? = nil,
                      visit: ([String: String]) throws -> Void) throws {
        let h = handle ?? db
        var statement: OpaquePointer?
        try check(sqlite3_prepare_v2(h, sql, -1, &statement, nil), handle: h)
        guard let s = statement else { throw RepositoryError("IO_ERROR") }
        defer { sqlite3_finalize(s) }
        for (index, value) in values.enumerated() {
            if let text = value {
                guard text.utf8.count <= Int(Int32.max) else { throw RepositoryError("INVALID_ARGUMENT") }
                let rc = text.withCString { sqlite3_bind_text(s, Int32(index + 1), $0, Int32(text.utf8.count), transient) }
                try check(rc, handle: h)
            } else { try check(sqlite3_bind_null(s, Int32(index + 1)), handle: h) }
        }
        while true {
            let rc = sqlite3_step(s)
            if rc == SQLITE_DONE { break }
            guard rc == SQLITE_ROW else { try check(rc, handle: h); throw RepositoryError("IO_ERROR") }
            var row: [String: String] = [:]
            for i in 0..<sqlite3_column_count(s) {
                if sqlite3_column_type(s, i) == SQLITE_NULL { continue }
                guard let name = sqlite3_column_name(s, i), let bytes = sqlite3_column_text(s, i) else { throw RepositoryError("CORRUPT") }
                let data = Data(bytes: bytes, count: Int(sqlite3_column_bytes(s, i)))
                guard let text = String(data: data, encoding: .utf8) else { throw RepositoryError("CORRUPT") }
                row[String(cString: name)] = text
            }
            try visit(row)
        }
    }
    private func rows(_ sql: String, _ values: [String?] = []) throws -> [[String: String]] {
        var result: [[String: String]] = []
        try scan(sql, values) { result.append($0) }
        return result
    }
    private func run(_ sql: String, _ values: [String?] = []) throws { try scan(sql, values) { _ in } }
    private func transaction<T>(_ work: () throws -> T) throws -> T {
        try run("BEGIN IMMEDIATE")
        do {
            let result = try work()
            try fault?("beforeCommit")
            try run("COMMIT") // Success is returned only after this statement reaches SQLITE_DONE.
            return result
        } catch {
            do { try run("ROLLBACK") } catch { /* SQLite may already have rolled back (FULL/IOERR). */ }
            // If rollback did not end the transaction, discard this connection.
            // During open(), it has not yet been registered in openCounts.
            if let h = db, sqlite3_get_autocommit(h) == 0 { poisoned = true }
            throw error
        }
    }

    private func project(_ json: String, code: String = "CORRUPT") throws -> [String: Any] {
        guard json.utf8.count <= CollaborationValidation.jsonBytes else { throw RepositoryError(code == "CORRUPT" ? code : "QUOTA_EXCEEDED") }
        let p = try RepositoryValidation.object(json, code: code)
        _ = try RepositoryValidation.id(p["id"])
        guard ProjectValidation.valid(p), p["title"] is String, p["updatedAt"] is String, p["version"] is NSNumber,
              p["stage"] is [String: Any], p["members"] is [[String: Any]],
              p["stageObjects"] is [[String: Any]], p["frames"] is [[String: Any]],
              p["mode"] == nil || ["stage", "parade"].contains(p["mode"] as? String ?? ""),
              p["createdAt"] == nil || p["createdAt"] is String,
              p["lastOpenedAt"] == nil || p["lastOpenedAt"] is String else { throw RepositoryError(code) }
        if let audio = p["audio"], !(audio is NSNull) {
            guard let a = audio as? [String: Any] else { throw RepositoryError(code) }
            _ = try RepositoryValidation.id(a["id"])
        }
        return p
    }
    private func sharingSummary(_ collaboration: String?) throws -> [String: Any]? {
        guard let json = collaboration else { return nil }
        let data = try CollaborationValidation.parse(json)
        guard let document = data["sharedDocumentId"] as? String else { return nil }
        var result: [String: Any] = ["documentId": document]
        if let binding = data["transportBinding"] as? [String: Any] {
            result["accountId"] = binding["accountId"]
            result["membershipGeneration"] = binding["membershipGeneration"]
        }
        return result
    }
    private func summary(_ p: [String: Any], revision: String, collaboration: String? = nil) throws -> [String: Any] {
        var result: [String: Any] = [
            "id": try RepositoryValidation.id(p["id"]), "title": p["title"] as? String ?? "",
            "mode": p["mode"] as? String ?? "stage", "createdAt": p["createdAt"] ?? p["updatedAt"] ?? "",
            "updatedAt": p["updatedAt"] ?? "", "memberCount": (p["members"] as? [Any])?.count ?? 0,
            "sceneCount": (p["frames"] as? [Any])?.count ?? 0, "repositoryRevision": revision, "syncStatus": "local"
        ]
        if let opened = p["lastOpenedAt"] { result["lastOpenedAt"] = opened }
        if let a = p["audio"] as? [String: Any] { result["audioId"] = try RepositoryValidation.id(a["id"]) }
        if let shared = try sharingSummary(collaboration) { result["sharing"] = shared }
        return result
    }
    private func sortTime(_ s: [String: Any]) -> Int64 {
        RepositoryValidation.time((s["lastOpenedAt"] ?? s["updatedAt"] ?? s["createdAt"]) as? String ?? "") ?? 0
    }
    private func verifiedJSON(_ row: [String: String], key: String = "json") throws -> String {
        guard let json = row[key], row["byte_length"] == String(json.utf8.count), row["crc32"] == Integrity.crc32(json) else { throw RepositoryError("CORRUPT") }
        return json
    }
    private func body(_ id: String) throws -> [String: String]? {
        guard let r = try rows("SELECT * FROM project_bodies WHERE id=?", [id]).first else { return nil }
        try validateBody(r)
        return r
    }
    private func validateBody(_ r: [String: String]) throws {
        if let schema = r["schema_version"].flatMap(Int.init), schema > 1 { throw RepositoryError("UNSUPPORTED_SCHEMA") }
        let json = try verifiedJSON(r)
        do {
            let p = try project(json)
            guard let pid = p["id"] as? String, let rid = r["id"], pid.utf8.elementsEqual(rid.utf8),
                  r["schema_version"] == "1", r["sync_json"] == nil else { throw RepositoryError("CORRUPT") }
            _ = try RepositoryValidation.revision(r["repository_revision"])
            _ = try RepositoryValidation.revision(r["local_revision"])
            if let collaboration = r["collaboration_json"] {
                guard r["collaboration_byte_length"] == String(collaboration.utf8.count),
                      r["collaboration_crc32"] == Integrity.crc32(collaboration) else { throw RepositoryError("CORRUPT") }
                _ = try CollaborationValidation.parse(collaboration)
            } else if r["collaboration_byte_length"] != nil || r["collaboration_crc32"] != nil { throw RepositoryError("CORRUPT") }
        } catch let error as RepositoryError where error.code == "UNSUPPORTED_SCHEMA" { throw error
        } catch { throw RepositoryError("CORRUPT") }
    }
    private func decodedSummary(_ r: [String: String]) throws -> [String: Any] {
        let s = try RepositoryValidation.object(verifiedJSON(r), code: "CORRUPT")
        guard RepositoryValidation.validID(s["id"]), let sid = s["id"] as? String, let rid = r["id"], sid.utf8.elementsEqual(rid.utf8),
              s["title"] is String, s["createdAt"] is String, s["updatedAt"] is String,
              ["stage", "parade"].contains(s["mode"] as? String ?? ""), s["mode"] as? String == r["mode"],
              String(sortTime(s)) == r["sort_time"], s["syncStatus"] as? String == "local",
              let members = RepositoryValidation.integer(s["memberCount"]), members >= 0,
              let scenes = RepositoryValidation.integer(s["sceneCount"]), scenes >= 0,
              s["lastOpenedAt"] == nil || s["lastOpenedAt"] is String,
              s["audioId"] == nil || RepositoryValidation.validID(s["audioId"]) else { throw RepositoryError("CORRUPT") }
        do { _ = try RepositoryValidation.revision(s["repositoryRevision"]) } catch { throw RepositoryError("CORRUPT") }
        if let value = s["sharing"] {
            guard let shared = value as? [String: Any], RepositoryValidation.validID(shared["documentId"]),
                  Set(shared.keys).isSubset(of: Set(["documentId", "accountId", "membershipGeneration"])) else { throw RepositoryError("CORRUPT") }
            if shared["accountId"] != nil || shared["membershipGeneration"] != nil {
                guard let account = shared["accountId"] as? String, let member = shared["membershipGeneration"] as? String,
                      UUID(uuidString: account) != nil, UUID(uuidString: member) != nil else { throw RepositoryError("CORRUPT") }
            }
        }
        return s
    }
    private func save(_ id: String, json: String, revision: String, local: String, collaboration: String? = nil) throws -> [String: Any] {
        let s = try summary(project(json), revision: revision, collaboration: collaboration)
        // Keep the previous valid record before overwriting; cascading removal deletes it.
        try run("INSERT OR REPLACE INTO project_previous SELECT * FROM project_bodies WHERE id=?", [id])
        try fault?("afterPrevious")
        try run("""
            INSERT INTO project_bodies(id,json,byte_length,crc32,repository_revision,local_revision,schema_version,sync_json)
            VALUES(?,?,?,?,?,?,1,NULL) ON CONFLICT(id) DO UPDATE SET
            json=excluded.json,byte_length=excluded.byte_length,crc32=excluded.crc32,
            repository_revision=excluded.repository_revision,local_revision=excluded.local_revision
            """, [id,json,String(json.utf8.count),Integrity.crc32(json),revision,local])
        try fault?("afterBody")
        try run("UPDATE project_bodies SET collaboration_json=?,collaboration_byte_length=?,collaboration_crc32=? WHERE id=?",
                [collaboration, collaboration.map { String($0.utf8.count) }, collaboration.map { Integrity.crc32($0) }, id])
        try fault?("afterCollaboration")
        let sj = try RepositoryValidation.json(s)
        try run("""
            INSERT INTO project_summaries(id,json,byte_length,crc32,sort_time,mode) VALUES(?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET json=excluded.json,byte_length=excluded.byte_length,
            crc32=excluded.crc32,sort_time=excluded.sort_time,mode=excluded.mode
            """, [id,sj,String(sj.utf8.count),Integrity.crc32(sj),String(sortTime(s)),s["mode"] as? String])
        try fault?("afterSummary")
        return s
    }

    /// Synchronous core entry point. Plugin calls it off the main thread.
    /// One JSON string; collaborationJSON contains opaque canonical base64.
    public static let maxRequestBytes = 128 * 1024 * 1024
    public func execute(_ method: String, requestJSON: String = "{}") throws -> String {
        try queue.sync {
            StorageMaintenance.lock.lock(); defer { StorageMaintenance.lock.unlock() }
            do {
                guard requestJSON.utf8.count <= Self.maxRequestBytes else { throw RepositoryError("QUOTA_EXCEEDED") }
                let input = try RepositoryValidation.object(requestJSON)
                guard ["initialize","listSummaries","readProject","commitProject","readCommitReceipt","touchOpened","renameProject","removeProject","createRecoveryBackup","readMigration","writeMigration", "restoreRecoveryBackup", "readPrevious", "readMaintenance", "updateMaintenance", "collectUnusedAudio", "legacyCleanupStatus", "cleanupLegacyData"].contains(method) else {
                    throw RepositoryError("INVALID_ARGUMENT")
                }
                if method == "restoreRecoveryBackup" {
                    guard input.isEmpty else { throw RepositoryError("INVALID_ARGUMENT") }
                    try restoreRecoveryBackupLocked(); try connection(); return "null"
                }
                try connection()
                switch method {
                case "initialize": return try RepositoryValidation.json(["status":"ready", "schemaVersion":2, "errors":[String]()] as [String: Any])
                case "readProject", "readPrevious":
                    let id = try RepositoryValidation.id(input["id"])
                    let stored = method == "readPrevious" ? try rows("SELECT * FROM project_previous WHERE id=?", [id]).first : try body(id)
                    guard let r = stored else { return "null" }
                    try validateBody(r)
                    return try RepositoryValidation.json(["json":r["json"]!,"repositoryRevision":r["repository_revision"]!,"localRevision":r["local_revision"]!,"sync":NSNull(),"collaborationJSON":r["collaboration_json"].map { $0 as Any } ?? NSNull()] as [String: Any])
                case "listSummaries": return try list(input)
                case "touchOpened": return try touch(input)
                case "createRecoveryBackup":
                    if input.isEmpty { try backup(); return "{\"created\":true}" }
                    guard input.count == 1, input["ifDue"] as? Bool == true else { throw RepositoryError("INVALID_ARGUMENT") }
                    return try RepositoryValidation.json(["created": try backupIfDue()])
                case "readMaintenance": return try RepositoryValidation.json(maintenanceState())
                case "updateMaintenance": return try updateMaintenance(input)
                case "collectUnusedAudio": return try collectUnusedAudio()
                case "legacyCleanupStatus": return try RepositoryValidation.json(legacyCleanupReasons())
                case "cleanupLegacyData": try cleanupLegacyData(); return "null"
                case "readMigration":
                    let id = try RepositoryValidation.id(input["id"])
                    return try migrationEntry(id).map { try RepositoryValidation.json($0) } ?? "null"
                case "writeMigration": return try writeMigration(input)
                case "readCommitReceipt": return try mutate("commitProject", input, receiptOnly: true)
                default:
                    let result = try mutate(method, input)
                    if method == "commitProject" {
                        // After COMMIT only. A catalog failure retains pending bytes
                        // and must never turn a committed Project into a save failure.
                        do {
                            let receipt = try RepositoryValidation.object(result)
                            if let summary = receipt["summary"] as? [String: Any], let id = summary["audioId"] as? String {
                                try audioStore().confirmReference(id: id)
                            }
                        } catch { print("[audio publication] pending marker retained") }
                    }
                    return result
                }
            } catch {
                if poisoned { closeConnection(); poisoned = false }
                throw classified(error)
            }
        }
    }

    private let migrationStates = ["discovered", "validated", "written", "verified", "completed"]
    private func validateMigration(_ e: [String: Any]) throws {
        _ = try RepositoryValidation.id(e["id"])
        guard let state = e["state"] as? String else { throw RepositoryError("CORRUPT") }
        if e["kind"] as? String == "item" {
            _ = try RepositoryValidation.id(e["targetId"])
            guard let index = migrationStates.firstIndex(of: state), let hash = e["sourceHash"] as? String,
                  hash.utf8.count == 64, hash.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
                  let sources = e["sources"] as? [String], !sources.isEmpty,
                  e["json"] is String, e["reason"] is String,
                  ["import", "recovery"].contains(e["disposition"] as? String ?? ""),
                  (index >= 2) == (e["outcome"] != nil),
                  e["outcome"] == nil || ["imported", "duplicate", "recovery"].contains(e["outcome"] as? String ?? "") else {
                throw RepositoryError("CORRUPT")
            }
            if let value = e["draft"] {
                guard let draft = value as? [String: Any], let cloud = draft["cloudProjectId"] as? String, !cloud.isEmpty,
                      draft["baseUpdatedAt"] is NSNull || draft["baseUpdatedAt"] is String,
                      draft["savedAt"] is String, draft["status"] as? String == "pending" else { throw RepositoryError("CORRUPT") }
            }
        } else if e["kind"] as? String == "batch" {
            guard ["discovered", "completed"].contains(state), let ids = e["itemIds"] as? [String], Set(ids).count == ids.count,
                  let sources = e["sources"] as? [[String: Any]], let issues = e["issues"] as? [[String: Any]] else {
                throw RepositoryError("CORRUPT")
            }
            for id in ids { _ = try RepositoryValidation.id(id) }
            for source in sources {
                guard source["source"] is String, ["absent", "unreadable", "ok"].contains(source["status"] as? String ?? "") else { throw RepositoryError("CORRUPT") }
                if let hash = source["hash"] {
                    guard let h = hash as? String, h.utf8.count == 64,
                          h.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else { throw RepositoryError("CORRUPT") }
                }
            }
            for issue in issues {
                guard issue["source"] is String, ["CORRUPT", "ACCESS_DENIED", "IO_ERROR"].contains(issue["code"] as? String ?? "") else { throw RepositoryError("CORRUPT") }
            }
            if let value = e["counts"] {
                guard state == "completed", let counts = value as? [String: Any] else { throw RepositoryError("CORRUPT") }
                for key in ["migratedCount", "recoveryCount", "duplicateCount"] {
                    guard let n = RepositoryValidation.integer(counts[key]), n >= 0 else { throw RepositoryError("CORRUPT") }
                }
            }
        } else { throw RepositoryError("CORRUPT") }
    }
    private func migrationEntry(_ id: String) throws -> [String: Any]? {
        guard let row = try rows("SELECT state_json FROM migration_items WHERE source_key=?", [id]).first,
              let text = row["state_json"] else { return nil }
        let envelope = try RepositoryValidation.object(text, code: "CORRUPT")
        guard let json = envelope["json"] as? String,
              RepositoryValidation.integer(envelope["byteLength"]) == json.utf8.count,
              envelope["crc32"] as? String == Integrity.crc32(json) else { throw RepositoryError("CORRUPT") }
        let entry = try RepositoryValidation.object(json, code: "CORRUPT")
        do { try validateMigration(entry) } catch { throw RepositoryError("CORRUPT") }
        guard let storedID = entry["id"] as? String, storedID.utf8.elementsEqual(id.utf8) else { throw RepositoryError("CORRUPT") }
        return entry
    }
    private func migrationIdentity(_ e: [String: Any]) throws -> String {
        var identity = e
        identity.removeValue(forKey: "state"); identity.removeValue(forKey: "outcome"); identity.removeValue(forKey: "counts")
        return try RepositoryValidation.json(identity)
    }
    private func writeMigration(_ input: [String: Any]) throws -> String {
        guard var entry = input["entry"] as? [String: Any] else { throw RepositoryError("INVALID_ARGUMENT") }
        try validateMigration(entry)
        let id = try RepositoryValidation.id(entry["id"])
        let state = entry["state"] as! String
        let isItem = entry["kind"] as? String == "item"
        let states: [String] = isItem ? migrationStates : ["discovered", "completed"]
        guard input["expectedState"] is NSNull || (input["expectedState"] as? String).map({ states.contains($0) }) == true else {
            throw RepositoryError("INVALID_ARGUMENT")
        }
        return try transaction {
            if let current = try migrationEntry(id) {
                guard try migrationIdentity(current).utf8.elementsEqual(migrationIdentity(entry).utf8),
                      let oldState = current["state"] as? String, let oldIndex = states.firstIndex(of: oldState),
                      let newIndex = states.firstIndex(of: state) else { throw RepositoryError("CONFLICT") }
                if isItem && newIndex > 2 && current["outcome"] as? String != entry["outcome"] as? String { throw RepositoryError("CONFLICT") }
                if oldIndex >= newIndex { return try RepositoryValidation.json(current) }
                guard oldState == input["expectedState"] as? String, newIndex == oldIndex + 1 else { throw RepositoryError("CONFLICT") }
            } else {
                guard input["expectedState"] is NSNull, state == "discovered" else { throw RepositoryError("CONFLICT") }
            }
            if !isItem && state == "completed" {
                for itemID in entry["itemIds"] as! [String] {
                    guard let item = try migrationEntry(itemID), item["kind"] as? String == "item",
                          item["state"] as? String == "completed" else { throw RepositoryError("CONFLICT") }
                }
            }
            if isItem && state == "validated" && entry["disposition"] as? String == "import" {
                let p = try project(entry["json"] as! String)
                guard let pid = p["id"] as? String, let target = entry["targetId"] as? String,
                      pid.utf8.elementsEqual(target.utf8) else { throw RepositoryError("CORRUPT") }
            }
            if isItem && state == "written" {
                entry["outcome"] = "recovery"
                if entry["disposition"] as? String == "import" {
                    let target = try RepositoryValidation.id(entry["targetId"])
                    let json = entry["json"] as! String
                    let p = try project(json)
                    guard let pid = p["id"] as? String, pid.utf8.elementsEqual(target.utf8) else { throw RepositoryError("CORRUPT") }
                    let claim = "legacy-target-" + Integrity.sha256(target)
                    if let current = try body(target) {
                        let old = try project(current["json"]!)
                        if try RepositoryValidation.json(old).utf8.elementsEqual(RepositoryValidation.json(p).utf8) { entry["outcome"] = "duplicate" }
                    } else if try rows("SELECT operation_id FROM operation_receipts WHERE operation_id=?", [claim]).isEmpty {
                        let s = try save(target, json: json, revision: "1", local: "1")
                        let receipt = try RepositoryValidation.json(["id":target,"operationId":claim,"repositoryRevision":"1","localRevision":"1","summary":s] as [String: Any])
                        try run("INSERT INTO operation_receipts VALUES(?,?,?,?,?,?)", [claim,entry["sourceHash"] as? String,"commitProject",receipt,String(receipt.utf8.count),Integrity.crc32(receipt)])
                        entry["outcome"] = "imported"
                    }
                }
                try fault?("migrationAfterBody")
            }
            let json = try RepositoryValidation.json(entry)
            let envelope = try RepositoryValidation.json(["json":json,"byteLength":json.utf8.count,"crc32":Integrity.crc32(json)] as [String: Any])
            try run("INSERT INTO migration_items(source_key,state_json) VALUES(?,?) ON CONFLICT(source_key) DO UPDATE SET state_json=excluded.state_json", [id,envelope])
            try fault?("migrationAfterLedger")
            return json
        }
    }

    private func list(_ input: [String: Any]) throws -> String {
        guard let n = input["limit"] as? NSNumber, String(cString: n.objCType) != "c",
              n.doubleValue == Double(n.intValue), (1...100).contains(n.intValue) else { throw RepositoryError("INVALID_ARGUMENT") }
        let limit = n.intValue
        let mode = input["mode"] as? String
        guard input["mode"] == nil || ["stage","parade"].contains(mode ?? "") else { throw RepositoryError("INVALID_ARGUMENT") }
        var clauses: [String] = [], values: [String?] = []
        if let m = mode { clauses.append("mode=?"); values.append(m) }
        if let cursor = input["cursor"] {
            guard let text = cursor as? String else { throw RepositoryError("INVALID_ARGUMENT") }
            do {
                let c = try RepositoryValidation.object(text)
                guard RepositoryValidation.integer(c["version"]) == 1, c["mode"] as? String == mode,
                      (c["mode"] == nil || c["mode"] is String), let time = c["time"] as? NSNumber,
                      String(cString: time.objCType) != "c", time.doubleValue == Double(time.int64Value), abs(time.doubleValue) <= 8640000000000000 else {
                    throw RepositoryError("INVALID_ARGUMENT")
                }
                let id = try RepositoryValidation.id(c["id"])
                clauses.append("(sort_time < ? OR (sort_time = ? AND id > ? COLLATE BINARY))")
                values += [time.stringValue,time.stringValue,id]
            } catch { throw RepositoryError("INVALID_ARGUMENT") }
        }
        values.append(String(limit + 1))
        let whereSQL = clauses.isEmpty ? "" : " WHERE " + clauses.joined(separator: " AND ")
        let all = try rows("SELECT * FROM project_summaries\(whereSQL) ORDER BY sort_time DESC,id COLLATE BINARY ASC LIMIT ?", values).map { try decodedSummary($0) }
        let items = Array(all.prefix(limit))
        var cursor: Any = NSNull()
        if all.count > limit, let last = items.last {
            var c: [String: Any] = ["version":1,"id":last["id"]!,"time":sortTime(last)]
            if let m = mode { c["mode"] = m }
            cursor = try RepositoryValidation.json(c)
        }
        return try RepositoryValidation.json(["items":items,"nextCursor":cursor] as [String: Any])
    }

    private func touch(_ input: [String: Any]) throws -> String {
        let id = try RepositoryValidation.id(input["id"])
        guard let at = input["openedAt"] as? String, RepositoryValidation.time(at) != nil else { throw RepositoryError("INVALID_ARGUMENT") }
        return try transaction {
            guard let r = try body(id) else { throw RepositoryError("NOT_FOUND") }
            var p = try project(r["json"]!)
            p["lastOpenedAt"] = at
            return try RepositoryValidation.json(save(id, json: RepositoryValidation.json(p), revision: RepositoryValidation.increment(r["repository_revision"]!), local: r["local_revision"]!, collaboration: r["collaboration_json"]))
        }
    }
    private func mutate(_ method: String, _ input: [String: Any], receiptOnly: Bool = false) throws -> String {
        let id = try RepositoryValidation.id(input["id"])
        let operation = try RepositoryValidation.id(input["operationId"])
        let expected: String?
        if method == "commitProject", input["expectedRepositoryRevision"] is NSNull { expected = nil }
        else { expected = try RepositoryValidation.revision(input["expectedRepositoryRevision"]) }
        let local = method == "removeProject" ? nil : try RepositoryValidation.revision(input["localRevision"])
        if method == "commitProject" {
            if let text = input["json"] as? String, text.utf8.count > CollaborationValidation.jsonBytes { throw RepositoryError("QUOTA_EXCEEDED") }
            guard let json = input["json"] as? String,
                  let pid = try project(json)["id"] as? String, pid.utf8.elementsEqual(id.utf8) else { throw RepositoryError("CORRUPT") }
        }
        if method == "renameProject" {
            guard let title = input["title"] as? String, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  let at = input["updatedAt"] as? String, RepositoryValidation.time(at) != nil else { throw RepositoryError("INVALID_ARGUMENT") }
        }
        let collaboration: String?
        if method == "commitProject" {
            if input["collaborationJSON"] == nil || input["collaborationJSON"] is NSNull { collaboration = nil }
            else {
                guard let text = input["collaborationJSON"] as? String else { throw RepositoryError("INVALID_ARGUMENT") }
                _ = try CollaborationValidation.parse(text)
                collaboration = text
            }
            guard input["sync"] == nil || input["sync"] is NSNull else { throw RepositoryError("INVALID_ARGUMENT") }
        } else { collaboration = nil }
        var digestInput = input
        if let collaboration = collaboration {
            digestInput["collaborationJSON"] = try CollaborationValidation.parse(collaboration)
        } else { digestInput.removeValue(forKey: "collaborationJSON") }
        let signature = Integrity.sha256(try RepositoryValidation.json(["kind":method,"request":digestInput] as [String: Any]))
        return try transaction {
            if let previous = try rows("SELECT * FROM operation_receipts WHERE operation_id=?", [operation]).first {
                let result = try validateReceipt(previous)
                guard previous["signature"] == signature, previous["kind"] == method else { throw RepositoryError("CONFLICT") }
                return result
            }
            if receiptOnly { return "null" }
            let current = try body(id)
            if let expect = expected {
                guard let r = current else { throw RepositoryError("NOT_FOUND") }
                guard r["repository_revision"] == expect else { throw RepositoryError("CONFLICT") }
                if let l = local, !RepositoryValidation.greater(l, r["local_revision"]!) { throw RepositoryError("CONFLICT") }
            } else if current != nil { throw RepositoryError("CONFLICT") }
            var result = "null"
            if method == "removeProject" {
                try run("DELETE FROM project_bodies WHERE id=?", [id])
                try fault?("afterBody")
            } else {
                let json: String
                if method == "commitProject" { json = input["json"] as! String }
                else {
                    var p = try project(current!["json"]!)
                    p["title"] = input["title"]; p["updatedAt"] = input["updatedAt"]
                    json = try RepositoryValidation.json(p)
                }
                let nextCollaboration = method == "commitProject" ? collaboration : current?["collaboration_json"]
                try CollaborationValidation.transition(current?["collaboration_json"], nextCollaboration)
                let revision = current.map { RepositoryValidation.increment($0["repository_revision"]!) } ?? "1"
                let s = try save(id, json: json, revision: revision, local: local!, collaboration: nextCollaboration)
                result = try RepositoryValidation.json(["id":id,"operationId":operation,"repositoryRevision":revision,"localRevision":local!,"summary":s] as [String: Any])
            }
            try run("INSERT INTO operation_receipts VALUES(?,?,?,?,?,?)", [operation,signature,method,result,String(result.utf8.count),Integrity.crc32(result)])
            try fault?("afterReceipt")
            return result
        }
    }

    private let maintenanceID = "device-maintenance-v1"
    private let day: Double = 86_400_000
    private func maintenanceState() throws -> [String: Any] {
        guard let row = try rows("SELECT state_json FROM migration_items WHERE source_key=?", [maintenanceID]).first,
              let raw = row["state_json"] else {
            return ["completedAt": NSNull(), "successfulStarts": 0, "reviewedIds": [String](), "gcAt": NSNull()]
        }
        let envelope = try RepositoryValidation.object(raw, code: "CORRUPT")
        guard let json = envelope["json"] as? String, RepositoryValidation.integer(envelope["byteLength"]) == json.utf8.count,
              envelope["crc32"] as? String == Integrity.crc32(json) else { throw RepositoryError("CORRUPT") }
        let state = try RepositoryValidation.object(json, code: "CORRUPT")
        guard let starts = RepositoryValidation.integer(state["successfulStarts"]), starts >= 0,
              let reviewed = state["reviewedIds"] as? [String], Set(reviewed).count == reviewed.count else { throw RepositoryError("CORRUPT") }
        for id in reviewed { _ = try RepositoryValidation.id(id) }
        for key in ["completedAt", "gcAt"] {
            guard state[key] is NSNull || (RepositoryValidation.integer(state[key]).map { $0 > 0 } ?? false) else { throw RepositoryError("CORRUPT") }
        }
        return state
    }
    private func persistMaintenance(_ state: [String: Any]) throws {
        let json = try RepositoryValidation.json(state)
        let envelope = try RepositoryValidation.json(["json": json, "byteLength": json.utf8.count, "crc32": Integrity.crc32(json)] as [String: Any])
        try run("INSERT INTO migration_items(source_key,state_json) VALUES(?,?) ON CONFLICT(source_key) DO UPDATE SET state_json=excluded.state_json", [maintenanceID, envelope])
    }
    private func updateMaintenance(_ input: [String: Any]) throws -> String {
        guard let action = input["action"] as? String, ["started", "reviewed"].contains(action) else { throw RepositoryError("INVALID_ARGUMENT") }
        return try transaction {
            var state = try maintenanceState()
            let batch = try migrationEntry("legacy-projects-v1")
            if action == "started", batch?["state"] as? String == "completed" {
                if state["completedAt"] is NSNull { state["completedAt"] = Int(Date().timeIntervalSince1970 * 1000) }
                state["successfulStarts"] = (RepositoryValidation.integer(state["successfulStarts"]) ?? 0) + 1
            } else if action == "reviewed" {
                guard let ids = input["ids"] as? [String], let allowed = batch?["itemIds"] as? [String], ids.allSatisfy({ allowed.contains($0) }) else { throw RepositoryError("INVALID_ARGUMENT") }
                for id in ids { _ = try RepositoryValidation.id(id) }
                state["reviewedIds"] = Array(Set((state["reviewedIds"] as? [String] ?? []) + ids)).sorted()
            }
            try persistMaintenance(state)
            return try RepositoryValidation.json(state)
        }
    }
    private func addAudio(_ value: [String: Any], to references: inout [String: StoredAudioMeta]) throws {
        guard let raw = value["audio"], !(raw is NSNull) else { return }
        guard let audio = raw as? [String: Any] else { throw RepositoryError("CORRUPT") }
        let meta = try JSONDecoder().decode(StoredAudioMeta.self, from: JSONSerialization.data(withJSONObject: audio))
        _ = try RepositoryValidation.id(meta.id)
        if let previous = references[meta.id], previous.size != meta.size { throw RepositoryError("CORRUPT") }
        references[meta.id] = meta
    }
    private func audioReferences() throws -> [String: StoredAudioMeta] {
        var references: [String: StoredAudioMeta] = [:]
        for table in ["project_bodies", "project_previous"] {
            try scan("SELECT * FROM \(table)") { row in
                try validateBody(row)
                try addAudio(RepositoryValidation.object(row["json"]!, code: "CORRUPT"), to: &references)
                if let json = row["collaboration_json"], let bindings = try CollaborationValidation.parse(json)["audioBindings"] as? [[String: Any]] {
                    for binding in bindings { try addAudio(binding, to: &references) }
                }
            }
        }
        try scan("SELECT source_key FROM migration_items") { row in
            guard let id = row["source_key"] else { throw RepositoryError("CORRUPT") }
            if id == maintenanceID { _ = try maintenanceState(); return }
            guard let entry = try migrationEntry(id) else { throw RepositoryError("CORRUPT") }
            if entry["kind"] as? String == "item", entry["disposition"] as? String == "recovery" || entry["outcome"] as? String == "recovery" || entry["state"] as? String != "completed" {
                guard let json = entry["json"] as? String else { throw RepositoryError("CORRUPT") }
                try addAudio(RepositoryValidation.object(json, code: "CORRUPT"), to: &references)
            }
        }
        for (id, meta) in try draftAudioReferences() {
            if let known = references[id], known.size != meta.size { throw RepositoryError("CORRUPT") }
            references[id] = meta
        }
        return references
    }
    /// Existing personal drafts deliberately remain outside migration. Read
    /// their local primary/pending/backup references without importing or editing
    /// them, so audio cleanup cannot damage that separate persistence path.
    private func draftAudioReferences() throws -> [String: StoredAudioMeta] {
        guard let documents = documentsURL ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { throw RepositoryError("ACCESS_DENIED") }
        let root = documents.resolvingSymlinksInPath().standardizedFileURL.appendingPathComponent("personal-cloud-drafts", isDirectory: true)
        let fm = FileManager.default
        do {
            guard (try fm.attributesOfItem(atPath: root.path))[.type] as? FileAttributeType == .typeDirectory,
                  root.resolvingSymlinksInPath().standardizedFileURL == root.standardizedFileURL else { throw RepositoryError("ACCESS_DENIED") }
        } catch let error as RepositoryError { throw error
        } catch let error as NSError {
            if error.domain == NSCocoaErrorDomain && [NSFileReadNoSuchFileError, NSFileNoSuchFileError].contains(error.code) { return [:] }
            throw error
        }
        var references: [String: StoredAudioMeta] = [:]
        for file in try fm.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) where file.pathExtension == "json" {
            let attrs = try fm.attributesOfItem(atPath: file.path)
            guard attrs[.type] as? FileAttributeType == .typeRegular, let bytes = attrs[.size] as? NSNumber, bytes.int64Value <= 64 * 1024 * 1024,
                  file.resolvingSymlinksInPath().standardizedFileURL == file.standardizedFileURL else { throw RepositoryError("CORRUPT") }
            guard let text = String(data: try Data(contentsOf: file), encoding: .utf8) else { throw RepositoryError("CORRUPT") }
            let raw = try RepositoryValidation.object(text, code: "CORRUPT")
            guard let project = raw["project"] as? [String: Any] else { throw RepositoryError("CORRUPT") }
            try addAudio(project, to: &references)
        }
        return references
    }
    private func backupReferences() throws -> [String: StoredAudioMeta] {
        guard FileManager.default.fileExists(atPath: recoveryURL.path) else { return [:] }
        let source = ProjectRepository(databaseURL: recoveryURL, protectedDataAvailable: protectedDataAvailable, documentsURL: documentsURL)
        try source.connection(); defer { source.closeConnection() }
        try source.validateAll()
        return try source.audioReferences()
    }
    private func hasCollaboration() throws -> Bool {
        for table in ["project_bodies", "project_previous"] {
            if try !rows("SELECT id FROM \(table) WHERE collaboration_json IS NOT NULL LIMIT 1").isEmpty { return true }
        }
        return false
    }
    private func backupHasCollaboration() throws -> Bool {
        guard FileManager.default.fileExists(atPath: recoveryURL.path) else { return false }
        let source = ProjectRepository(databaseURL: recoveryURL, protectedDataAvailable: protectedDataAvailable)
        try source.connection(); defer { source.closeConnection() }
        try source.validateAll()
        return try source.hasCollaboration()
    }
    private func audioStore() throws -> AudioStore {
        guard let documents = documentsURL ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { throw RepositoryError("ACCESS_DENIED") }
        return AudioStore(directory: url.deletingLastPathComponent().appendingPathComponent("audio", isDirectory: true),
                          legacyDirectory: documents.resolvingSymlinksInPath().standardizedFileURL.appendingPathComponent("audio", isDirectory: true))
    }
    private func collectUnusedAudio() throws -> String {
        var state = try maintenanceState()
        let now = Int(Date().timeIntervalSince1970 * 1000)
        let skip: [String: Any] = ["count": 0, "bytes": 0, "skipped": true]
        guard let batch = try migrationEntry("legacy-projects-v1"), batch["state"] as? String == "completed",
              !(state["completedAt"] is NSNull), (RepositoryValidation.integer(state["gcAt"]).map { Double(now - $0) >= day } ?? true) else { return try RepositoryValidation.json(skip) }
        Self.lifecycle.lock(); let exclusive = Self.openCounts[url.path, default: 0] == 1; Self.lifecycle.unlock()
        guard exclusive else { return try RepositoryValidation.json(skip) }
        guard try !hasCollaboration(), try !backupHasCollaboration() else { return try RepositoryValidation.json(skip) }
        var references = try audioReferences()
        for (id, meta) in try backupReferences() { references[id] = meta }
        let stats = try audioStore().collectUnused(referenced: Set(references.keys))
        state["gcAt"] = now
        try transaction { try persistMaintenance(state) }
        // Counts and bytes only; never log logical IDs, paths, titles or media.
        print("[audio GC] count=\(stats.count) bytes=\(stats.bytes)")
        return try RepositoryValidation.json(["count": stats.count, "bytes": stats.bytes, "skipped": false] as [String: Any])
    }
    private func legacyCleanupReasons() throws -> [String] {
        let state = try maintenanceState(), batch = try migrationEntry("legacy-projects-v1")
        var reasons: [String] = []
        if batch?["state"] as? String != "completed" { reasons.append("古いデータの移行が完了していません。") }
        if (batch?["issues"] as? [[String: Any]])?.isEmpty != true { reasons.append("移行元に確認できていないデータがあります。") }
        let reviewed = Set(state["reviewedIds"] as? [String] ?? [])
        for id in batch?["itemIds"] as? [String] ?? [] {
            guard let item = try migrationEntry(id), item["state"] as? String == "completed" else {
                reasons.append("移行結果を確認できません。"); continue
            }
            if (item["disposition"] as? String == "recovery" || item["outcome"] as? String == "recovery"), !reviewed.contains(id) { reasons.append("復元候補をすべて確認してください。") }
        }
        if RepositoryValidation.integer(state["completedAt"]).map({ Date().timeIntervalSince1970 * 1000 - Double($0) >= 30 * day }) != true {
            reasons.append("移行完了の確認から30日以上必要です。")
        }
        if (RepositoryValidation.integer(state["successfulStarts"]) ?? 0) < 2 { reasons.append("移行後にもう一度正常に起動してください。") }
        do { try validateAll(); _ = try draftAudioReferences() } catch { reasons.append("現在の保存データ、前の保存または端末の下書きを検証できません。") }
        do {
            if !FileManager.default.fileExists(atPath: recoveryURL.path) { reasons.append("検証済みの端末バックアップがありません。") }
            else { _ = try backupReferences() }
        } catch { reasons.append("端末バックアップの検証に失敗しました。") }
        do {
            if try hasCollaboration() || backupHasCollaboration() { reasons.append("共同編集の履歴があるため、古い音源の整理を保留しています。") }
        } catch { reasons.append("共同編集の保護対象を検証できません。") }
        return Array(Set(reasons)).sorted()
    }
    private func cleanupLegacyData() throws {
        guard try legacyCleanupReasons().isEmpty else { throw RepositoryError("CONFLICT") }
        Self.lifecycle.lock(); let exclusive = Self.openCounts[url.path, default: 0] == 1; Self.lifecycle.unlock()
        guard exclusive else { throw RepositoryError("BUSY") }
        var references = try audioReferences()
        for (id, meta) in try backupReferences() { references[id] = meta }
        let store = try audioStore()
        // Copy every protected old audio first. A missing/unreadable source aborts
        // before any deletion, including when only a recovery item references it.
        for meta in references.values {
            guard try store.migrateLegacy(meta: meta) != nil else { throw RepositoryError("CORRUPT") }
        }
        guard let documents = documentsURL ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { throw RepositoryError("ACCESS_DENIED") }
        // Canonicalize the trusted OS container first (/var may alias
        // /private/var). Child symlinks must still be rejected below.
        let documentsRoot = documents.resolvingSymlinksInPath().standardizedFileURL
        let fm = FileManager.default
        var targets = ["projects/projects.json", "projects/projects.pending.json", "projects/projects.backup.json"].map { documentsRoot.appendingPathComponent($0) }
        let audio = documentsRoot.appendingPathComponent("audio", isDirectory: true)
        if fm.fileExists(atPath: audio.path) {
            guard audio.resolvingSymlinksInPath().standardizedFileURL == audio.standardizedFileURL else { throw RepositoryError("ACCESS_DENIED") }
            for file in try fm.contentsOfDirectory(at: audio, includingPropertiesForKeys: nil) {
                if ["data", "json"].contains(file.pathExtension), AudioStore.safeLegacyID(file.deletingPathExtension().lastPathComponent) { targets.append(file) }
            }
        }
        // Preflight all targets before unlinking. No recursive deletion or user paths.
        for target in targets where fm.fileExists(atPath: target.path) {
            guard target.resolvingSymlinksInPath().standardizedFileURL == target.standardizedFileURL,
                  (try fm.attributesOfItem(atPath: target.path))[.type] as? FileAttributeType == .typeRegular else { throw RepositoryError("ACCESS_DENIED") }
        }
        for target in targets where fm.fileExists(atPath: target.path) { try fm.removeItem(at: target) }
    }
    static func recoveryBackupDue(now: Date, last: Date?, freeBytes: Int64, databaseBytes: Int64) -> Bool {
        (last.map { now.timeIntervalSince($0) >= 86400 } ?? true) && databaseBytes >= 0 &&
        databaseBytes <= (Int64.max - 16 * 1024 * 1024) / 2 && freeBytes >= databaseBytes * 2 + 16 * 1024 * 1024
    }
    private func backupIfDue() throws -> Bool {
        let fm = FileManager.default
        let last = (try? fm.attributesOfItem(atPath: recoveryURL.path)[.modificationDate]) as? Date
        let free = try fm.attributesOfFileSystem(forPath: url.deletingLastPathComponent().path)[.systemFreeSize] as? NSNumber
        let size = try fm.attributesOfItem(atPath: url.path)[.size] as? NSNumber
        guard let freeBytes = free?.int64Value, let bytes = size?.int64Value,
              Self.recoveryBackupDue(now: Date(), last: last, freeBytes: freeBytes, databaseBytes: bytes) else { return false }
        try backup(); return true
    }
    private var recoveryURL: URL { url.deletingLastPathComponent().appendingPathComponent("recovery", isDirectory: true).appendingPathComponent("repository.backup.sqlite") }
    private func validateReceipt(_ r: [String: String]) throws -> String {
        let result = try verifiedJSON(r, key: "result_json")
        guard RepositoryValidation.validID(r["operation_id"]), let signature = r["signature"], signature.count == 64,
              signature.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
              ["commitProject","renameProject","removeProject"].contains(r["kind"] ?? "") else { throw RepositoryError("CORRUPT") }
        if r["kind"] == "removeProject" {
            guard result == "null" else { throw RepositoryError("CORRUPT") }
        } else {
            let receipt = try RepositoryValidation.object(result, code: "CORRUPT")
            guard RepositoryValidation.validID(receipt["id"]), let op = receipt["operationId"] as? String,
                  let saved = r["operation_id"], op.utf8.elementsEqual(saved.utf8),
                  let s = receipt["summary"] as? [String: Any],
                  let id = receipt["id"] as? String, let sid = s["id"] as? String, id.utf8.elementsEqual(sid.utf8),
                  receipt["repositoryRevision"] as? String == s["repositoryRevision"] as? String else { throw RepositoryError("CORRUPT") }
            do {
                _ = try RepositoryValidation.revision(receipt["repositoryRevision"])
                _ = try RepositoryValidation.revision(receipt["localRevision"])
            } catch { throw RepositoryError("CORRUPT") }
            let sj = try RepositoryValidation.json(s)
            _ = try decodedSummary(["id":id,"json":sj,"byte_length":String(sj.utf8.count),"crc32":Integrity.crc32(sj),"mode":s["mode"] as? String ?? "","sort_time":String(sortTime(s))])
        }
        return result
    }
    private func copyDatabase(from source: OpaquePointer, to destination: OpaquePointer) throws {
        guard let b = sqlite3_backup_init(destination, "main", source, "main") else {
            try check(sqlite3_errcode(destination), handle: destination); throw RepositoryError("IO_ERROR")
        }
        let step = sqlite3_backup_step(b, -1)
        let finish = sqlite3_backup_finish(b) // Exactly once, including BUSY and failed copies.
        if step != SQLITE_DONE { try check(step, handle: destination); throw RepositoryError("IO_ERROR") }
        try check(finish, handle: destination)
    }
    private func validateAll() throws {
        try schemaCheck(); try physicalCheck()
        guard try rows("SELECT id FROM project_bodies EXCEPT SELECT id FROM project_summaries").isEmpty,
              try rows("SELECT id FROM project_summaries EXCEPT SELECT id FROM project_bodies").isEmpty,
              try rows("SELECT id FROM personal_sync LIMIT 1").isEmpty else { throw RepositoryError("CORRUPT") }
        try scan("SELECT * FROM project_bodies") { r in
            try validateBody(r)
            var generated = try summary(project(r["json"]!), revision: r["repository_revision"]!, collaboration: r["collaboration_json"])
            guard let stored = try rows("SELECT * FROM project_summaries WHERE id=?", [r["id"]]).first else { throw RepositoryError("CORRUPT") }
            let decoded = try decodedSummary(stored)
            // Backups created before this optional projection remain readable.
            if decoded["sharing"] == nil { generated.removeValue(forKey: "sharing") }
            guard try RepositoryValidation.json(decoded) == RepositoryValidation.json(generated) else { throw RepositoryError("CORRUPT") }
        }
        try scan("SELECT * FROM project_previous") { try validateBody($0) }
        try scan("SELECT * FROM operation_receipts") { r in
            _ = try validateReceipt(r)
        }
        try scan("SELECT source_key FROM migration_items") { r in
            guard let id = r["source_key"] else { throw RepositoryError("CORRUPT") }
            if id == maintenanceID { _ = try maintenanceState() }
            else if try migrationEntry(id) == nil { throw RepositoryError("CORRUPT") }
        }
    }
    private func backup() throws {
        guard let source = db else { throw RepositoryError("IO_ERROR") }
        let fm = FileManager.default
        try directory(recoveryURL.deletingLastPathComponent())
        let temp = recoveryURL.deletingLastPathComponent().appendingPathComponent("backup-\(UUID().uuidString).sqlite")
        defer { try? fm.removeItem(at: temp) }
        let candidate = ProjectRepository(databaseURL: temp, protectedDataAvailable: protectedDataAvailable)
        // candidate is private and accessed here on the owning serial queue, never shared.
        try candidate.connection()
        defer { candidate.closeConnection() }
        try copyDatabase(from: source, to: candidate.db!)
        try candidate.validateAll()
        candidate.closeConnection()
        try protect(temp)
        Self.lifecycle.lock(); defer { Self.lifecycle.unlock() }
        if fm.fileExists(atPath: recoveryURL.path) {
            _ = try fm.replaceItemAt(recoveryURL, withItemAt: temp)
        } else { try fm.moveItem(at: temp, to: recoveryURL) }
        try protect(recoveryURL)
    }

    /// Fixed recovery target; the owning queue closes/restores/reopens atomically.
    /// In-process open counts enforce that other instances have closed first.
    /// The damaged original is retained as a sibling quarantine file, never erased.
    public func restoreRecoveryBackup() throws {
        try queue.sync {
            StorageMaintenance.lock.lock(); defer { StorageMaintenance.lock.unlock() }
            do { try restoreRecoveryBackupLocked(); try connection() } catch { throw classified(error) }
        }
    }
    private func restoreRecoveryBackupLocked() throws {
            do {
                closeConnection()
                Self.lifecycle.lock()
                let busy = Self.openCounts[url.path, default: 0] != 0
                Self.lifecycle.unlock()
                guard !busy else { throw RepositoryError("BUSY") }
                let fm = FileManager.default
                guard fm.fileExists(atPath: recoveryURL.path) else { throw RepositoryError("NOT_FOUND") }
                let candidateURL = url.deletingLastPathComponent().appendingPathComponent("restore-\(UUID().uuidString).sqlite")
                defer { try? fm.removeItem(at: candidateURL) }
                let source = ProjectRepository(databaseURL: recoveryURL, protectedDataAvailable: protectedDataAvailable)
                let candidate = ProjectRepository(databaseURL: candidateURL, protectedDataAvailable: protectedDataAvailable)
                try source.connection(); defer { source.closeConnection() }
                try source.validateAll()
                try candidate.connection(); defer { candidate.closeConnection() }
                try copyDatabase(from: source.db!, to: candidate.db!)
                try candidate.validateAll()
                source.closeConnection(); candidate.closeConnection()
                Self.lifecycle.lock(); defer { Self.lifecycle.unlock() }
                guard Self.openCounts[url.path, default: 0] == 0 else { throw RepositoryError("BUSY") }
                // A leftover hot rollback journal must never be applied to the restored DB.
                // Preserve it alongside the original before publishing the replacement.
                let quarantine = "repository.quarantine-\(UUID().uuidString).sqlite"
                var movedSidecars: [(URL, URL)] = []
                var published = false
                do {
                    try protect(candidateURL)
                    for suffix in ["-journal", "-wal", "-shm"] {
                        let sidecar = URL(fileURLWithPath: url.path + suffix)
                        let saved = url.deletingLastPathComponent().appendingPathComponent(quarantine + suffix)
                        if fm.fileExists(atPath: sidecar.path) {
                            try fm.moveItem(at: sidecar, to: saved)
                            movedSidecars.append((sidecar, saved))
                        }
                    }
                    if fm.fileExists(atPath: url.path) {
                        _ = try fm.replaceItemAt(url, withItemAt: candidateURL, backupItemName: quarantine, options: [.withoutDeletingBackupItem])
                    } else { try fm.moveItem(at: candidateURL, to: url) }
                    published = true
                    try protect(url)
                } catch {
                    if !published {
                        for (original, saved) in movedSidecars.reversed() {
                            if fm.fileExists(atPath: saved.path), !fm.fileExists(atPath: original.path) { try? fm.moveItem(at: saved, to: original) }
                        }
                    }
                    throw error
                }
            } catch { throw classified(error) }
    }
}
