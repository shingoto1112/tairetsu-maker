import Foundation

/// Shared across repository/audio bridge workers. Recursive only for the GC's
/// internal AudioStore calls; never acquire this before hopping to another queue.
public enum StorageMaintenance {
    public static let lock = NSRecursiveLock()
}

public struct StoredAudioMeta: Codable, Equatable {
    public let id: String
    public let name: String
    public let type: String
    public let size: Int
    public let duration: Double?
    public init(id: String, name: String, type: String, size: Int, duration: Double? = nil) {
        self.id = id; self.name = name; self.type = type; self.size = size; self.duration = duration
    }
}

/// Owned by the audio bridge's serial worker. No caller-supplied paths cross that bridge.
/// Files are immutable; publish the catalog only after bytes have been verified and renamed.
public final class AudioStore {
    public static let maximumSize = 200 * 1024 * 1024
    public static let chunkSize = 192 * 1024
    private struct Record: Codable { let key: String; let ext: String; let meta: StoredAudioMeta; var pending: Bool? }
    private struct Upload { let meta: StoredAudioMeta; let url: URL; var written: Int }
    private let root: URL
    private let legacy: URL
    private let fm = FileManager.default
    private var uploads: [String: Upload] = [:]
    // File names (not paths) of in-progress uploads, guarded by StorageMaintenance.lock.
    // Paths are not comparable: /var/... and /private/var/... name the same directory.
    private static var activeUploadNames: Set<String> = []
    var fault: ((String) throws -> Void)?

