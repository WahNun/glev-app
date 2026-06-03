package app.glev;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
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
     *   - hypo_alarm   IMPORTANCE_HIGH   glev_low_alarm.wav
     *     Used by the Supabase Edge Function hypo-check when sending FCM pushes
     *     for low-glucose alerts.  References the raw resource
     *     android/app/src/main/res/raw/glev_low_alarm.wav which must be present
     *     in the APK/AAB before the build (see android/app/src/main/res/raw/SOUND_ASSETS.md).
     */
    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            // Channels are only available on Android 8.0+ (API 26+).
            return;
        }

        NotificationManager nm =
            (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        // ── hypo_alarm channel ──────────────────────────────────────────────
        NotificationChannel hypoChannel = new NotificationChannel(
            "hypo_alarm",
            "Hypo-Alarm",
            NotificationManager.IMPORTANCE_HIGH
        );
        hypoChannel.setDescription(
            "Dringende Benachrichtigungen bei niedrigem Blutzucker"
        );
        hypoChannel.enableVibration(true);
        hypoChannel.setVibrationPattern(new long[]{0, 400, 200, 400});

        // Attach the custom WAV sound.
        // The raw resource glev_low_alarm.wav must exist in
        // android/app/src/main/res/raw/ before building.
        Uri soundUri = Uri.parse(
            "android.resource://" + getPackageName() + "/raw/glev_low_alarm"
        );
        AudioAttributes audioAttributes = new AudioAttributes.Builder()
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .setUsage(AudioAttributes.USAGE_ALARM)
            .build();
        hypoChannel.setSound(soundUri, audioAttributes);

        nm.createNotificationChannel(hypoChannel);
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
