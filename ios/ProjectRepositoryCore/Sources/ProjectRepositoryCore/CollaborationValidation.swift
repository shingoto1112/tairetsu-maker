import Foundation

/// Binary CRDT contents remain opaque here. The TS adapter uses the same Yjs
/// projection/extension validation as IndexedDB before entering the CAS commit.
enum CollaborationValidation {
    static let jsonBytes = 24 * 1024 * 1024
    static let baseBytes = 8 * 1024 * 1024
    static let updateBytes = 256 * 1024
    static let totalBytes = 16 * 1024 * 1024
    static let entries = 4096
    private static func exact(_ value: [String: Any], _ names: [String]) -> Bool {
        Set(value.keys) == Set(names)
    }
    private static func key(_ id: String) -> String { Data(id.utf8).base64EncodedString() }
    private static func uuid(_ value: Any?) -> Bool {
        guard let text = value as? String else { return false }
        return text.range(of: #"^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$"#, options: .regularExpression) != nil
    }
    private static func same(_ a: String?, _ b: String?) -> Bool {
        guard let a = a, let b = b else { return a == nil && b == nil }
        return a.utf8.elementsEqual(b.utf8)
    }
    private static func decodedSize(_ value: Any?, max: Int) throws -> Int {
        guard let text = value as? String else { throw RepositoryError("INVALID_ARGUMENT") }
        guard text.utf8.count <= ((max + 2) / 3) * 4 else { throw RepositoryError("QUOTA_EXCEEDED") }
        guard !text.isEmpty, let data = Data(base64Encoded: text), data.base64EncodedString() == text else {
            throw RepositoryError("INVALID_ARGUMENT")
        }
        guard data.count <= max else { throw RepositoryError("QUOTA_EXCEEDED") }
        return data.count
    }
    static func parse(_ json: String) throws -> [String: Any] {
        guard json.utf8.count <= jsonBytes else { throw RepositoryError("QUOTA_EXCEEDED") }
        let value = try RepositoryValidation.object(json)
        guard [1, 2, 3].contains(RepositoryValidation.integer(value["schemaVersion"]) ?? -1),
              [1, 2].contains(RepositoryValidation.integer(value["documentSchema"]) ?? -1) else { throw RepositoryError("UNSUPPORTED_SCHEMA") }
        var names = ["schemaVersion", "sharedDocumentId", "documentSchema", "generation", "base", "journal", "outbox", "serverCursor"]
        if let snapshot = value["knownSnapshotId"] {
            names.append("knownSnapshotId"); guard uuid(snapshot) else { throw RepositoryError("INVALID_ARGUMENT") }
        }
        if let raw = value["recoveryRequired"] {
            names.append("recoveryRequired")
            guard let flag = raw as? NSNumber, String(cString: flag.objCType) == "c", flag.boolValue else { throw RepositoryError("INVALID_ARGUMENT") }
        }
        var writer: [String: Any]?
        if RepositoryValidation.integer(value["schemaVersion"]) == 3 {
            names.append("writer")
            guard let w = value["writer"] as? [String: Any], exact(w, ["id", "allocatedThrough", "ackThrough", "reclaimedThrough", "legacySentIds"]), uuid(w["id"]),
                  let legacy = w["legacySentIds"] as? [String], legacy.count <= entries, legacy.allSatisfy({ RepositoryValidation.validID($0) }),
                  Set(legacy.map(key)).count == legacy.count, value["transportBinding"] != nil, !(value["sharedDocumentId"] is NSNull) else { throw RepositoryError("INVALID_ARGUMENT") }
            for field in ["allocatedThrough", "ackThrough", "reclaimedThrough"] {
                let seq = try RepositoryValidation.revision(w[field])
                guard !RepositoryValidation.greater(seq, "9223372036854775807") else { throw RepositoryError("INVALID_ARGUMENT") }
            }
            guard !RepositoryValidation.greater(w["reclaimedThrough"] as! String, w["ackThrough"] as! String),
                  !RepositoryValidation.greater(w["ackThrough"] as! String, w["allocatedThrough"] as! String) else { throw RepositoryError("INVALID_ARGUMENT") }
            writer = w
        }
        if let raw = value["audioBindings"] {
            guard RepositoryValidation.integer(value["schemaVersion"]) != 1 else { throw RepositoryError("INVALID_ARGUMENT") }
            names.append("audioBindings")
            guard let bindings = raw as? [[String: Any]] else { throw RepositoryError("INVALID_ARGUMENT") }
            guard bindings.count <= entries else { throw RepositoryError("QUOTA_EXCEEDED") }
            var seen: Set<Data> = []
            for binding in bindings {
                guard exact(binding, ["song", "audio"]), let song = binding["song"] as? [String: Any],
                      let audio = binding["audio"] as? [String: Any] else { throw RepositoryError("INVALID_ARGUMENT") }
                for (meta, hasID) in [(song, false), (audio, true)] {
                    var allowed = ["name", "type", "size"]
                    if meta["duration"] != nil { allowed.append("duration") }
                    if hasID { allowed.append("id") }
                    guard exact(meta, allowed), let name = meta["name"] as? String, !name.isEmpty, name.utf16.count <= 4096,
                          let type = meta["type"] as? String, !type.isEmpty, type.utf16.count <= 4096,
                          let size = RepositoryValidation.integer(meta["size"]), size > 0, size <= AudioStore.maximumSize,
                          !hasID || RepositoryValidation.validID(meta["id"]) else { throw RepositoryError("INVALID_ARGUMENT") }
                    if let rawDuration = meta["duration"] {
                        guard let duration = rawDuration as? NSNumber, String(cString: duration.objCType) != "c", duration.doubleValue.isFinite,
                              duration.doubleValue >= 0 else { throw RepositoryError("INVALID_ARGUMENT") }
                    }
                }
                let key: [Any] = [song["name"]!, song["type"]!, song["size"]!, song["duration"] ?? NSNull()]
                guard seen.insert(try JSONSerialization.data(withJSONObject: key, options: [.sortedKeys])).inserted else {
                    throw RepositoryError("INVALID_ARGUMENT")
                }
            }
        }
        if let raw = value["transportBinding"] {
            names.append("transportBinding")
            guard let binding = raw as? [String: Any], exact(binding, ["accountId", "membershipGeneration"]) else {
                throw RepositoryError("INVALID_ARGUMENT")
            }
            for name in ["accountId", "membershipGeneration"] {
                guard let uuid = binding[name] as? String,
                      uuid.range(of: #"^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$"#, options: .regularExpression) != nil else {
                    throw RepositoryError("INVALID_ARGUMENT")
                }
            }
        }
        guard exact(value, names), value["sharedDocumentId"] is NSNull || RepositoryValidation.validID(value["sharedDocumentId"]),
              let journal = value["journal"] as? [[String: Any]], let outbox = value["outbox"] as? [[String: Any]] else {
            throw RepositoryError("INVALID_ARGUMENT")
        }
        guard try RepositoryValidation.revision(value["generation"]) != "0" else { throw RepositoryError("INVALID_ARGUMENT") }
        _ = try RepositoryValidation.revision(value["serverCursor"])
        guard journal.count <= entries, outbox.count <= entries else { throw RepositoryError("QUOTA_EXCEEDED") }
        var total = try decodedSize(value["base"], max: baseBytes)
        var ids: [String: String] = [:]
        var sequences: Set<String> = []
        for (list, kind) in [(journal, "source"), (outbox, "status")] {
            var seen: Set<String> = []
            for entry in list {
                var entryNames = ["updateId", "bytes", kind]
                if writer != nil && kind == "status" && entry["writerSeq"] != nil { entryNames.append("writerSeq") }
                guard exact(entry, entryNames), RepositoryValidation.validID(entry["updateId"]),
                      let id = entry["updateId"] as? String,
                      (kind == "source" ? ["local", "remote"] : ["pending", "sent"]).contains(entry[kind] as? String ?? ""),
                      seen.insert(key(id)).inserted else { throw RepositoryError("INVALID_ARGUMENT") }
                if kind == "status", let w = writer {
                    guard !(w["legacySentIds"] as! [String]).contains(id) else { throw RepositoryError("CONFLICT") }
                    if let rawSeq = entry["writerSeq"] {
                        let seq = try RepositoryValidation.revision(rawSeq)
                        guard sequences.insert(seq).inserted, RepositoryValidation.greater(seq, w["reclaimedThrough"] as! String),
                              !RepositoryValidation.greater(seq, w["allocatedThrough"] as! String),
                              RepositoryValidation.greater(seq, w["ackThrough"] as! String) || entry["status"] as? String == "sent" else { throw RepositoryError("INVALID_ARGUMENT") }
                    } else if entry["status"] as? String == "sent" { throw RepositoryError("INVALID_ARGUMENT") }
                }
                total += try decodedSize(entry["bytes"], max: updateBytes)
                let bytes = entry["bytes"] as! String
                if let old = ids[key(id)], old != bytes { throw RepositoryError("CONFLICT") }
                ids[key(id)] = bytes
            }
        }
        guard total <= totalBytes else { throw RepositoryError("QUOTA_EXCEEDED") }
        if let w = writer {
            let allocated = UInt64(w["allocatedThrough"] as! String)!, reclaimed = UInt64(w["reclaimedThrough"] as! String)!
            guard allocated - reclaimed == UInt64(sequences.count) else { throw RepositoryError("INVALID_ARGUMENT") }
        }
        let pending = Dictionary(uniqueKeysWithValues: outbox.map { (key($0["updateId"] as! String), $0["bytes"] as! String) })
        for entry in journal where entry["source"] as? String == "local" {
            guard pending[key(entry["updateId"] as! String)] == entry["bytes"] as? String else { throw RepositoryError("INVALID_ARGUMENT") }
        }
        return value
    }
    static func transition(_ currentJSON: String?, _ nextJSON: String?) throws {
        guard let currentJSON = currentJSON else { return }
        let current = try parse(currentJSON)
        guard let nextJSON = nextJSON else { throw RepositoryError("CONFLICT") }
        let next = try parse(nextJSON)
        if (RepositoryValidation.integer(current["schemaVersion"]) ?? 0) > (RepositoryValidation.integer(next["schemaVersion"]) ?? 0) {
            throw RepositoryError("CONFLICT")
        }
        let oldBinding = current["transportBinding"] as? [String: Any]
        let newBinding = next["transportBinding"] as? [String: Any]
        guard same(current["generation"] as? String, next["generation"] as? String),
              RepositoryValidation.integer(current["documentSchema"]) == RepositoryValidation.integer(next["documentSchema"]),
              !RepositoryValidation.greater(current["serverCursor"] as! String, next["serverCursor"] as! String),
              current["sharedDocumentId"] is NSNull || same(current["sharedDocumentId"] as? String, next["sharedDocumentId"] as? String) else {
            throw RepositoryError("CONFLICT")
        }
        if oldBinding != nil || !(current["sharedDocumentId"] is NSNull) {
            guard same(oldBinding?["accountId"] as? String, newBinding?["accountId"] as? String),
                  same(oldBinding?["membershipGeneration"] as? String, newBinding?["membershipGeneration"] as? String) else { throw RepositoryError("CONFLICT") }
        }
        if current["knownSnapshotId"] != nil && next["knownSnapshotId"] == nil || current["recoveryRequired"] != nil && next["recoveryRequired"] == nil { throw RepositoryError("CONFLICT") }
        let oldWriter = current["writer"] as? [String: Any], newWriter = next["writer"] as? [String: Any]
        if let old = oldWriter {
            guard let new = newWriter, same(old["id"] as? String, new["id"] as? String),
                  (old["legacySentIds"] as! [String]).allSatisfy({ (new["legacySentIds"] as! [String]).contains($0) }) else { throw RepositoryError("CONFLICT") }
            for field in ["allocatedThrough", "ackThrough", "reclaimedThrough"] {
                guard !RepositoryValidation.greater(old[field] as! String, new[field] as! String) else { throw RepositoryError("CONFLICT") }
            }
            let lower = UInt64(old["ackThrough"] as! String)!, upper = UInt64(new["ackThrough"] as! String)!
            let covered = (current["outbox"] as! [[String: Any]]).filter { entry in
                guard let seq = entry["writerSeq"] as? String else { return false }
                return RepositoryValidation.greater(seq, old["ackThrough"] as! String) && !RepositoryValidation.greater(seq, new["ackThrough"] as! String)
            }
            guard upper - lower == UInt64(covered.count) else { throw RepositoryError("CONFLICT") }
        }
        let entries = Dictionary(uniqueKeysWithValues: (next["outbox"] as! [[String: Any]]).map { (key($0["updateId"] as! String), $0) })
        for old in current["outbox"] as! [[String: Any]] {
            if entries[key(old["updateId"] as! String)] == nil, let w = newWriter {
                if let seq = old["writerSeq"] as? String, !RepositoryValidation.greater(seq, w["reclaimedThrough"] as! String) { continue }
                if old["status"] as? String == "sent", (w["legacySentIds"] as! [String]).contains(old["updateId"] as! String) { continue }
            }
            guard let entry = entries[key(old["updateId"] as! String)], old["bytes"] as? String == entry["bytes"] as? String,
                  old["writerSeq"] == nil || old["writerSeq"] as? String == entry["writerSeq"] as? String,
                  old["status"] as? String != "sent" || entry["status"] as? String == "sent" else { throw RepositoryError("CONFLICT") }
        }
    }
}
