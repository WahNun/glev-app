package app.glev

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Receives Health Connect data-change notifications for blood glucose.
 *
 * Health Connect fires the registered [android.app.PendingIntent] (pointing
 * here) whenever new blood-glucose samples are written by any app — even
 * when Glev is fully closed.  This is the Android equivalent of iOS's
 * HKObserverQuery callback in AppDelegate.swift.
 *
 * On receipt we immediately enqueue a one-shot [GlucoseSyncWorker] so the
 * new samples reach the backend within a few seconds (network permitting),
 * satisfying the "within ~1 minute" latency goal from the task spec.
 *
 * Registration happens in [HealthConnectSyncRegistrar.register], which is
 * called from [MainActivity.onCreate].  The receiver is declared in
 * AndroidManifest.xml so Android can deliver the broadcast even if the
 * main activity has not yet been created.
 */
class GlucoseChangeReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        GlucoseSyncWorker.scheduleOneShot(context)
    }
}
