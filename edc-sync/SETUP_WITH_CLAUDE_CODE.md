# Brief for Claude Code: deploy edc-sync on Unraid

You're running on the owner's Windows PC (PowerShell). The PC can reach their Unraid server.
Goal: get `edc-sync` (this folder) running on Unraid, reachable at `https://edc.<their domain>` through a Cloudflare Tunnel, so the EDC Planner Android app can use it for live crew sync.

Read `edc-sync/README.md` first. It's the human version of these steps. The server is `edc-sync/server.js` with tests in `edc-sync/test.js`.

## Ask the owner before starting
1. The Unraid server's IP or hostname, and how to SSH in (usually `ssh root@<ip>`; SSH is under Unraid Settings → Management Access).
2. The subdomain to use (suggest `edc`) and their Cloudflare domain.
3. Whether they already run `cloudflared` on Unraid (reuse that tunnel) or need a new one.

## Steps
1. **Check access**: `ssh root@<ip> "docker ps --format '{{.Names}}'"`. Note the existing containers. Don't change or restart any of them without asking.
2. **Image**. Try the published one first: `docker pull ghcr.io/freeifuboof/edc-sync:latest` on Unraid. If that fails (not published, or private), build it on Unraid:
   ```
   cd /mnt/user/appdata && git clone -b claude/samsung-apk-build-a9n19a https://github.com/freeifuboof/homeassistant-addons edc-src
   docker build -t edc-sync /mnt/user/appdata/edc-src/edc-sync
   ```
   (If `edc-src` already exists, `git -C /mnt/user/appdata/edc-src pull` instead of cloning.)
3. **Template**: copy `edc-sync/edc-sync.xml` to `/boot/config/plugins/dockerMan/templates-user/my-edc-sync.xml`. If you built locally, set `<Repository>` to `edc-sync`. Then tell the owner to open Docker → Add Container → template **edc-sync** → Apply. Containers created from the Unraid UI show up properly in its Docker tab. If they'd rather you do it, run the equivalent:
   ```
   docker run -d --name edc-sync --restart unless-stopped -p 8787:8787 -v /mnt/user/appdata/edc-sync:/data <image>
   ```
   Check that port 8787 is free first (`docker ps`, `ss -ltn`). If it's taken, pick another host port and use it everywhere below.
4. **Verify locally**: `curl http://<ip>:8787/api/health` should return `{"ok":true,...}`.
5. **Cloudflare Tunnel**. The owner does the dashboard part: Zero Trust → Networks → Tunnels → create (or reuse) → copy the token. **Have the owner paste the token into Unraid themselves**, or keep it out of logs and files in the repo. Run cloudflared on Unraid (Community Apps "cloudflared", or `cloudflare/cloudflared:latest` with args `tunnel --no-autoupdate run --token <token>`, restart unless-stopped). The owner adds a Public Hostname `edc.<domain>` → HTTP → `<unraid-ip>:8787`.
6. **Verify publicly**: `curl https://edc.<domain>/api/health` from the PC, then `curl -X POST https://edc.<domain>/api/crews -H "Content-Type: application/json" -d "{}"` should return a token. That creates a throwaway crew, which is fine; it expires after 60 days. If it returns an HTML challenge page or a 403, tell the owner to turn off bot challenges, Under Attack mode and Access for that hostname.
7. **Finish**: tell the owner to open EDC Planner → Crew → enter their name → Live sync → `edc.<domain>` → Create, then Invite friends.

## Rules
- Only expose `edc-sync`. Never expose the Unraid web UI or other services through the tunnel.
- Don't put secrets (tunnel token, passwords) into files in this repo or into commits.
- Ask before deleting or replacing anything that already exists on the server.
- Report at the end: image source used, container name and port, tunnel hostname, and the results of the health and crew checks.
