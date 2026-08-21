import Foundation
import Capacitor
import UniformTypeIdentifiers
import UIKit

@objc(AudioDocumentPickerPlugin)
final class AudioDocumentPickerPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    let identifier = "AudioDocumentPickerPlugin"
    let jsName = "AudioDocumentPicker"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickAudioFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeTemporaryFile", returnType: CAPPluginReturnPromise)
    ]

    private var pendingCall: CAPPluginCall?
    private let importDirectoryName = "AudioImports"

    override func load() {
        cleanupImportDirectory()
    }

    @objc func pickAudioFile(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard self.pendingCall == nil else {
                call.reject("別の音源選択が進行中です。")
                return
            }
            guard self.bridge?.viewController?.presentedViewController == nil else {
                call.reject("別の画面を閉じてから音源を選択してください。")
                return
            }

            self.pendingCall = call
            let picker = UIDocumentPickerViewController(
                forOpeningContentTypes: [.audio],
                asCopy: true
            )
            picker.delegate = self
            picker.allowsMultipleSelection = false
            picker.shouldShowFileExtensions = true
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    @objc func removeTemporaryFile(_ call: CAPPluginCall) {
        guard let rawUri = call.getString("uri"),
              let url = URL(string: rawUri),
              isManagedTemporaryFile(url) else {
            call.reject("削除対象の一時ファイルが不正です。")
            return
        }
        do {
            if FileManager.default.fileExists(atPath: url.path) {
                try FileManager.default.removeItem(at: url)
            }
            call.resolve()
        } catch {
            call.reject("一時ファイルを削除できませんでした。", nil, error)
        }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pendingCall?.resolve(["cancelled": true])
        pendingCall = nil
    }

    func documentPicker(
        _ controller: UIDocumentPickerViewController,
        didPickDocumentsAt urls: [URL]
    ) {
        guard let call = pendingCall else { return }
        pendingCall = nil
        guard let sourceUrl = urls.first else {
            call.resolve(["cancelled": true])
            return
        }

        let didAccess = sourceUrl.startAccessingSecurityScopedResource()
        defer {
            if didAccess {
                sourceUrl.stopAccessingSecurityScopedResource()
            }
        }

        do {
            let directory = try importDirectory()
            let safeName = sanitizedFileName(sourceUrl.lastPathComponent)
            let destination = directory
                .appendingPathComponent(UUID().uuidString)
                .appendingPathExtension(sourceUrl.pathExtension.isEmpty ? "audio" : sourceUrl.pathExtension)
            try FileManager.default.copyItem(at: sourceUrl, to: destination)
            let values = try destination.resourceValues(forKeys: [.fileSizeKey, .contentTypeKey])
            call.resolve([
                "cancelled": false,
                "mimeType": values.contentType?.preferredMIMEType ?? "audio/mpeg",
                "name": safeName,
                "size": values.fileSize ?? 0,
                "uri": destination.absoluteString
            ])
        } catch {
            call.reject("音源ファイルを読み込めませんでした。", nil, error)
        }
    }

    private func importDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(importDirectoryName, isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        return directory
    }

    private func cleanupImportDirectory() {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(importDirectoryName, isDirectory: true)
        try? FileManager.default.removeItem(at: directory)
    }

    private func isManagedTemporaryFile(_ url: URL) -> Bool {
        let managedDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent(importDirectoryName, isDirectory: true)
            .standardizedFileURL.path
        return url.standardizedFileURL.path.hasPrefix(managedDirectory + "/")
    }

    private func sanitizedFileName(_ name: String) -> String {
        let cleaned = name
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: ":", with: "_")
        return cleaned.isEmpty ? "audio" : cleaned
    }
}
