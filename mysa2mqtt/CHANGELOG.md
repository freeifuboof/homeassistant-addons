# Changelog

## 1.2.0

- Upgrade to mysa2mqtt 3.2.7 on Node 24. The add-on now signs in with your
  Mysa credentials instead of a saved session, so it no longer crashes with
  "Refresh Token has expired" after the session ages out.
- Drop the persisted `session.json`.
- MQTT discovery topics for rooms with spaces or punctuation change in this
  version (e.g. `Living-Room` becomes `Living-20Room`). Entity IDs are
  unchanged, but delete the stale retained `homeassistant/.../config` topics so
  Home Assistant doesn't keep the old copies.
- The "Current power" sensor is removed for thermostats that can't report it.
