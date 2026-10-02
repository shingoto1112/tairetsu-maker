import Capacitor

final class TairetsuBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(AudioDocumentPickerPlugin())
        bridge?.registerPluginInstance(ExportSharePlugin())
    }
}
