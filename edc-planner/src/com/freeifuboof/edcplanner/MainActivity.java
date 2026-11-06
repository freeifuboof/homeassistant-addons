package com.freeifuboof.edcplanner;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** Hosts the planner UI (assets/index.html) in a WebView and exposes a small native bridge. */
public class MainActivity extends Activity {
    static final String PREFS = "edc_planner";
    static final String POST_NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS";
    private WebView web;
    private ClipboardManager clipboard;
    /** Text shared into the app (a friend's crew code), picked up by the page. */
    private volatile String incoming;

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
    protected void onResume() {
        super.onResume();
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

        @JavascriptInterface
        public void testNotification() {
            AlarmReceiver.show(act, 999999, "EDC Planner", "Reminders are working 🎶");
        }
    }
}
