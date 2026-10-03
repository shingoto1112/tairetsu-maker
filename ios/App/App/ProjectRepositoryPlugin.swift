import Foundation
import Capacitor
import UIKit
import ProjectRepositoryCore

@objc(ProjectRepositoryPlugin)
final class ProjectRepositoryPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "ProjectRepositoryPlugin"
    let jsName = "ProjectRepository"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "initialize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listSummaries", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readProject", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "commitProject", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "touchOpened", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "renameProject", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeProject", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createRecoveryBackup", returnType: CAPPluginReturnPromise)
    ]
    private let worker = DispatchQueue(label: "jp.tairetsu.repository.bridge", qos: .userInitiated)
    private var repository: ProjectRepository?

    private func perform(_ method: String, _ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("保存処理に必要な情報が不正です。", "INVALID_ARGUMENT", nil, ["retryable": false])
            return
        }
        worker.async { [self] in
            do {
                if repository == nil {
                    repository = ProjectRepository(databaseURL: try ProjectRepository.defaultDatabaseURL(), protectedDataAvailable: {
                        // UIKit access stays on main; SQLite work stays on the repository queue.
                        if Thread.isMainThread { return UIApplication.shared.isProtectedDataAvailable }
                        return DispatchQueue.main.sync { UIApplication.shared.isProtectedDataAvailable }
                    })
                }
                let response = try repository!.execute(method, requestJSON: json)
                DispatchQueue.main.async { call.resolve(["json": response]) }
            } catch {
                let e = RepositoryError.classify(error)
                // No NSError, raw paths, SQL, project titles or bodies cross the bridge.
                DispatchQueue.main.async {
                    call.reject("保存処理を完了できませんでした。", e.code, nil, ["retryable": e.retryable])
                }
            }
        }
    }
    @objc func initialize(_ call: CAPPluginCall) { perform("initialize", call) }
    @objc func listSummaries(_ call: CAPPluginCall) { perform("listSummaries", call) }
    @objc func readProject(_ call: CAPPluginCall) { perform("readProject", call) }
    @objc func commitProject(_ call: CAPPluginCall) { perform("commitProject", call) }
    @objc func touchOpened(_ call: CAPPluginCall) { perform("touchOpened", call) }
    @objc func renameProject(_ call: CAPPluginCall) { perform("renameProject", call) }
    @objc func removeProject(_ call: CAPPluginCall) { perform("removeProject", call) }
    @objc func createRecoveryBackup(_ call: CAPPluginCall) { perform("createRecoveryBackup", call) }
}
