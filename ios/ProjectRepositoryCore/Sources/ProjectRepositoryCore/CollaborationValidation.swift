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
        guard RepositoryValidation.integer(value["schemaVersion"]) == 1,
              [1, 2].contains(RepositoryValidation.integer(value["documentSchema"]) ?? -1) else { throw RepositoryError("UNSUPPORTED_SCHEMA") }
        var names = ["schemaVersion", "sharedDocumentId", "documentSchema", "generation", "base", "journal", "outbox", "serverCursor"]
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
        for (list, kind) in [(journal, "source"), (outbox, "status")] {
            var seen: Set<String> = []
            for entry in list {
                guard exact(entry, ["updateId", "bytes", kind]), RepositoryValidation.validID(entry["updateId"]),
                      let id = entry["updateId"] as? String,
                      (kind == "source" ? ["local", "remote"] : ["pending", "sent"]).contains(entry[kind] as? String ?? ""),
                      seen.insert(key(id)).inserted else { throw RepositoryError("INVALID_ARGUMENT") }
                total += try decodedSize(entry["bytes"], max: updateBytes)
                let bytes = entry["bytes"] as! String
                if let old = ids[key(id)], old != bytes { throw RepositoryError("CONFLICT") }
                ids[key(id)] = bytes
            }
        }
        guard total <= totalBytes else { throw RepositoryError("QUOTA_EXCEEDED") }
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
        let entries = Dictionary(uniqueKeysWithValues: (next["outbox"] as! [[String: Any]]).map { (key($0["updateId"] as! String), $0) })
        for old in current["outbox"] as! [[String: Any]] {
            guard let entry = entries[key(old["updateId"] as! String)], old["bytes"] as? String == entry["bytes"] as? String,
                  old["status"] as? String != "sent" || entry["status"] as? String == "sent" else { throw RepositoryError("CONFLICT") }
        }
    }
}
