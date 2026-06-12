// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.3.1"),
        .package(name: "CapacitorCommunityAppleSignIn", path: "../../../node_modules/.pnpm/@capacitor-community+apple-sign-in@7.1.0_@capacitor+core@8.3.1/node_modules/@capacitor-community/apple-sign-in"),
        .package(name: "CapacitorHaptics", path: "../../../node_modules/.pnpm/@capacitor+haptics@8.0.2_@capacitor+core@8.3.1/node_modules/@capacitor/haptics"),
        .package(name: "CapacitorLocalNotifications", path: "../../../node_modules/.pnpm/@capacitor+local-notifications@8.2.0_@capacitor+core@8.3.1/node_modules/@capacitor/local-notifications"),
        .package(name: "CapacitorPushNotifications", path: "../../../node_modules/.pnpm/@capacitor+push-notifications@8.0.3_@capacitor+core@8.3.1/node_modules/@capacitor/push-notifications"),
        .package(name: "CapacitorScreenOrientation", path: "../../../node_modules/.pnpm/@capacitor+screen-orientation@8.0.1_@capacitor+core@8.3.1/node_modules/@capacitor/screen-orientation"),
        .package(name: "CapacitorShare", path: "../../../node_modules/.pnpm/@capacitor+share@8.0.1_@capacitor+core@8.3.1/node_modules/@capacitor/share"),
        .package(name: "CapgoCapacitorHealth", path: "../../../node_modules/.pnpm/@capgo+capacitor-health@8.4.8_@capacitor+core@8.3.1/node_modules/@capgo/capacitor-health")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorCommunityAppleSignIn", package: "CapacitorCommunityAppleSignIn"),
                .product(name: "CapacitorHaptics", package: "CapacitorHaptics"),
                .product(name: "CapacitorLocalNotifications", package: "CapacitorLocalNotifications"),
                .product(name: "CapacitorPushNotifications", package: "CapacitorPushNotifications"),
                .product(name: "CapacitorScreenOrientation", package: "CapacitorScreenOrientation"),
                .product(name: "CapacitorShare", package: "CapacitorShare"),
                .product(name: "CapgoCapacitorHealth", package: "CapgoCapacitorHealth")
            ]
        )
    ]
)
