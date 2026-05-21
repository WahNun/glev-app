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
    }
}
