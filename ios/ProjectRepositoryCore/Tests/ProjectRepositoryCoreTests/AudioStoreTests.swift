import Foundation
import XCTest
@testable import ProjectRepositoryCore

final class AudioStoreTests: XCTestCase {
    private var directory: URL!
    private var root: URL { directory.appendingPathComponent("v2/audio", isDirectory: true) }
    private var legacy: URL { directory.appendingPathComponent("Documents/audio", isDirectory: true) }
    private var source: URL { directory.appendingPathComponent("source.mp3") }
    private var store: AudioStore!
    private let bytes = Data([UInt8(0), 1, 2, 127, 255])
    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: legacy, withIntermediateDirectories: true)
        try bytes.write(to: source)
        store = AudioStore(directory: root, legacyDirectory: legacy)
    }
    override func tearDownWithError() throws { store = nil; try FileManager.default.removeItem(at: directory) }
    private func meta(_ id: String = "audio-old", name: String = "song.mp3", size: Int = 5) -> StoredAudioMeta {
        StoredAudioMeta(id: id, name: name, type: "audio/mpeg", size: size, duration: 3)
    }
    private func resolved(_ id: String) throws -> URL {
        let value = try store.resolve(id: id)
        return try XCTUnwrap(value)
    }
    private func writeLegacy(_ data: Data, id: String = "audio-old") throws {
        try data.write(to: legacy.appendingPathComponent(id).appendingPathExtension("data"))
        let object: [String: Any] = ["type": "audio/mpeg"]
        try JSONSerialization.data(withJSONObject: object).write(to: legacy.appendingPathComponent(id).appendingPathExtension("json"))
    }
    func testImportCopyAtomicPublicationAndReopen() throws {
        XCTAssertEqual(try store.importFile(source, meta: meta()), meta())
        let url = try resolved("audio-old")
        XCTAssertEqual(try Data(contentsOf: url), bytes)
        XCTAssertEqual(try Data(contentsOf: source), bytes)
        XCTAssertNotEqual(url.lastPathComponent, "audio-old.mp3")
        XCTAssertEqual(url.pathExtension, "mp3")
        store = AudioStore(directory: root, legacyDirectory: legacy)
        XCTAssertEqual(try resolved("audio-old"), url)
        XCTAssertEqual(try store.importFile(source, meta: meta()), meta())
    }
    func testCatalogReplacementKeepsOtherAudio() throws {
        _ = try store.importFile(source, meta: meta("first"))
        _ = try store.importFile(source, meta: meta("second"))
        store = AudioStore(directory: root, legacyDirectory: legacy)
        XCTAssertEqual(try Data(contentsOf: resolved("first")), bytes)
        XCTAssertEqual(try Data(contentsOf: resolved("second")), bytes)
    }
    func testSizeMismatchDoesNotPublish() throws {
        XCTAssertThrowsError(try store.importFile(source, meta: meta(size: 6)))
        XCTAssertNil(try store.resolve(id: "audio-old"))
        XCTAssertEqual(try Data(contentsOf: source), bytes)
    }
    func testCopyContentAndSizeAreVerified() throws {
        store.fault = { [self] phase in
            if phase == "copied" {
                let files = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
                let file = files.first { $0.pathExtension == "partial" }
                let staged = try XCTUnwrap(file)
                try Data([UInt8(9), 9, 9, 9, 9]).write(to: staged)
            }
        }
        XCTAssertThrowsError(try store.importFile(source, meta: meta()))
        XCTAssertNil(try store.resolve(id: "audio-old"))
    }
    func testRejectsExtensionsMIMEMismatchEmptyAndOversize() throws {
        XCTAssertThrowsError(try store.importFile(source, meta: meta(name: "evil.exe")))
        XCTAssertThrowsError(try store.importFile(source, meta: meta(name: "song.wav")))
        XCTAssertThrowsError(try store.importFile(source, meta: meta(size: 0)))
        XCTAssertThrowsError(try store.importFile(source, meta: meta(size: AudioStore.maximumSize + 1)))
        XCTAssertEqual(try AudioStore.fileExtension(name: "SONG.AIF", type: "audio/x-aiff"), "aiff")
        XCTAssertEqual(try AudioStore.fileExtension(name: "audio", type: "audio/mp4"), "m4a")
    }
    func testIDNeverFormsNewStorePath() throws {
        let unsafe = "../../escape/日本語"
        _ = try store.importFile(source, meta: meta(unsafe))
        let url = try resolved(unsafe)
        XCTAssertEqual(url.deletingLastPathComponent(), root)
        XCTAssertFalse(url.lastPathComponent.contains("escape"))
        XCTAssertFalse(AudioStore.safeLegacyID(unsafe))
        XCTAssertTrue(AudioStore.safeLegacyID("audio-123_abc"))
        XCTAssertNil(try store.resolve(id: "missing"))
    }
    func testCatalogKeyCannotEscapeDirectory() throws {
        _ = try store.importFile(source, meta: meta())
        let index = root.appendingPathComponent("index.json")
        let decoded = try JSONSerialization.jsonObject(with: Data(contentsOf: index))
        var object = try XCTUnwrap(decoded as? [String: Any])
        var record = try XCTUnwrap(object["audio-old"] as? [String: Any])
        record["key"] = "../../escape"; object["audio-old"] = record
        try JSONSerialization.data(withJSONObject: object).write(to: index)
        XCTAssertThrowsError(try store.resolve(id: "audio-old"))
    }
    func testLegacyBinaryCopiedAndRetained() throws {
        try writeLegacy(bytes)
        let value = try store.migrateLegacy(meta: meta())
        let url = try XCTUnwrap(value)
        XCTAssertEqual(try Data(contentsOf: url), bytes)
        XCTAssertEqual(try Data(contentsOf: legacy.appendingPathComponent("audio-old.data")), bytes)
        XCTAssertTrue(FileManager.default.fileExists(atPath: legacy.appendingPathComponent("audio-old.json").path))
        XCTAssertEqual(try store.migrateLegacy(meta: meta()), url)
    }
    func testLegacyBase64TextDecodedAndRetained() throws {
        let text = Data(bytes.base64EncodedString().utf8)
        try writeLegacy(text)
        let value = try store.migrateLegacy(meta: meta())
        let url = try XCTUnwrap(value)
        XCTAssertEqual(try Data(contentsOf: url), bytes)
        XCTAssertEqual(try Data(contentsOf: legacy.appendingPathComponent("audio-old.data")), text)
    }
    func testLegacyBase64AcrossChunkBoundaries() throws {
        let payload = Data(repeating: 255, count: 200_003)
        let text = payload.base64EncodedString()
        try writeLegacy(Data(("\n" + text + "\n").utf8))
        let value = try store.migrateLegacy(meta: meta(size: payload.count))
        let url = try XCTUnwrap(value)
        XCTAssertEqual(try Data(contentsOf: url), payload)
    }
    func testLegacyFailureAndRetryKeepsOldReference() throws {
        try writeLegacy(bytes)
        store.fault = { phase in if phase == "placed" { throw RepositoryError("NO_SPACE") } }
        XCTAssertThrowsError(try store.migrateLegacy(meta: meta()))
        XCTAssertNil(try store.resolve(id: "audio-old"))
        XCTAssertEqual(try Data(contentsOf: legacy.appendingPathComponent("audio-old.data")), bytes)
        store = AudioStore(directory: root, legacyDirectory: legacy)
        let value = try store.migrateLegacy(meta: meta())
        let url = try XCTUnwrap(value)
        XCTAssertEqual(try Data(contentsOf: url), bytes)
    }
    func testInvalidBase64AndMissingLegacyDoNotPublish() throws {
        XCTAssertNil(try store.migrateLegacy(meta: meta()))
        try writeLegacy(Data("invalid***base64".utf8))
        XCTAssertThrowsError(try store.migrateLegacy(meta: meta()))
        XCTAssertNil(try store.resolve(id: "audio-old"))
        XCTAssertNil(try store.migrateLegacy(meta: meta("../escape")))
    }
    func testUploadOffsetsCompletionAndAbort() throws {
        let token = try store.beginUpload(meta: meta())
        XCTAssertThrowsError(try store.appendUpload(token: token, offset: 1, base64: bytes.base64EncodedString()))
        XCTAssertThrowsError(try store.finishUpload(token: token))
        try store.appendUpload(token: token, offset: 0, base64: bytes.base64EncodedString())
        XCTAssertEqual(try store.finishUpload(token: token), meta())
        XCTAssertEqual(try Data(contentsOf: resolved("audio-old")), bytes)
        let cancelled = try store.beginUpload(meta: meta("cancelled"))
        store.abortUpload(token: cancelled)
        XCTAssertThrowsError(try store.appendUpload(token: cancelled, offset: 0, base64: bytes.base64EncodedString()))
        XCTAssertNil(try store.resolve(id: "cancelled"))
    }
}
