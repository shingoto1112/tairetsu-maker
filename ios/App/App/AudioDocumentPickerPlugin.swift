import Foundation
import Capacitor
import UniformTypeIdentifiers
import UIKit
import AVFoundation
import ProjectRepositoryCore

@objc(AudioDocumentPickerPlugin)
final class AudioDocumentPickerPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    let identifier = "AudioDocumentPickerPlugin"
    let jsName = "AudioDocumentPicker"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickAudioFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resolveAudioURL", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "beginAudioUpload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appendAudioUpload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishAudioUpload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "abortAudioUpload", returnType: CAPPluginReturnPromise)
    ]
    private let worker = DispatchQueue(label: "jp.tairetsu.audio", qos: .userInitiated)
    private var store: AudioStore?
    private var pendingCall: CAPPluginCall? // Main thread only, including during copy/duration work.
    private let importDirectoryName = "AudioImports"

    override func load() {
        // Only scratch picker files; never touch old Documents audio or published v2 files.
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(importDirectoryName, isDirectory: true)
        try? FileManager.default.removeItem(at: directory)
    }
    private func audioStore() throws -> AudioStore {
        if store == nil { store = try AudioStore.defaultStore() }
        return store!
    }
    private func metadata(_ call: CAPPluginCall) throws -> StoredAudioMeta {
        guard let object = call.getObject("meta") else { throw RepositoryError("INVALID_ARGUMENT") }
        return try JSONDecoder().decode(StoredAudioMeta.self, from: JSONSerialization.data(withJSONObject: object))
    }
    private func object(_ meta: StoredAudioMeta) throws -> [String: Any] {
        guard let result = try JSONSerialization.jsonObject(with: JSONEncoder().encode(meta)) as? [String: Any] else {
            throw RepositoryError("CORRUPT")
        }
        return result
    }
    private func reject(_ call: CAPPluginCall, _ error: Error) {
        // Do not expose paths, filenames or NSError details.
        DispatchQueue.main.async {
            let classified = RepositoryError.classify(error, protectedDataAvailable: UIApplication.shared.isProtectedDataAvailable)
            call.reject("音源の保存・読み込みを完了できませんでした。", classified.code)
        }
    }
    private func perform(_ call: CAPPluginCall, _ action: @escaping (AudioStore) throws -> [String: Any]) {
        worker.async { [self] in
            do {
                let result = try action(audioStore())
                DispatchQueue.main.async { call.resolve(result) }
            } catch { reject(call, error) }
        }
    }
    @objc func resolveAudioURL(_ call: CAPPluginCall) {
        perform(call) { [self] store in
            guard let id = call.getString("id"), !id.isEmpty else { throw RepositoryError("INVALID_ARGUMENT") }
            var url = try store.resolve(id: id)
            if url == nil, call.getObject("meta") != nil {
                let meta = try metadata(call)
                guard meta.id == id else { throw RepositoryError("INVALID_ARGUMENT") }
                do { url = try store.migrateLegacy(meta: meta) }
                catch {
                    // Explicit fallback signal; TS reads original bytes only if migration failed.
                    if AudioStore.safeLegacyID(id) { return ["legacy": true] }
                    throw error
                }
            }
            guard let resolved = url else { return [:] }
            let size = try resolved.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            let type = UTType(filenameExtension: resolved.pathExtension)?.preferredMIMEType ?? "audio/mpeg"
            return ["uri": resolved.absoluteString, "size": size, "type": type]
        }
    }
    @objc func beginAudioUpload(_ call: CAPPluginCall) {
        perform(call) { [self] in ["token": try $0.beginUpload(meta: metadata(call))] }
    }
    @objc func appendAudioUpload(_ call: CAPPluginCall) {
        perform(call) { store in
            guard let token = call.getString("token"), let offset = call.getInt("offset"), let data = call.getString("data") else {
                throw RepositoryError("INVALID_ARGUMENT")
            }
            try store.appendUpload(token: token, offset: offset, base64: data)
            return [:]
        }
    }
    @objc func finishAudioUpload(_ call: CAPPluginCall) {
        perform(call) { [self] store in
            guard let token = call.getString("token") else { throw RepositoryError("INVALID_ARGUMENT") }
            return ["audio": try object(store.finishUpload(token: token))]
        }
    }
    @objc func abortAudioUpload(_ call: CAPPluginCall) {
        perform(call) { store in
            guard let token = call.getString("token") else { throw RepositoryError("INVALID_ARGUMENT") }
            store.abortUpload(token: token); return [:]
        }
    }
    @objc func pickAudioFile(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard self.pendingCall == nil else { call.reject("別の音源選択が進行中です。"); return }
            guard let controller = self.bridge?.viewController, controller.presentedViewController == nil else {
                call.reject("別の画面を閉じてから音源を選択してください。"); return
            }
            self.pendingCall = call
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.audio], asCopy: true)
            picker.delegate = self; picker.allowsMultipleSelection = false; picker.shouldShowFileExtensions = true
            controller.present(picker, animated: true)
        }
    }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pendingCall?.resolve(["cancelled": true]); pendingCall = nil
    }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pendingCall else { return }
        guard let source = urls.first else { documentPickerWasCancelled(controller); return }
        worker.async { [self] in
            let accessed = source.startAccessingSecurityScopedResource()
            defer { if accessed { source.stopAccessingSecurityScopedResource() } }
            var scratch: URL?
            var durationStarted = false
            defer { if !durationStarted, let url = scratch { try? FileManager.default.removeItem(at: url) } }
            do {
                let name = source.lastPathComponent
                let type = UTType(filenameExtension: source.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
                _ = try AudioStore.fileExtension(name: name, type: type)
                let size = try source.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                guard size > 0, size <= AudioStore.maximumSize else { throw RepositoryError("INVALID_ARGUMENT") }
                let directory = FileManager.default.temporaryDirectory.appendingPathComponent(importDirectoryName, isDirectory: true)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let temporary = directory.appendingPathComponent(UUID().uuidString).appendingPathExtension(source.pathExtension)
                scratch = temporary
                // A picker-specific native scratch copy is never exposed to JS.
                try FileManager.default.copyItem(at: source, to: temporary)
                guard try temporary.resourceValues(forKeys: [.fileSizeKey]).fileSize == size else {
                    try? FileManager.default.removeItem(at: temporary)
                    throw RepositoryError("CORRUPT")
                }
                #if os(iOS)
                try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: temporary.path)
                #endif
                let asset = AVURLAsset(url: temporary)
                durationStarted = true
                asset.loadValuesAsynchronously(forKeys: ["duration"]) { [self] in
                    var durationError: NSError?
                    let loaded = asset.statusOfValue(forKey: "duration", error: &durationError) == .loaded
                    let seconds = loaded ? CMTimeGetSeconds(asset.duration) : Double.nan
                    worker.async { [self] in
                        defer { try? FileManager.default.removeItem(at: temporary) }
                        do {
                            let meta = StoredAudioMeta(id: UUID().uuidString.lowercased(), name: name, type: type, size: size,
                                duration: seconds.isFinite && seconds >= 0 ? seconds : nil)
                            let saved = try audioStore().importFile(temporary, meta: meta)
                            let result = try object(saved)
                            DispatchQueue.main.async { self.pendingCall = nil; call.resolve(["audio": result]) }
                        } catch {
                            DispatchQueue.main.async { self.pendingCall = nil }
                            reject(call, error)
                        }
                    }
                }
            } catch {
                DispatchQueue.main.async { self.pendingCall = nil }
                reject(call, error)
            }
        }
    }
}
