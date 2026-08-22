// swift-tools-version: 5.9
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "Joryio",
    platforms: [
        .iOS(.v14),
        .macOS(.v10_15)
    ],
    // Two products, one package - the shape Braze's Swift SDK uses
    // (BrazeKit / BrazeUI). An app links `Joryio` for tracking, identity and
    // push, and adds `JoryioUI` only if it wants the SDK to DRAW in-app
    // messages. Leaving JoryioUI out means no WebKit and no message views are
    // linked at all, which is a procurement question for some security teams
    // rather than a size preference.
    products: [
        .library(
            name: "Joryio",
            targets: ["Joryio"]
        ),
        .library(
            name: "JoryioUI",
            targets: ["JoryioUI"]
        ),
    ],
    dependencies: [
        // SQLite for local storage
        .package(url: "https://github.com/stephencelis/SQLite.swift.git", from: "0.15.0"),
        // Stencil for Liquid template rendering
        .package(url: "https://github.com/stencilproject/Stencil.git", from: "0.15.0")
    ],
    targets: [
        .target(
            name: "Joryio",
            dependencies: [
                .product(name: "SQLite", package: "SQLite.swift"),
                .product(name: "Stencil", package: "Stencil")
            ],
            path: "Sources/Joryio"
        ),
        .target(
            name: "JoryioUI",
            dependencies: ["Joryio"],
            path: "Sources/JoryioUI"
        ),
        .testTarget(
            name: "JoryioUITests",
            dependencies: ["Joryio", "JoryioUI"],
            path: "Tests/JoryioUITests"
        ),
    ]
)
