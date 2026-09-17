// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "jev-shell-guard",
  platforms: [.macOS(.v14)],
  products: [
    .executable(name: "jevsh", targets: ["jevsh"])
  ],
  targets: [
    .target(name: "JevShellGuard"),
    .executableTarget(name: "jevsh", dependencies: ["JevShellGuard"]),
    .testTarget(name: "JevShellGuardTests", dependencies: ["JevShellGuard"]),
  ]
)