    public init(directory: URL, legacyDirectory: URL) {
        root = directory.standardizedFileURL; legacy = legacyDirectory.standardizedFileURL
    }
    public static func defaultStore() throws -> AudioStore {
        guard let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
            throw RepositoryError("ACCESS_DENIED")
        }
        return AudioStore(directory: try ProjectRepository.defaultDatabaseURL().deletingLastPathComponent()
            .appendingPathComponent("audio", isDirectory: true), legacyDirectory: documents.appendingPathComponent("audio", isDirectory: true))
    }
    private func protect(_ url: URL) throws {
        #if os(iOS)
        try fm.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
        #endif
        // Audio is irreplaceable: keep the OS default (included in iCloud backup).
    }
    private func prepare() throws {
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        try protect(root)
    }
    private func validate(_ meta: StoredAudioMeta) throws {
        guard !meta.id.isEmpty, meta.id.utf8.count <= 512, !meta.id.contains("\0"),
              !meta.name.isEmpty, meta.name.utf8.count <= 4096,
              meta.size > 0, meta.size <= Self.maximumSize,
              meta.duration.map({ $0.isFinite && $0 >= 0 }) ?? true else { throw RepositoryError("INVALID_ARGUMENT") }
    }
    private static let formats: [String: [String]] = [
        "mp3": ["audio/mpeg", "audio/mp3"], "m4a": ["audio/mp4", "audio/x-m4a", "audio/m4a"],
        "wav": ["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"],
        "aac": ["audio/aac", "audio/x-aac"], "aif": ["audio/aiff", "audio/x-aiff"],
        "aiff": ["audio/aiff", "audio/x-aiff"], "caf": ["audio/x-caf", "audio/caf"]
    ]
    public static func fileExtension(name: String, type: String) throws -> String {
        let ext = (name as NSString).pathExtension.lowercased()
        let mime = type.lowercased().split(separator: ";").first.map(String.init) ?? ""
        if let types = formats[ext] {
            guard mime.isEmpty || mime == "application/octet-stream" || types.contains(mime) else { throw RepositoryError("INVALID_ARGUMENT") }
            // Capacitor's media list contains aiff, not aif.
            return ext == "aif" ? "aiff" : ext
        }
        // ZIP metadata from old versions can have no extension, but a known MIME.
        guard ext.isEmpty, let inferred = formats.keys.sorted().first(where: { formats[$0]!.contains(mime) }) else {
            throw RepositoryError("INVALID_ARGUMENT")
        }
        return inferred == "aif" ? "aiff" : inferred
    }
    private func file(_ record: Record) throws -> URL {
        guard let uuid = UUID(uuidString: record.key), uuid.uuidString.lowercased() == record.key,
              Self.formats[record.ext] != nil else { throw RepositoryError("CORRUPT") }
        return root.appendingPathComponent(record.key).appendingPathExtension(record.ext)
    }
    private func size(_ url: URL) throws -> Int {
        let attrs = try fm.attributesOfItem(atPath: url.path)
        guard attrs[.type] as? FileAttributeType == .typeRegular, let value = attrs[.size] as? NSNumber else { throw RepositoryError("CORRUPT") }
        return value.intValue
    }
    private func catalog() throws -> [String: Record] {
        let url = root.appendingPathComponent("index.json")
        if !fm.fileExists(atPath: url.path) { return [:] }
        return try JSONDecoder().decode([String: Record].self, from: Data(contentsOf: url))
    }
    public func resolve(id: String) throws -> URL? {
        StorageMaintenance.lock.lock(); defer { StorageMaintenance.lock.unlock() }
        guard let record = try catalog()[id] else { return nil }
        try validate(record.meta)
        guard record.meta.id == id else { throw RepositoryError("CORRUPT") }
        let url = try file(record)
        guard try size(url) == record.meta.size else { throw RepositoryError("CORRUPT") }
        return url
    }
    /// Metadata only. A bad individual record must not hide other local music.
    public func listMetadata() throws -> [StoredAudioMeta] {
        StorageMaintenance.lock.lock(); defer { StorageMaintenance.lock.unlock() }
        let records = try catalog()
        return records.compactMap { id, record in
            do {
                try validate(record.meta)
                guard record.meta.id == id, try size(file(record)) == record.meta.size else { return nil }
                return record.meta
            } catch { return nil }
        }
    }
    public func importFile(_ source: URL, meta: StoredAudioMeta) throws -> StoredAudioMeta {
        StorageMaintenance.lock.lock(); defer { StorageMaintenance.lock.unlock() }
        try validate(meta)
        let ext = try Self.fileExtension(name: meta.name, type: meta.type)
        if let existing = try catalog()[meta.id] {
            guard existing.meta == meta, try resolve(id: meta.id) != nil else { throw RepositoryError("CONFLICT") }
            return existing.meta
        }
        guard try size(source) == meta.size else { throw RepositoryError("CORRUPT") }
        try prepare()
        let key = UUID().uuidString.lowercased()
        let staged = root.appendingPathComponent(key).appendingPathExtension("partial")
        defer { try? fm.removeItem(at: staged) }
        try fm.copyItem(at: source, to: staged)
        try protect(staged)
        try fault?("copied")
        guard try size(staged) == meta.size, try equalFiles(source, staged) else { throw RepositoryError("CORRUPT") }
        let handle = try FileHandle(forWritingTo: staged)
        defer { try? handle.close() }
        try handle.synchronize()
        let record = Record(key: key, ext: ext, meta: meta, pending: true)
        try fm.moveItem(at: staged, to: file(record)) // Same-directory atomic rename.
        try fault?("placed")
        var records = try catalog()
        records[meta.id] = record
        // Foundation's atomic write uses a sibling temporary file + rename. Never remove old index first.
        let index = root.appendingPathComponent("index.json")
        let attributes: [FileAttributeKey: Any]
        #if os(iOS)
        attributes = [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        #else
        attributes = [:]
        #endif
        let pending = root.appendingPathComponent(UUID().uuidString).appendingPathExtension("index-partial")
        defer { try? fm.removeItem(at: pending) }
        guard fm.createFile(atPath: pending.path, contents: try JSONEncoder().encode(records), attributes: attributes) else { throw RepositoryError("IO_ERROR") }
        let indexHandle = try FileHandle(forWritingTo: pending)
        defer { try? indexHandle.close() }
        try indexHandle.synchronize(); try indexHandle.close()
        if fm.fileExists(atPath: index.path) { _ = try fm.replaceItemAt(index, withItemAt: pending) }
        else { try fm.moveItem(at: pending, to: index) }
        return meta
    }
    private func equalFiles(_ a: URL, _ b: URL) throws -> Bool {
        let left = try FileHandle(forReadingFrom: a)
        defer { try? left.close() }
        let right = try FileHandle(forReadingFrom: b)
        defer { try? right.close() }
        while true {
            let x = try left.read(upToCount: Self.chunkSize) ?? Data()
            let y = try right.read(upToCount: Self.chunkSize) ?? Data()
            if x != y { return false }
            if x.isEmpty { return true }
        }
    }
    public func beginUpload(meta: StoredAudioMeta) throws -> String {
        StorageMaintenance.lock.lock(); defer { StorageMaintenance.lock.unlock() }
        try validate(meta); _ = try Self.fileExtension(name: meta.name, type: meta.type)
        guard uploads.count < 4 else { throw RepositoryError("BUSY") }
        try prepare()
        let token = UUID().uuidString.lowercased()
        let url = root.appendingPathComponent(token).appendingPathExtension("upload")
        guard fm.createFile(atPath: url.path, contents: nil) else { throw RepositoryError("IO_ERROR") }
        try protect(url)
        uploads[token] = Upload(meta: meta, url: url, written: 0)
        Self.activeUploadNames.insert(url.lastPathComponent)
        return token
    }
    public func appendUpload(token: String, offset: Int, base64: String) throws {
        StorageMaintenance.lock.lock(); defer { StorageMaintenance.lock.unlock() }
        guard var upload = uploads[token], upload.written == offset,
              base64.utf8.count <= (Self.chunkSize / 3 * 4),
              let data = Data(base64Encoded: base64), !data.isEmpty,
              upload.written + data.count <= upload.meta.size else { throw RepositoryError("INVALID_ARGUMENT") }
        let handle = try FileHandle(forWritingTo: upload.url)
        defer { try? handle.close() }
        try handle.seekToEnd(); try handle.write(contentsOf: data)
        upload.written += data.count; uploads[token] = upload
    }
    public func finishUpload(token: String) throws -> StoredAudioMeta {
        StorageMaintenance.lock.lock(); defer { StorageMaintenance.lock.unlock() }
        guard let upload = uploads[token], upload.written == upload.meta.size else { throw RepositoryError("CORRUPT") }
        defer { abortUpload(token: token) }
        return try importFile(upload.url, meta: upload.meta)
    }
    public func abortUpload(token: String) {
        StorageMaintenance.lock.lock(); defer { StorageMaintenance.lock.unlock() }
        if let upload = uploads.removeValue(forKey: token) { Self.activeUploadNames.remove(upload.url.lastPathComponent); try? fm.removeItem(at: upload.url) }
    }
    /// Old IDs are used as paths only after a strict allowlist (the new store never does this).
    public static func safeLegacyID(_ id: String) -> Bool {
        !id.isEmpty && id.utf8.count <= 256 && id.utf8.allSatisfy { (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 45 || $0 == 95 }
    }
    public func migrateLegacy(meta: StoredAudioMeta) throws -> URL? {
        StorageMaintenance.lock.lock(); defer { StorageMaintenance.lock.unlock() }
        if let url = try resolve(id: meta.id) { return url }
        try validate(meta)
        guard Self.safeLegacyID(meta.id) else { return nil }
        let source = legacy.appendingPathComponent(meta.id).appendingPathExtension("data")
        let metadata = legacy.appendingPathComponent(meta.id).appendingPathExtension("json")
        guard fm.fileExists(atPath: source.path), fm.fileExists(atPath: metadata.path) else { return nil }
        let old = try JSONSerialization.jsonObject(with: Data(contentsOf: metadata)) as? [String: Any]
        guard let type = old?["type"] as? String else { throw RepositoryError("CORRUPT") }
        let migrated = StoredAudioMeta(id: meta.id, name: meta.name, type: type, size: meta.size, duration: meta.duration)
        if try size(source) == meta.size { // Filesystem without encoding decodes base64 before writing: raw binary.
            _ = try importFile(source, meta: migrated)
        } else {
            try prepare()
            let decoded = root.appendingPathComponent(UUID().uuidString).appendingPathExtension("decoded-partial")
            defer { try? fm.removeItem(at: decoded) }
            try decodeLegacy(source, to: decoded, expectedSize: meta.size)
            _ = try importFile(decoded, meta: migrated)
        }
        return try resolve(id: meta.id)
    }

    /// Caller verified ALL repository/previous/recovery/backup references while
    /// holding the shared maintenance barrier. Unknown catalog/files are retained.
    public func collectUnused(referenced: Set<String>) throws -> (count: Int, bytes: Int) {
        StorageMaintenance.lock.lock(); defer { StorageMaintenance.lock.unlock() }
        try prepare()
        var records = try catalog()
        // Every managed file lives directly in root, so compare by file name only.
        // Directory listings may spell the container as /private/var/... while the
        // catalog-derived URLs use /var/...; comparing full paths would treat a
        // referenced file as an orphan.
        var protectedNames = Self.activeUploadNames
        var removeNames = Set<String>()
        // Validate the complete catalog before changing anything.
        for (id, record) in Array(records) {
            try validate(record.meta)
            guard record.meta.id == id else { throw RepositoryError("CORRUPT") }
            let path = try file(record)
            if referenced.contains(id) {
                guard try size(path) == record.meta.size else { throw RepositoryError("CORRUPT") }
                protectedNames.insert(path.lastPathComponent)
                var published = record; published.pending = false; records[id] = published
            } else if record.pending == true { protectedNames.insert(path.lastPathComponent) }
            else { removeNames.insert(path.lastPathComponent); records.removeValue(forKey: id) }
        }
        // Only recognized regular managed files can be orphan garbage. Never
        // follow symlinks or recurse, and never touch Documents here.
        for path in try fm.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey]) {
            let values = try path.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
            let name = path.lastPathComponent
            guard values.isRegularFile == true, values.isSymbolicLink != true, !protectedNames.contains(name),
                  UUID(uuidString: path.deletingPathExtension().lastPathComponent) != nil,
                  Self.formats[path.pathExtension] != nil || ["partial", "upload", "index-partial", "decoded-partial"].contains(path.pathExtension) else { continue }
            removeNames.insert(name)
        }
        // A protected name always wins, even if it was also listed for removal.
        removeNames.subtract(protectedNames)
        // Publish the retained catalog atomically BEFORE unlinking, so a failed
        // removal produces an orphan retried later, never a dangling catalog ID.
        let index = root.appendingPathComponent("index.json")
        try JSONEncoder().encode(records).write(to: index, options: .atomic)
        try protect(index)
        var count = 0, bytes = 0
        for name in removeNames.sorted() {
            let target = root.appendingPathComponent(name)
            guard fm.fileExists(atPath: target.path) else { continue }
            let length = try size(target)
            try fm.removeItem(at: target); count += 1; bytes += length
        }
        return (count, bytes)
    }
    public func confirmReference(id: String) throws {
        StorageMaintenance.lock.lock(); defer { StorageMaintenance.lock.unlock() }
        var records = try catalog()
        guard var record = records[id], record.pending == true else { return }
        record.pending = false; records[id] = record
        let index = root.appendingPathComponent("index.json")
        try JSONEncoder().encode(records).write(to: index, options: .atomic)
        try protect(index)
    }
    private func decodeLegacy(_ source: URL, to target: URL, expectedSize: Int) throws {
        guard try size(source) <= ((Self.maximumSize + 2) / 3 * 4 + 1024 * 1024),
              fm.createFile(atPath: target.path, contents: nil) else { throw RepositoryError("CORRUPT") }
        try protect(target)
        let input = try FileHandle(forReadingFrom: source)
        defer { try? input.close() }
        let output = try FileHandle(forWritingTo: target)
        defer { try? output.close() }
        var pending = Data(), total = 0, padded = false
        while let bytes = try input.read(upToCount: 64 * 1024), !bytes.isEmpty {
            pending.append(contentsOf: bytes.filter { ![9, 10, 13, 32].contains($0) })
            let length = pending.count / 4 * 4
            if length == 0 { continue }
            let part = Data(pending.prefix(length))
            guard !padded, let decoded = Data(base64Encoded: part) else { throw RepositoryError("CORRUPT") }
            padded = part.contains(61)
            total += decoded.count
            guard total <= expectedSize else { throw RepositoryError("CORRUPT") }
            try output.write(contentsOf: decoded)
            pending.removeFirst(length)
        }
        guard pending.isEmpty, total == expectedSize else { throw RepositoryError("CORRUPT") }
        try output.synchronize()
    }
}
