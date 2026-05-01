import UIKit
import Capacitor
import HealthKit
import WebKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    /// HealthKit blood-glucose background sync. Lives for the lifetime
    /// of the app process so the observer query and anchor cache are
    /// not torn down between foreground/background transitions.
    private let glucoseBackgroundSync = HealthKitGlucoseBackgroundSync()

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Register the HKObserverQuery + Background Delivery on every
        // launch — including the silent background launches iOS itself
        // performs when a new HealthKit sample arrives. Apple's
        // observer registration is process-scoped so we must re-execute
        // on each launch; `enableBackgroundDelivery` is daemon-scoped
        // and idempotent so re-calling it is cheap.
        glucoseBackgroundSync.start()
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Re-attempt observer + background-delivery registration. The
        // first call from didFinishLaunchingWithOptions can fail
        // silently when the user has not yet granted HealthKit read
        // access; once they do grant it (and then background + return
        // to the app), this retry is what actually arms the daemon.
        glucoseBackgroundSync.start()
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

// MARK: - HealthKit blood-glucose background sync

/// Bridges HealthKit's `HKObserverQuery` + Background Delivery into
/// the Glev backend so the post-meal CGM follow-up worker sees fresh
/// glucose values without the user ever having to open the app.
///
/// Why this lives in native code (and not the @capgo/capacitor-health
/// JS plugin):
///   * `enableBackgroundDelivery` only works while the JS runtime is
///     not loaded — iOS wakes the app process directly into AppDelegate
///     when a new sample is written, well before WKWebView is ready.
///   * The plugin we use on the JS side does not expose an observer
///     API at all; this fills that gap without forking the plugin.
///
/// Sync strategy:
///   * `HKAnchoredObjectQuery` with a persisted anchor returns only
///     samples written since the last drain. Anchor is saved BEFORE
///     posting so a transient network failure can't pin us to the
///     same window forever — the server's UNIQUE INDEX on
///     (user_id, source_uuid) makes any re-post a no-op.
///   * Cookies are pulled from `WKWebsiteDataStore` so the request
///     authenticates against the same Glev session the user is logged
///     into in the WebView. Capacitor does not bridge cookies into
///     `HTTPCookieStorage.shared`, so we have to do it manually.
///   * Endpoint matches the foreground sync path
///     (`/api/cgm/apple-health/sync`); payload shape is identical to
///     `lib/cgm/appleHealthClient.ts` so the server-side normaliser
///     stays unchanged.
final class HealthKitGlucoseBackgroundSync {

    /// Storage key for the persisted `HKQueryAnchor`. Bumped if we
    /// ever change the query predicate (changing predicates with the
    /// same anchor leads to ill-defined results per Apple's docs).
    private static let anchorDefaultsKey = "glev.appleHealth.bgAnchor.v1"

    /// Production sync endpoint. Hard-coded because the native shell
    /// always points at https://glev.app via `capacitor.config.ts`.
    private static let syncEndpoint = URL(string: "https://glev.app/api/cgm/apple-health/sync")!

    /// Cap the request to the observer wake budget (~30 s on iOS).
    private static let requestTimeoutSeconds: TimeInterval = 25

    private let store = HKHealthStore()
    private let glucoseType: HKQuantityType? = HKObjectType.quantityType(forIdentifier: .bloodGlucose)
    private var observer: HKObserverQuery?
    private var backgroundDeliveryEnabled = false

    /// Idempotent. Safe to call from didFinishLaunchingWithOptions and
    /// applicationDidBecomeActive — the observer is created once and
    /// background delivery is only re-requested until it succeeds.
    func start() {
        guard HKHealthStore.isHealthDataAvailable(), let type = glucoseType else { return }

        if observer == nil {
            let query = HKObserverQuery(sampleType: type, predicate: nil) { [weak self] _, completion, error in
                // The completion handler MUST be called even on error,
                // otherwise iOS will throttle / disable background
                // delivery for this app+type pair (see HKObserverQuery
                // docs).
                guard let self = self, error == nil else {
                    completion()
                    return
                }
                self.fetchAndPostNewSamples(completion: completion)
            }
            store.execute(query)
            observer = query
        }

        if !backgroundDeliveryEnabled {
            store.enableBackgroundDelivery(for: type, frequency: .immediate) { [weak self] success, _ in
                if success { self?.backgroundDeliveryEnabled = true }
                // Failures are silent: this typically means the user
                // has not granted HealthKit read access yet. The next
                // call to `start()` (from didBecomeActive after the
                // user grants access in the JS flow) will retry.
            }
        }
    }

