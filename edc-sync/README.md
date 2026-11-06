# edc-sync

Live crew sync for the [EDC Planner](../edc-planner) app. Friends in a crew see each other's picks update automatically. The app keeps everything saved on the phone, so it works offline and catches up when it has signal.

- A tiny Node server with no dependencies. Data lives in one JSON file in `/data`.
- Crews are private: you join one only through its invite link, and the server stores just a hash of the link's secret.
- Each phone gets its own key, so crew members can't overwrite each other's picks.
- Limits on request rate, crew size, body size and crew count. Crews idle for 60 days are deleted.
- **Locations** (Find my crew) are kept **in memory only**, never written to disk, and disappear after 2 hours or when someone stops sharing. A server restart wipes them.

## 1. Get the image

**Option A: GitHub (recommended).** Pushing changes under `edc-sync/` runs the *edc-sync image* GitHub Action. It tests the server and publishes `ghcr.io/freeifuboof/edc-sync:latest` (amd64 and arm64).

After the first run, make the image public so Unraid can pull it without logging in: GitHub → your profile → **Packages** → **edc-sync** → **Package settings** → **Change visibility** → Public.

**Option B: build on Unraid.** In the Unraid terminal:
```bash
cd /mnt/user/appdata && git clone -b claude/samsung-apk-build-a9n19a https://github.com/freeifuboof/homeassistant-addons edc-src
docker build -t edc-sync /mnt/user/appdata/edc-src/edc-sync
```
Then use `edc-sync` as the Repository in step 2.

## 2. Add the container in Unraid

1. Copy the template onto the flash drive (Unraid terminal):
   ```bash
   wget -O /boot/config/plugins/dockerMan/templates-user/my-edc-sync.xml \
     https://raw.githubusercontent.com/freeifuboof/homeassistant-addons/claude/samsung-apk-build-a9n19a/edc-sync/edc-sync.xml
   ```
2. **Docker** tab → **Add Container** → Template: **edc-sync**. The defaults are port `8787` and data in `/mnt/user/appdata/edc-sync`. Click **Apply**.
3. Check it: open `http://UNRAID-IP:8787/api/health`. You should see `{"ok":true,...}`.

## 3. Expose it with a Cloudflare Tunnel

1. In the Cloudflare dashboard go to **Zero Trust → Networks → Tunnels → Create a tunnel**, choose **Cloudflared**, and name it (e.g. `unraid`). Copy the **token** from the install command it shows.
2. In Unraid, install **cloudflared** from Community Apps, or add a container from `cloudflare/cloudflared:latest` with **Post Arguments**:
   ```
   tunnel --no-autoupdate run --token YOUR_TOKEN
   ```
   The tunnel should turn **Healthy** in the dashboard.
3. In the tunnel, add a **Public Hostname**:
   - Subdomain `edc`, domain `yourdomain.com`
   - Service type **HTTP**, URL `UNRAID-IP:8787`
4. Open `https://edc.yourdomain.com/api/health` on your phone (mobile data, not Wi-Fi) to confirm it's reachable.

Leave Cloudflare Access, "Under Attack" mode and bot challenges **off for this hostname**. The app can't solve browser challenges, so sync would fail. The server sets no-cache headers, so Cloudflare won't cache crew data.

The Cloudflare dashboard gets reorganized now and then, so menu names may differ slightly from the ones above.

## 4. Use it in the app

1. **Crew** tab → enter your name → **Live sync** → type `edc.yourdomain.com` → **Create**.
2. Tap **Invite friends** and send the link. Friends tap it, then **Open in EDC Planner**. They can also copy the link and tap **Paste** in their Crew tab.
3. That's it. Picks upload a couple of seconds after any change. Friends' picks refresh when the app opens and every minute while it's open. With no signal, the status turns orange and changes wait until there's a connection.

## Settings (advanced, in the Unraid template)

| Variable | Default | |
|---|---|---|
| `MAX_CREWS` | 500 | server-wide crew limit |
| `MAX_MEMBERS` | 40 | people per crew |
| `CREATE_PER_HOUR` | 10 | new crews per IP per hour |
| `RATE_PER_MIN` | 120 | API requests per IP per minute |
| `CREW_TTL_DAYS` | 60 | delete crews unused this long |
| `LOC_TTL_MIN` | 120 | forget a shared location after this many minutes |

## Develop

```bash
node server.js          # PORT=8787 DATA_DIR=/data by default
node test.js            # starts a throwaway server and runs the API tests
```
