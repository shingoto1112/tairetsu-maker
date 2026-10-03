import Foundation
import SQLite3

/// One connection per instance, always accessed on its own serial queue.
/// The bridge exposes only execute's eight operations, never paths or SQL.
public final class ProjectRepository {
    private let queue = DispatchQueue(label: "jp.tairetsu.repository", qos: .userInitiated)
    private let url: URL
    private let protectedDataAvailable: () -> Bool
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

    public init(databaseURL: URL, protectedDataAvailable: @escaping () -> Bool = { true }) {
        url = databaseURL.standardizedFileURL
        self.protectedDataAvailable = protectedDataAvailable
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
                  let size = attrs[.size] as? NSNumber, size.int64Value >= 100 else { throw RepositoryError("CORRUPT") }
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
            if let version = initialVersion.flatMap(Int.init), version > 1 { throw RepositoryError("UNSUPPORTED_SCHEMA") }
            if existed && initialVersion == "0" { throw RepositoryError("CORRUPT") }
            guard try rows("PRAGMA journal_mode=DELETE").first?["journal_mode"] == "delete" else { throw RepositoryError("BUSY") }
            try run("PRAGMA synchronous=EXTRA")
            try run("PRAGMA foreign_keys=ON")
            try run("PRAGMA fullfsync=ON")
            try run("PRAGMA trusted_schema=OFF")
            try run("PRAGMA temp_store=MEMORY")
            guard try rows("PRAGMA synchronous").first?["synchronous"] == "3",
                  try rows("PRAGMA foreign_keys").first?["foreign_keys"] == "1" else { throw RepositoryError("IO_ERROR") }
            // Migration dispatcher: only 0 -> 1 exists. Later versions must add explicit migrations.
            try transaction {
                let version = try rows("PRAGMA user_version").first?["user_version"]
                if version == "0" {
                    try createSchema()
                    try run("PRAGMA application_id=\(Self.applicationID)")
                    try run("PRAGMA user_version=1")
                } else if version != "1" { throw RepositoryError("UNSUPPORTED_SCHEMA") }
                try schemaCheck()
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

    private func schemaCheck() throws {
        guard try rows("PRAGMA application_id").first?["application_id"] == Self.applicationID,
              try rows("PRAGMA user_version").first?["user_version"] == "1" else { throw RepositoryError("CORRUPT") }
        let expected: [String: Set<String>] = [
            "project_bodies": ["id","json","byte_length","crc32","repository_revision","local_revision","schema_version","sync_json"],
            "project_previous": ["id","json","byte_length","crc32","repository_revision","local_revision","schema_version","sync_json"],
            "project_summaries": ["id","json","byte_length","crc32","sort_time","mode"],
            "operation_receipts": ["operation_id","signature","kind","result_json","byte_length","crc32"],
            "personal_sync": ["id","state_json"], "migration_items": ["source_key","state_json"]
        ]
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
    private func summary(_ p: [String: Any], revision: String) throws -> [String: Any] {
        var result: [String: Any] = [
            "id": try RepositoryValidation.id(p["id"]), "title": p["title"] as? String ?? "",
            "mode": p["mode"] as? String ?? "stage", "createdAt": p["createdAt"] ?? p["updatedAt"] ?? "",
            "updatedAt": p["updatedAt"] ?? "", "memberCount": (p["members"] as? [Any])?.count ?? 0,
            "sceneCount": (p["frames"] as? [Any])?.count ?? 0, "repositoryRevision": revision, "syncStatus": "local"
        ]
        if let opened = p["lastOpenedAt"] { result["lastOpenedAt"] = opened }
        if let a = p["audio"] as? [String: Any] { result["audioId"] = try RepositoryValidation.id(a["id"]) }
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
        return s
    }
    private func save(_ id: String, json: String, revision: String, local: String) throws -> [String: Any] {
        let s = try summary(project(json), revision: revision)
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
    /// Request/response each contain ONE JSON string, no base64 or JS body object.
    public func execute(_ method: String, requestJSON: String = "{}") throws -> String {
        try queue.sync {
            do {
                let input = try RepositoryValidation.object(requestJSON)
                guard ["initialize","listSummaries","readProject","commitProject","touchOpened","renameProject","removeProject","createRecoveryBackup"].contains(method) else {
                    throw RepositoryError("INVALID_ARGUMENT")
                }
                try connection()
                switch method {
                case "initialize": return try RepositoryValidation.json(["status":"ready", "schemaVersion":1, "errors":[String]()] as [String: Any])
                case "readProject":
                    let id = try RepositoryValidation.id(input["id"])
                    guard let r = try body(id) else { return "null" }
                    return try RepositoryValidation.json(["json":r["json"]!,"repositoryRevision":r["repository_revision"]!,"localRevision":r["local_revision"]!,"sync":NSNull()] as [String: Any])
                case "listSummaries": return try list(input)
                case "touchOpened": return try touch(input)
                case "createRecoveryBackup": try backup(); return "{\"created\":true}"
                default: return try mutate(method, input)
                }
            } catch {
                if poisoned { closeConnection(); poisoned = false }
                throw classified(error)
            }
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
            return try RepositoryValidation.json(save(id, json: RepositoryValidation.json(p), revision: RepositoryValidation.increment(r["repository_revision"]!), local: r["local_revision"]!))
        }
    }
    private func mutate(_ method: String, _ input: [String: Any]) throws -> String {
        let id = try RepositoryValidation.id(input["id"])
        let operation = try RepositoryValidation.id(input["operationId"])
        let expected: String?
        if method == "commitProject", input["expectedRepositoryRevision"] is NSNull { expected = nil }
        else { expected = try RepositoryValidation.revision(input["expectedRepositoryRevision"]) }
        let local = method == "removeProject" ? nil : try RepositoryValidation.revision(input["localRevision"])
        if method == "commitProject" {
            guard let json = input["json"] as? String,
                  let pid = try project(json)["id"] as? String, pid.utf8.elementsEqual(id.utf8) else { throw RepositoryError("CORRUPT") }
        }
        if method == "renameProject" {
            guard let title = input["title"] as? String, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  let at = input["updatedAt"] as? String, RepositoryValidation.time(at) != nil else { throw RepositoryError("INVALID_ARGUMENT") }
        }
        let signature = Integrity.sha256(try RepositoryValidation.json(["kind":method,"request":input] as [String: Any]))
        return try transaction {
            if let previous = try rows("SELECT * FROM operation_receipts WHERE operation_id=?", [operation]).first {
                let result = try validateReceipt(previous)
                guard previous["signature"] == signature, previous["kind"] == method else { throw RepositoryError("CONFLICT") }
                return result
            }
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
                let revision = current.map { RepositoryValidation.increment($0["repository_revision"]!) } ?? "1"
                let s = try save(id, json: json, revision: revision, local: local!)
                result = try RepositoryValidation.json(["id":id,"operationId":operation,"repositoryRevision":revision,"localRevision":local!,"summary":s] as [String: Any])
            }
            try run("INSERT INTO operation_receipts VALUES(?,?,?,?,?,?)", [operation,signature,method,result,String(result.utf8.count),Integrity.crc32(result)])
            try fault?("afterReceipt")
            return result
        }
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
            let generated = try summary(project(r["json"]!), revision: r["repository_revision"]!)
            guard let stored = try rows("SELECT * FROM project_summaries WHERE id=?", [r["id"]]).first,
                  try RepositoryValidation.json(decodedSummary(stored)) == RepositoryValidation.json(generated) else { throw RepositoryError("CORRUPT") }
        }
        try scan("SELECT * FROM project_previous") { try validateBody($0) }
        try scan("SELECT * FROM operation_receipts") { r in
            _ = try validateReceipt(r)
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

    /// Native recovery only, deliberately NOT bridged. Caller must stop writers and close
    /// all other instances first. In-process open counts enforce that precondition.
    /// The damaged original is retained as a sibling quarantine file, never erased.
    public func restoreRecoveryBackup() throws {
        try queue.sync {
            do {
                closeConnection()
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
}
