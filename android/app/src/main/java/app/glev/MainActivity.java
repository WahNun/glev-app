package app.glev;

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
        initHealthConnectSync();
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
