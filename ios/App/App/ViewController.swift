import UIKit
import Capacitor
import WebKit

/// Custom bridge view controller that auto-grants microphone (and camera)
/// capture permissions at the WKWebView level.
///
/// Without this, WKWebView re-prompts for microphone access on every cold
/// app launch even though the user already granted the native
/// NSMicrophoneUsageDescription permission. The
/// `requestMediaCapturePermissionFor` delegate (iOS 15+) lets us return
/// `.grant` immediately so the browser's `getUserMedia` call succeeds
/// silently — the system-level permission dialog still fires on first-ever
/// use, but after that it never asks again.
///
/// The class is wired into Main.storyboard so Capacitor's existing
/// CAPBridgeViewController lifecycle (plugin loading, WebView setup, etc.)
/// runs unchanged; we only add the one missing delegate method.
class ViewController: CAPBridgeViewController {

    /// Auto-grant microphone (and camera) capture from the WebView layer.
    /// Available from iOS 15.0. On older iOS versions this method is not
    /// called and the default WKWebView policy applies (prompt once per
    /// app session, which is acceptable).
    @available(iOS 15.0, *)
    override func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        // Grant all capture types (microphone / camera / cameraAndMicrophone).
        // The native NSMicrophoneUsageDescription dialog is shown by iOS on
        // the very first call; after the user taps "Allow" it is cached by
        // iOS permanently (not per-session), so subsequent launches skip it.
        decisionHandler(.grant)
    }
}
