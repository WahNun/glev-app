// GlevCriticalAlertsPlugin.swift
//
// Capacitor plugin that exposes a single method `requestPermission` to JS.
// This requests the iOS CriticalAlert authorization option, which is a
// SEPARATE permission dialog from the normal push-notification permission.
//
// ⚠️  XCODE SETUP REQUIRED (one-time, before first critical-alerts build):
//   1. In Xcode: File → Add Files → select this file → "Add to target: App"
//   2. The file must appear under the "App" target in Compile Sources
//      (Build Phases → Compile Sources → "+ Add file").
//   3. Regenerate the Provisioning Profile after Apple approves
//      Request ID X4854X3M8P and select it in Xcode Signing settings.
//
// No package.json or npm install needed — this is an inline Capacitor plugin.
// Capacitor 8 auto-discovers classes conforming to CAPPlugin + CAPBridgedPlugin
// that are compiled into the same target.
//
// JS usage (lib/criticalAlerts.ts):
//   import { registerPlugin } from '@capacitor/core';
//   const GlevCriticalAlerts = registerPlugin<{ requestPermission(): Promise<{ granted: boolean }> }>('GlevCriticalAlerts');
//   const { granted } = await GlevCriticalAlerts.requestPermission();

import Foundation
import Capacitor
import UserNotifications

@objc(GlevCriticalAlertsPlugin)
public class GlevCriticalAlertsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GlevCriticalAlertsPlugin"
    public let jsName = "GlevCriticalAlerts"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkPermission",   returnType: CAPPluginReturnPromise),
    ]

    /// Requests UNAuthorizationOptionCriticalAlert from iOS.
    /// This dialog is SEPARATE from the normal push-notification permission
    /// dialog — iOS shows it with explicit wording about bypassing Do Not
    /// Disturb and silent mode. The user must have already granted normal
    /// push permissions before critical alert permission is meaningful.
    @objc func requestPermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.criticalAlert]) { granted, error in
            if let error = error {
                call.reject("Critical alert authorization failed: \(error.localizedDescription)")
                return
            }
            print("[GlevCriticalAlerts] criticalAlert authorization: granted=\(granted)")
            call.resolve(["granted": granted])
        }
    }

    /// Returns the current critical-alert authorization status without prompting.
    @objc func checkPermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let granted = settings.criticalAlertSetting == .enabled
            call.resolve(["granted": granted])
        }
    }
}