    private func fetchAndPostNewSamples(completion: @escaping () -> Void) {
        guard let type = glucoseType else { completion(); return }

        let anchor = loadAnchor()
        let query = HKAnchoredObjectQuery(
            type: type,
            predicate: nil,
            anchor: anchor,
            limit: HKObjectQueryNoLimit
        ) { [weak self] _, samples, _, newAnchor, _ in
            guard let self = self else { completion(); return }

            // Persist the anchor BEFORE posting. If the POST fails the
            // server simply won't see these samples until the next
            // foreground sync re-pulls them from the time-window query
            // in `lib/cgm/appleHealthClient.ts` — re-posting same
            // UUIDs is idempotent on the server.
            if let newAnchor = newAnchor {
                self.saveAnchor(newAnchor)
            }

            let quantitySamples = (samples ?? []).compactMap { $0 as? HKQuantitySample }
            guard !quantitySamples.isEmpty else { completion(); return }
            self.postSamples(quantitySamples, completion: completion)
        }
        store.execute(query)
    }

    private func postSamples(_ samples: [HKQuantitySample], completion: @escaping () -> Void) {
        let mgPerDl = HKUnit(from: "mg/dL")
        let isoFormatter = ISO8601DateFormatter()

        let payload: [[String: Any]] = samples.map { sample in
            [
                "uuid": sample.uuid.uuidString,
                "startDate": isoFormatter.string(from: sample.startDate),
                // Convert on-device to mg/dL so the server's unit
                // handling stays in one place. HKQuantity will throw
                // if asked for an incompatible unit, but blood glucose
                // always supports mg/dL.
                "value": sample.quantity.doubleValue(for: mgPerDl),
                "unit": "mg/dL"
            ]
        }

        guard let bodyData = try? JSONSerialization.data(withJSONObject: ["samples": payload]) else {
            completion()
            return
        }

        // WKWebsiteDataStore APIs must be touched on the main thread.
        DispatchQueue.main.async {
            WKWebsiteDataStore.default().httpCookieStore.getAllCookies { cookies in
                let cookieHeader = cookies
                    .filter { $0.domain.hasSuffix("glev.app") }
                    .map { "\($0.name)=\($0.value)" }
                    .joined(separator: "; ")

                var request = URLRequest(url: HealthKitGlucoseBackgroundSync.syncEndpoint)
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                if !cookieHeader.isEmpty {
                    request.setValue(cookieHeader, forHTTPHeaderField: "Cookie")
                }
                request.httpBody = bodyData
                request.timeoutInterval = HealthKitGlucoseBackgroundSync.requestTimeoutSeconds

                let task = URLSession.shared.dataTask(with: request) { _, _, _ in
                    // We don't act on the response — the foreground
                    // sync's Settings card is the source of truth for
                    // user-visible status. A 401 here just means the
                    // user is logged out; new samples will be picked
                    // up on the next post-login foreground sync.
                    completion()
                }
                task.resume()
            }
        }
    }

    private func loadAnchor() -> HKQueryAnchor? {
        guard let data = UserDefaults.standard.data(forKey: HealthKitGlucoseBackgroundSync.anchorDefaultsKey) else {
            return nil
        }
        return try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
    }

    private func saveAnchor(_ anchor: HKQueryAnchor) {
        guard let data = try? NSKeyedArchiver.archivedData(withRootObject: anchor, requiringSecureCoding: true) else {
            return
        }
        UserDefaults.standard.set(data, forKey: HealthKitGlucoseBackgroundSync.anchorDefaultsKey)
    }
}
