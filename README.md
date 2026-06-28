# Mysa2MQTT Home Assistant Add-on

Custom Home Assistant OS add-on for running `mysa2mqtt` separately from an Unraid/Plex server.

## Install

1. Upload this repo to GitHub.
2. In Home Assistant, go to **Settings → Add-ons → Add-on Store**.
3. Open the three-dot menu → **Repositories**.
4. Add your repository URL.
5. Install **Mysa2MQTT**.
6. Configure your Mysa login and MQTT settings.
7. Start the add-on.

## Default MQTT

If using the Mosquitto broker add-on, the default host is usually:

```text
core-mosquitto
```

Port:

```text
1883
```

## Important

The add-on assumes the npm command supports:

```bash
mysa2mqtt --config /config/mysa2mqtt.json
```

If the package uses different flags, edit `run.sh` to match the package documentation.
