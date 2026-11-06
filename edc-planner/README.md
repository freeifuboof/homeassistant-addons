# EDC Planner (Android)

A pocket planner for **EDC Orlando 2026** (Tinker Field, Nov 6–8). It works offline once installed.

- **Schedule**: all 3 days, all 4 stages, laid out like the posters. Tap a set once for ★ *Want*, again for ♥ *Must-see*, a third time to remove it.
- **My Plan**: your picks turned into a route with clashes sorted out. ♥ must-sees play in full; picks with equal priority get split. It tells you when to leave each stage, how long the walk is, when you have free time, and when to be at the gates.
- **Map**: the festival map with stage pins, what's on at each stage right now, and the walking route for any step in your plan.
- **Posters**: the original day posters, with pinch zoom.
- **Reminders** (⚙ Settings): a notification 5–20 min before you need to walk to your next set.
- **Crew**: see your friends' picks and where they overlap with yours:
  - each person shares a short *crew code* (by text, WhatsApp, etc.) and the others paste it in, or share the message straight to EDC Planner;
  - *Together*: the times you'll be at the same set as friends;
  - *Crew favorites*: sets several of you picked;
  - *Where everyone is*: during the festival, where each friend's plan puts them;
  - colored dots on the schedule and "👥 with …" on your plan show who's going where.
  Codes are a snapshot, so a friend who changes picks needs to share again. No account or internet needed.
- Search (⌕) by artist or genre across all days, and share your plan as text.

## Install on a Samsung phone

1. On the phone, download `EDC-Planner.apk` from this folder on GitHub (open the file, then tap the download button).
2. Open it from **My Files → Downloads** or from the browser's download notification.
3. If asked, allow **Install unknown apps** for that app (Settings → Apps → Special access → Install unknown apps).
4. Tap **Install**. If Play Protect warns about an unknown developer, tap **More details → Install anyway**.
5. Open **EDC Planner**. To use reminders, turn them on in ⚙ and allow notifications.

To keep reminders reliable, set Settings → Apps → EDC Planner → Battery to **Unrestricted**.

## Build

```bash
sudo apt install aapt dalvik-exchange zipalign apksigner default-jdk-headless
./build.sh            # writes EDC-Planner.apk
```

`build.sh` downloads an API 31 `android.jar` if `ANDROID_JAR` isn't set. It signs the APK with `keystore/edc-planner.jks`. Keep that file, because Android only installs an update over the app if it has the same signature.

Set times live in `assets/data.js`. The UI is `assets/index.html`, `app.js` and `style.css`, running in a WebView (`src/…/MainActivity.java`). To preview it, open `assets/index.html` in a browser.
