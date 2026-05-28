package app.glev

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.records.BloodGlucoseRecord
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Registers a Health Connect data-change listener for blood glucose.
 *
 * When Health Connect has new blood-glucose records it fires a broadcast
 * to [GlucoseChangeReceiver], which schedules [GlucoseSyncWorker] for an
 * immediate background HTTP POST.  This is the Android analog of calling
 * `HKHealthStore.enableBackgroundDelivery(for:frequency:.immediate)` on iOS.
 *
 * The registration is idempotent: Health Connect deduplicates listeners by
 * PendingIntent, so calling [register] on every [MainActivity.onCreate] is
 * safe and ensures the listener is re-established after app updates.
 *
 * Silent failures (HC unavailable, permission not yet granted) are
 * intentional — the next [MainActivity.onCreate] call retries, and the
 * periodic [GlucoseSyncWorker] job acts as a fallback in the meantime.
 */
object HealthConnectSyncRegistrar {

    fun register(context: Context) {
        if (HealthConnectClient.getSdkStatus(context) != HealthConnectClient.SDK_AVAILABLE) {
            return
        }

        // PendingIntent pointing to GlucoseChangeReceiver.
        // FLAG_UPDATE_CURRENT keeps the Intent extras fresh;
        // FLAG_IMMUTABLE is required on API 31+ and is harmless below.
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            /* requestCode = */ 0,
            Intent(context, GlucoseChangeReceiver::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        // registerForDataChanges is a suspend function — run in a
        // fire-and-forget coroutine so MainActivity.onCreate is not blocked.
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val client = HealthConnectClient.getOrCreate(context)
                client.registerForDataChanges(
                    pendingIntent,
                    setOf(BloodGlucoseRecord::class),
                )
            } catch (_: Exception) {
                // HC not available or READ_BLOOD_GLUCOSE not yet granted.
                // The user will be prompted for permission in the JS layer
                // (Settings → Health Connect); onCreate is called again
                // after the app resumes from the permission dialog, which
                // will retry this registration successfully.
            }
        }
    }
}
