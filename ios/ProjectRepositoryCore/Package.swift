// swift-tools-version: 5.7
import PackageDescription

let package = Package(
    name: "ProjectRepositoryCore",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [.library(name: "ProjectRepositoryCore", targets: ["ProjectRepositoryCore"])],
    targets: [
        .target(name: "ProjectRepositoryCore", linkerSettings: [.linkedLibrary("sqlite3")]),
        .testTarget(name: "ProjectRepositoryCoreTests", dependencies: ["ProjectRepositoryCore"])
    ]
)
