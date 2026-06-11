package app.glev;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // installSplashScreen() MUST be called before super.onCreate() when
        // the activity theme is Theme.SplashScreen (or a child of it).
        // Without this call the SplashScreen compat library never transitions
        // to postSplashScreenTheme and the activity crashes immediately on
        // Android 12+ (API 31+) with targetSdkVersion >= 31.
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
        createNotificationChannels();
        startAlarmKeepAliveService();
        initHealthConnectSync();
    }

    /**
     * Register all Glev notification channels required by Android 8+ (API 26+).
     *
     * Android requires that every notification channel is registered before a
     * notification can be posted to it — including the custom sound.  Custom
     * sounds must be registered at channel-creation time; they cannot be changed
     * afterwards without deleting and re-creating the channel.
     *
     * This method is idempotent: re-registering an existing channel is a no-op.
     *
     * Channels:
     *   - hypo_alarm    IMPORTANCE_HIGH  setBypassDnd=true  glev_low_alarm.wav
     *   - hyper_alarm   IMPORTANCE_HIGH  setBypassDnd=true  (default OS sound)
     *   - elevated_alarm IMPORTANCE_HIGH setBypassDnd=false (D-026: never critical)
     *
     * setBypassDnd requires ACCESS_NOTIFICATION_POLICY in the Manifest AND the
     * user must grant "Do Not Disturb access" in System Settings once.  The
     * channel flag alone is not sufficient — it signals intent to the OS but
     * the actual bypass only activates after the user grants DnD policy access.
     */
    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            // Channels are only available on Android 8.0+ (API 26+).
            return;
        }

        NotificationManager nm =
            (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        AudioAttributes alarmAudioAttributes = new AudioAttributes.Builder()
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .setUsage(AudioAttributes.USAGE_ALARM)
            .build();

        // ── hypo_alarm channel ──────────────────────────────────────────────
        // Critical low-glucose alert — iOS equivalent: interruption-level critical
        // (D-026). setBypassDnd=true so the alert fires even in Do Not Disturb.
        // Requires ACCESS_NOTIFICATION_POLICY + user DnD grant in System Settings.
        NotificationChannel hypoChannel = new NotificationChannel(
            "hypo_alarm",
            "Hypo-Alarm (kritisch)",
            NotificationManager.IMPORTANCE_HIGH
        );
        hypoChannel.setDescription(
            "Kritische Unterzuckerungs-Warnung — durchbricht Stummschaltung"
        );
        hypoChannel.enableVibration(true);
        hypoChannel.setVibrationPattern(new long[]{0, 500, 200, 500});
        hypoChannel.setBypassDnd(true);
        hypoChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        hypoChannel.setShowBadge(true);

        // Custom alarm sound — glev_low_alarm.wav must be present in
        // android/app/src/main/res/raw/ before building (see SOUND_ASSETS.md).
        Uri hypoSoundUri = Uri.parse(
            "android.resource://" + getPackageName() + "/raw/glev_low_alarm"
        );
        hypoChannel.setSound(hypoSoundUri, alarmAudioAttributes);

        nm.createNotificationChannel(hypoChannel);

        // ── hyper_alarm channel ─────────────────────────────────────────────
        // Severe high-glucose alert — iOS equivalent: interruption-level critical
        // for values ≥250 mg/dL (D-026). Same DnD-bypass as hypo_alarm.
        NotificationChannel hyperChannel = new NotificationChannel(
            "hyper_alarm",
            "Hyper-Alarm (kritisch)",
            NotificationManager.IMPORTANCE_HIGH
        );
        hyperChannel.setDescription(
            "Kritische Überzuckerungs-Warnung — durchbricht Stummschaltung"
        );
        hyperChannel.enableVibration(true);
        hyperChannel.setVibrationPattern(new long[]{0, 500, 200, 500});
        hyperChannel.setBypassDnd(true);
        hyperChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        hyperChannel.setShowBadge(true);
        // No custom sound file defined yet for hyper_alarm — falls back to OS default.
        // Add /res/raw/glev_high_alarm.wav and wire it here once available.

        nm.createNotificationChannel(hyperChannel);

        // ── elevated_alarm channel ──────────────────────────────────────────
        // Non-critical elevated glucose alert (140–250 mg/dL).
        // Per D-026: NIEMALS critical/DnD-bypass (medically not immediately
        // life-threatening). iOS equivalent: interruption-level time-sensitive.
        // setBypassDnd intentionally omitted (defaults to false).
        NotificationChannel elevatedChannel = new NotificationChannel(
            "elevated_alarm",
            "Erhöhter Blutzucker",
            NotificationManager.IMPORTANCE_HIGH
        );
        elevatedChannel.setDescription(
            "Erhöhter Blutzucker-Alarm — time-sensitive, kein DnD-Bypass"
        );
        elevatedChannel.enableVibration(true);
        elevatedChannel.setVibrationPattern(new long[]{0, 300, 150, 300});
        elevatedChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        elevatedChannel.setShowBadge(true);

        nm.createNotificationChannel(elevatedChannel);
    }

    /**
     * Start the AlarmKeepAliveService as a foreground service.
     *
     * The service holds a persistent low-priority notification so Android's
     * Doze/App-Standby cannot kill the push receiver before a hypo/hyper alert
     * arrives.  This is the Android equivalent of iOS background execution for
     * HealthKit observer queries.
     *
     * On Android 8+ (API 26+) we must call startForegroundService() rather than
     * startService() — the system grants a 5-second window for the service to
     * call startForeground(), after which it is ANR-killed if it hasn't done so.
     * AlarmKeepAliveService calls startForeground() immediately in onStartCommand.
     */
    private void startAlarmKeepAliveService() {
        Intent serviceIntent = new Intent(this, AlarmKeepAliveService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
    }

    /**
     * Bootstrap the Android Health Connect background glucose sync.
     *
     * Two complementary jobs are registered on every onCreate:
     *
     *   1. Near-real-time change notifications — HealthConnectSyncRegistrar
     *      calls Health Connect's registerForDataChanges() with a
     *      PendingIntent pointing to GlucoseChangeReceiver.  When new blood-
     *      glucose samples arrive in HC, the OS fires the receiver immediately
     *      (even while Glev is closed), which enqueues a one-shot
     *      GlucoseSyncWorker for an HTTP POST to the backend.  This is the
     *      Android equivalent of iOS HKObserverQuery + enableBackgroundDelivery.
     *
     *   2. Periodic 15-minute fallback — WorkManager's minimum repeat interval
     *      ensures background sync works on devices where HC change
     *      notifications are unreliable (e.g. Android <14 without the HC app).
     *      ExistingPeriodicWorkPolicy.KEEP means re-calling this on every
     *      onCreate does not reset the timer.
     *
     * Both registrations are idempotent and silently no-op when Health Connect
     * is unavailable or when the READ_BLOOD_GLUCOSE permission has not yet been
     * granted.  The JS layer (Settings → Health Connect) triggers the runtime
     * permission prompt; the next onResume/onCreate call retries registration.
     */
    private void initHealthConnectSync() {
        HealthConnectSyncRegistrar.INSTANCE.register(this);
        GlucoseSyncWorker.Companion.schedulePeriodic(this);
    }
}
