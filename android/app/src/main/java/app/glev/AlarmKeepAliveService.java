package app.glev;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;

/**
 * Foreground service that keeps the Glev push receiver alive under Android
 * Doze and App-Standby.
 *
 * Why a foreground service is necessary:
 *   Android's Doze mode and App-Standby buckets can delay or suppress
 *   FCM push delivery when the app is in the background.  A foreground
 *   service signals to the OS that the app is doing active user-relevant
 *   work and should not be restricted — analogous to iOS "background
 *   execution" for HealthKit observer queries.
 *
 * Design choices:
 *   - IMPORTANCE_LOW so the persistent notification does not make noise.
 *   - START_STICKY so the OS restarts the service automatically if it is
 *     killed by memory pressure.
 *   - foregroundServiceType="health" (declared in AndroidManifest.xml)
 *     is required on Android 14+ (API 34+) for health-related foreground
 *     services; it signals to Google Play that this is a health app.
 *
 * Icon: uses the app launcher icon as a fallback.  Replace with a proper
 * monochrome 24 dp status-bar icon (R.drawable.ic_stat_glev) once the
 * asset is created.
 */
public class AlarmKeepAliveService extends Service {

    private static final String CHANNEL_ID = "glev_keepalive";
    private static final int NOTIFICATION_ID = 1001;

    @Override
    public void onCreate() {
        super.onCreate();
        createServiceChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_glev)
            .setContentTitle("Glev — Alarme aktiv")
            .setContentText("Hypo/Hyper-Warnungen sind eingeschaltet")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build();

        startForeground(NOTIFICATION_ID, notification);
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createServiceChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Glev Hintergrundservice",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription(
            "Niedrige-Wichtigkeit-Benachrichtigung damit Hypo-Alarme zuverlässig durchkommen"
        );
        manager.createNotificationChannel(channel);
    }
}
