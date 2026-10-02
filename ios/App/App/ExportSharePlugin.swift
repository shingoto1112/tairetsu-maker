import Foundation
import Capacitor
import UniformTypeIdentifiers
import UIKit
import LinkPresentation
import ImageIO

// The sheet receives an image placeholder, not a file URL, so UIKit offers
// image activities. Only the requested item is loaded; no array of decoded
// full-resolution images or extra preview images is retained by this source.
private final class ExportImageSource: NSObject, UIActivityItemSource {
    let url: URL
    let fileName: String
    let typeIdentifier: String
    private(set) var loadFailed = false

    init(url: URL, fileName: String, typeIdentifier: String) {
        self.url = url
        self.fileName = fileName
        self.typeIdentifier = typeIdentifier
    }

    func activityViewControllerPlaceholderItem(_ activityViewController: UIActivityViewController) -> Any {
        UIImage()
    }

    func activityViewController(_ activityViewController: UIActivityViewController, itemForActivityType activityType: UIActivity.ActivityType?) -> Any? {
        let image = UIImage(contentsOfFile: url.path)
        if image == nil { loadFailed = true }
        return image
    }

    func activityViewController(_ activityViewController: UIActivityViewController, subjectForActivityType activityType: UIActivity.ActivityType?) -> String {
        fileName
    }

    func activityViewController(_ activityViewController: UIActivityViewController, dataTypeIdentifierForActivityType activityType: UIActivity.ActivityType?) -> String {
        typeIdentifier
    }

    func activityViewControllerLinkMetadata(_ activityViewController: UIActivityViewController) -> LPLinkMetadata? {
        let metadata = LPLinkMetadata()
        metadata.title = fileName
        metadata.originalURL = url
        return metadata
    }
}

@objc(ExportSharePlugin)
final class ExportSharePlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "ExportSharePlugin"
    let jsName = "ExportShare"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "shareFiles", returnType: CAPPluginReturnPromise)
    ]
    private var pendingCall: CAPPluginCall?

    @objc func shareFiles(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { call.reject("共有画面を開けませんでした。"); return }
            guard self.pendingCall == nil else { call.reject("別の共有・保存が進行中です。"); return }
            guard let presenter = self.bridge?.viewController,
                  presenter.viewIfLoaded?.window != nil,
                  presenter.presentedViewController == nil else {
                call.reject("別の画面を閉じてから共有・保存してください。")
                return
            }
            guard let files = call.getArray("files"), !files.isEmpty,
                  let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else {
                call.reject("共有するファイルがありません。")
                return
            }
            let exportRoot = cache.appendingPathComponent("exports", isDirectory: true).resolvingSymlinksInPath().standardizedFileURL.path + "/"
            var items = [Any]()
            var imageSources = [ExportImageSource]()
            for rawFile in files {
                guard let file = rawFile as? [String: Any],
                      let path = file["path"] as? String,
                      let mimeType = file["mimeType"] as? String,
                      let fileName = file["fileName"] as? String, !fileName.isEmpty,
                      let url = URL(string: path), url.isFileURL,
                      url.resolvingSymlinksInPath().standardizedFileURL.path.hasPrefix(exportRoot),
                      FileManager.default.isReadableFile(atPath: url.path) else {
                    call.reject("共有ファイルの場所が不正か、読み込めません。")
                    return
                }
                if mimeType.hasPrefix("image/") {
                    guard let type = UTType(mimeType: mimeType), type.conforms(to: .image),
                          let source = CGImageSourceCreateWithURL(url as CFURL, nil),
                          CGImageSourceGetCount(source) > 0 else {
                        call.reject("共有する画像を読み込めません。")
                        return
                    }
                    let item = ExportImageSource(url: url, fileName: fileName, typeIdentifier: type.identifier)
                    items.append(item)
                    imageSources.append(item)
                } else {
                    // PDF and ZIP remain documents. No photo permissions are requested here.
                    items.append(url)
                }
            }
            self.pendingCall = call
            let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
            sheet.title = call.getString("title")
            if let popover = sheet.popoverPresentationController {
                let view = presenter.view!
                popover.sourceView = view
                popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
                popover.permittedArrowDirections = []
            }
            sheet.completionWithItemsHandler = { [weak self] _, completed, _, error in
                self?.pendingCall = nil
                if let error { call.reject("共有・保存先へ受け渡せませんでした。", nil, error) }
                else if imageSources.contains(where: { $0.loadFailed }) { call.reject("共有する画像を読み込めませんでした。") }
                else { call.resolve(["status": completed ? "shared" : "cancelled"]) }
                // JS deletes the managed Cache files after resolve/reject.
            }
            presenter.present(sheet, animated: true)
        }
    }
}
