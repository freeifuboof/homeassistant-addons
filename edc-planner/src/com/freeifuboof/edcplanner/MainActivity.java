package com.freeifuboof.edcplanner;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Looper;
import java.util.Locale;
import org.json.JSONObject;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** Hosts the planner UI (assets/index.html) in a WebView and exposes a small native bridge. */
public class MainActivity extends Activity implements SensorEventListener, LocationListener {
    static final String PREFS = "edc_planner";
    static final String POST_NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS";
    private WebView web;
    private ClipboardManager clipboard;
    /** Text shared into the app (a friend's crew code), picked up by the page. */
    private volatile String incoming;
    static final String FINE = "android.permission.ACCESS_FINE_LOCATION";
    static final String COARSE = "android.permission.ACCESS_COARSE_LOCATION";
    private volatile boolean wantGps = false, wantCompass = false;
    private volatile float heading = -1f;
    private final float[] rot = new float[9], orient = new float[3];

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        takeShared(getIntent());
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0b0614"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setBuiltInZoomControls(false);
        s.setSupportZoom(false);
        s.setTextZoom(100);
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Bridge(this), "Native");
        setContentView(web);
        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl("file:///android_asset/index.html");
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        takeShared(intent);
        if (web != null) web.evaluateJavascript("window.onAppResume && window.onAppResume()", null);
    }

    private void takeShared(Intent intent) {
        if (intent == null) return;
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            CharSequence t = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            if (t != null) incoming = t.toString();
        } else if (Intent.ACTION_VIEW.equals(intent.getAction()) && intent.getDataString() != null) {
            incoming = intent.getDataString();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        stopSensors();
    }

    @Override
    protected void onResume() {
        super.onResume();
        startSensors();
        if (web != null) web.evaluateJavascript("window.onAppResume && window.onAppResume()", null);
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.onBack ? window.onBack() : false", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if (!"true".equals(value)) MainActivity.super.onBackPressed();
            }
        });
    }

    // ---------- GPS + compass while the app is on screen (for the radar) ----------
    boolean hasLocationPermission() {
        return checkSelfPermission(FINE) == PackageManager.PERMISSION_GRANTED;
    }

    void startSensors() {
        if (wantGps && hasLocationPermission()) {
            LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            try {
                lm.removeUpdates(this);
                if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER))
                    lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 3000, 2, this, Looper.getMainLooper());
                if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
                    lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 10000, 5, this, Looper.getMainLooper());
            } catch (SecurityException ignored) {
            }
        }
        if (wantCompass) {
            SensorManager sm = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
            Sensor rv = sm.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
            if (rv != null) sm.registerListener(this, rv, SensorManager.SENSOR_DELAY_UI);
        }
    }

    void stopSensors() {
        ((LocationManager) getSystemService(Context.LOCATION_SERVICE)).removeUpdates(this);
        ((SensorManager) getSystemService(Context.SENSOR_SERVICE)).unregisterListener(this);
    }

    static void storeFix(Context c, Location l) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("last_fix",
                String.format(Locale.US, "{\"lat\":%.6f,\"lon\":%.6f,\"acc\":%.0f,\"t\":%d}",
                        l.getLatitude(), l.getLongitude(), l.getAccuracy(), l.getTime())).apply();
    }

    @Override
    public void onLocationChanged(Location l) {
        storeFix(this, l);
    }

    @Override
    public void onStatusChanged(String p, int s, Bundle b) {
    }

    @Override
    public void onProviderEnabled(String p) {
    }

    @Override
    public void onProviderDisabled(String p) {
    }

    @Override
    public void onSensorChanged(SensorEvent e) {
        SensorManager.getRotationMatrixFromVector(rot, e.values);
        SensorManager.getOrientation(rot, orient);
        float deg = (float) Math.toDegrees(orient[0]);
        heading = (deg + 360f) % 360f;
    }

    @Override
    public void onAccuracyChanged(Sensor s, int a) {
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code == 2) {
            final boolean ok = hasLocationPermission();
            if (ok) startSensors();
            web.evaluateJavascript("window.onLocationPermission && window.onLocationPermission(" + ok + ")", null);
        }
    }

    void askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] {POST_NOTIFICATIONS}, 1);
        }
    }

    boolean hasNotificationPermission() {
        return Build.VERSION.SDK_INT < 33
                || checkSelfPermission(POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    static class Bridge {
        private final MainActivity act;

        Bridge(MainActivity act) {
            this.act = act;
        }

        private SharedPreferences prefs() {
            return act.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        }

        @JavascriptInterface
        public String load() {
            return prefs().getString("state", "");
        }

        @JavascriptInterface
        public void save(String json) {
            prefs().edit().putString("state", json).apply();
        }

        @JavascriptInterface
        public String takeIncoming() {
            String t = act.incoming;
            act.incoming = null;
            return t == null ? "" : t;
        }

        @JavascriptInterface
        public void copy(String text) {
            act.clipboard.setPrimaryClip(ClipData.newPlainText("EDC crew code", text));
        }

        @JavascriptInterface
        public String paste() {
            try {
                ClipData c = act.clipboard.getPrimaryClip();
                if (c == null || c.getItemCount() == 0) return "";
                CharSequence t = c.getItemAt(0).coerceToText(act);
                return t == null ? "" : t.toString();
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public void share(String text) {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_SUBJECT, "My EDC Orlando 2026 plan");
            send.putExtra(Intent.EXTRA_TEXT, text);
            Intent chooser = Intent.createChooser(send, "Share plan");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            act.startActivity(chooser);
        }

        /** json: [{"id":1,"at":epochMillis,"title":"...","text":"..."}] — replaces all reminders. */
        @JavascriptInterface
        public void setReminders(String json) {
            AlarmReceiver.replaceAll(act, json);
        }

        @JavascriptInterface
        public void requestNotifications() {
            act.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    act.askNotificationPermission();
                }
            });
        }

        @JavascriptInterface
        public boolean notificationsAllowed() {
            return act.hasNotificationPermission();
        }

        // ----- location -----
        @JavascriptInterface
        public boolean locationAllowed() {
            return act.hasLocationPermission();
        }

        @JavascriptInterface
        public void requestLocation() {
            act.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    act.requestPermissions(new String[] {FINE, COARSE}, 2);
                }
            });
        }

        /** GPS + compass for the radar; only while the Find screen is open. */
        @JavascriptInterface
        public void watch(final boolean on) {
            act.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    act.wantGps = on;
                    act.wantCompass = on;
                    act.stopSensors();
                    if (on) act.startSensors();
                }
            });
        }

        @JavascriptInterface
        public String myLocation() {
            String s = prefs().getString("last_fix", "");
            if (s.isEmpty() && act.hasLocationPermission()) {
                try {
                    LocationManager lm = (LocationManager) act.getSystemService(Context.LOCATION_SERVICE);
                    Location best = null;
                    for (String p : lm.getProviders(true)) {
                        Location l = lm.getLastKnownLocation(p);
                        if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
                    }
                    if (best != null) {
                        storeFix(act, best);
                        s = prefs().getString("last_fix", "");
                    }
                } catch (SecurityException ignored) {
                }
            }
            return s;
        }

        @JavascriptInterface
        public float heading() {
            return act.heading;
        }

        /** json: {server, token, memberId, key, until} */
        @JavascriptInterface
        public boolean startSharing(String json) {
            if (!act.hasLocationPermission()) return false;
            prefs().edit().putString("share_cfg", json).remove("share_status").apply();
            Intent i = new Intent(act, LocationService.class);
            if (Build.VERSION.SDK_INT >= 26) act.startForegroundService(i);
            else act.startService(i);
            return true;
        }

        @JavascriptInterface
        public void stopSharing() {
            prefs().edit().remove("share_cfg").apply();
            act.stopService(new Intent(act, LocationService.class));
        }

        /** "" when off, else JSON {until, status} */
        @JavascriptInterface
        public String sharing() {
            String cfg = prefs().getString("share_cfg", "");
            if (cfg.isEmpty() || !LocationService.running) return "";
            try {
                JSONObject o = new JSONObject();
                o.put("until", new JSONObject(cfg).optLong("until"));
                o.put("status", prefs().getString("share_status", ""));
                return o.toString();
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public void testNotification() {
            AlarmReceiver.show(act, 999999, "EDC Planner", "Reminders are working 🎶");
        }
    }
}
