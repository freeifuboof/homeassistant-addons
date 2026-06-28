#!/bin/sh
set -eu

CONFIG_PATH="/data/options.json"
SESSION_DIR="/config"
SESSION_FILE="${SESSION_DIR}/session.json"

get_json() {
  node -e "const fs=require('fs'); const cfg=JSON.parse(fs.readFileSync('${CONFIG_PATH}','utf8')); const v=cfg[process.argv[1]]; if (v !== undefined && v !== null) process.stdout.write(String(v));" "$1"
}

export M2M_MYSA_USERNAME="$(get_json mysa_username)"
export M2M_MYSA_PASSWORD="$(get_json mysa_password)"
export M2M_MQTT_HOST="$(get_json mqtt_host)"
export M2M_MQTT_PORT="$(get_json mqtt_port)"
export M2M_MQTT_USERNAME="$(get_json mqtt_username)"
export M2M_MQTT_PASSWORD="$(get_json mqtt_password)"
export M2M_MQTT_TOPIC_PREFIX="$(get_json mqtt_topic_prefix)"
export M2M_MQTT_CLIENT_NAME="$(get_json mqtt_client_name)"
export M2M_TEMPERATURE_UNIT="$(get_json temperature_unit)"
export M2M_LOG_LEVEL="$(get_json log_level)"
export M2M_LOG_FORMAT="$(get_json log_format)"
export M2M_MYSA_SESSION_FILE="${SESSION_FILE}"

if [ -z "${M2M_MYSA_USERNAME}" ] || [ -z "${M2M_MYSA_PASSWORD}" ]; then
  echo "FATAL: Mysa username and password are required."
  exit 1
fi

if [ -z "${M2M_MQTT_HOST}" ]; then
  echo "FATAL: MQTT host is required."
  exit 1
fi

mkdir -p "${SESSION_DIR}"

echo "INFO: Starting mysa2mqtt..."
echo "INFO: Node version: $(node -v)"
echo "INFO: MQTT broker: ${M2M_MQTT_HOST}:${M2M_MQTT_PORT}"
echo "INFO: MQTT topic prefix: ${M2M_MQTT_TOPIC_PREFIX}"
echo "INFO: Temperature unit: ${M2M_TEMPERATURE_UNIT}"

exec mysa2mqtt
