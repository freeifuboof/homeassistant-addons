package com.freeifuboof.edcplanner;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * Shares this phone's position with the live crew while the user has it switched on.
 * Runs as a foreground service (with a notification and a Stop button) so it keeps
 * working with the screen off, and stops by itself at the chosen time.
 */
public class LocationService extends Service implements LocationListener {
    static final String ACTION_STOP = "com.freeifuboof.edcplanner.STOP_SHARING";
    static final String CHANNEL = "location_share";
    static final int NOTIF_ID = 4242;
    static final long POST_EVERY_MS = 45000;
    static final float POST_IF_MOVED_M = 40f;

    static volatile boolean running = false;

    private final ExecutorService net = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private LocationManager lm;
    private JSONObject cfg;
    private Location lastPosted;
    private long lastPostAt;

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            prefs(this).edit().remove("share_cfg").apply();
            stopSelf();
            return START_NOT_STICKY;
        }
        try {
            cfg = new JSONObject(prefs(this).getString("share_cfg", ""));
        } catch (Exception e) {
            stopSelf();
            return START_NOT_STICKY;
        }
        long until = cfg.optLong("until", 0);
        if (until <= System.currentTimeMillis()
                || checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            prefs(this).edit().remove("share_cfg").apply();
            stopSelf();
            return START_NOT_STICKY;
        }

        Notification n = buildNotification(until);
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIF_ID, n);
        }
        running = true;

        lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        try {
            lm.removeUpdates(this);
            if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 20000, 10, this, Looper.getMainLooper());
            }
            if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 30000, 20, this, Looper.getMainLooper());
            }
        } catch (SecurityException e) {
            stopSelf();
            return START_NOT_STICKY;
        }
        main.removeCallbacksAndMessages(null);
        main.postDelayed(new Runnable() {
            @Override
            public void run() {
                prefs(LocationService.this).edit().remove("share_cfg").apply();
                stopSelf();
            }
        }, Math.max(1000, until - System.currentTimeMillis()));
        return START_NOT_STICKY;
    }

    private Notification buildNotification(long until) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Location sharing", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shown while your crew can see where you are");
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPi = PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent stop = new Intent(this, LocationService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 2, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        java.text.DateFormat tf = android.text.format.DateFormat.getTimeFormat(this);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        b.setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setContentTitle("Sharing your location with your crew")
                .setContentText("Until " + tf.format(new java.util.Date(until)) + " · tap Stop to turn off")
                .setOngoing(true)
                .setContentIntent(openPi)
                .addAction(new Notification.Action.Builder(null, "Stop", stopPi).build());
        return b.build();
    }

    @Override
    public void onLocationChanged(Location loc) {
        if (loc == null || cfg == null) return;
        // ignore a coarse network fix if we recently had a good GPS one
        if (lastPosted != null && LocationManager.NETWORK_PROVIDER.equals(loc.getProvider())
                && loc.getAccuracy() > 3 * lastPosted.getAccuracy()
                && System.currentTimeMillis() - lastPostAt < 120000) {
            return;
        }
        MainActivity.storeFix(this, loc);
        long now = System.currentTimeMillis();
        boolean moved = lastPosted == null || loc.distanceTo(lastPosted) > POST_IF_MOVED_M;
        if (now - lastPostAt < POST_EVERY_MS && !moved) return;
        lastPostAt = now;
        lastPosted = loc;
        final String body = String.format(Locale.US, "{\"lat\":%.6f,\"lon\":%.6f,\"acc\":%.0f}",
                loc.getLatitude(), loc.getLongitude(), loc.getAccuracy());
        final JSONObject c = cfg;
        net.execute(new Runnable() {
            @Override
            public void run() {
                int code = send(c, "PUT", body);
                prefs(LocationService.this).edit()
                        .putString("share_status", (code >= 200 && code < 300 ? "ok:" : "err:" + code + ":") + System.currentTimeMillis())
                        .apply();
            }
        });
    }

    static int send(JSONObject c, String method, String body) {
        HttpURLConnection con = null;
        try {
            URL u = new URL(c.getString("server") + "/api/crews/" + c.getString("token")
                    + "/members/" + c.getString("memberId") + "/location");
            con = (HttpURLConnection) u.openConnection();
            con.setConnectTimeout(10000);
            con.setReadTimeout(10000);
            con.setRequestMethod(method);
            con.setRequestProperty("X-Member-Key", c.getString("key"));
            if (body != null) {
                con.setDoOutput(true);
                con.setRequestProperty("Content-Type", "application/json");
                OutputStream os = con.getOutputStream();
                os.write(body.getBytes("UTF-8"));
                os.close();
            }
            return con.getResponseCode();
        } catch (Exception e) {
            return 0; // offline: the next fix will try again
        } finally {
            if (con != null) con.disconnect();
        }
    }

    @Override
    public void onDestroy() {
        running = false;
        main.removeCallbacksAndMessages(null);
        if (lm != null) lm.removeUpdates(this);
        final JSONObject c = cfg;
        if (c != null) {
            // tell the crew we stopped, so they don't see a stale dot
            net.execute(new Runnable() {
                @Override
                public void run() {
                    send(c, "DELETE", null);
                }
            });
        }
        net.shutdown();
        super.onDestroy();
    }

    // required on older Android versions
    @Override
    public void onStatusChanged(String provider, int status, Bundle extras) {
    }

    @Override
    public void onProviderEnabled(String provider) {
    }

    @Override
    public void onProviderDisabled(String provider) {
    }
}
