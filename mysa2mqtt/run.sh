#!/usr/bin/with-contenv bashio
set -e

MYSA_USERNAME="$(bashio::config 'mysa_username')"
MYSA_PASSWORD="$(bashio::config 'mysa_password')"
MQTT_HOST="$(bashio::config 'mqtt_host')"
MQTT_PORT="$(bashio::config 'mqtt_port')"
MQTT_USERNAME="$(bashio::config 'mqtt_username')"
MQTT_PASSWORD="$(bashio::config 'mqtt_password')"
MQTT_BASE_TOPIC="$(bashio::config 'mqtt_base_topic')"
HA_DISCOVERY="$(bashio::config 'homeassistant_discovery')"
DISCOVERY_PREFIX="$(bashio::config 'discovery_prefix')"
LOG_LEVEL="$(bashio::config 'log_level')"

if [[ -z "$MYSA_USERNAME" || -z "$MYSA_PASSWORD" ]]; then
  bashio::log.fatal "Mysa username and password are required."
  exit 1
fi

# Create a config file inside the add-on config area.
CONFIG_FILE="/config/mysa2mqtt.json"
cat > "$CONFIG_FILE" <<JSON
{
  "mysa": {
    "username": "$MYSA_USERNAME",
    "password": "$MYSA_PASSWORD"
  },
  "mqtt": {
    "host": "$MQTT_HOST",
    "port": $MQTT_PORT,
    "username": "$MQTT_USERNAME",
    "password": "$MQTT_PASSWORD",
    "baseTopic": "$MQTT_BASE_TOPIC"
  },
  "homeassistant": {
    "discovery": $HA_DISCOVERY,
    "discoveryPrefix": "$DISCOVERY_PREFIX"
  },
  "logLevel": "$LOG_LEVEL"
}
JSON

bashio::log.info "Starting mysa2mqtt..."
bashio::log.info "MQTT broker: ${MQTT_HOST}:${MQTT_PORT}"

# Try common startup formats. If the package changes command syntax, logs will show the failure.
exec mysa2mqtt --config "$CONFIG_FILE"
