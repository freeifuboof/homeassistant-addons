#!/usr/bin/env bash
# Builds a signed EDC Planner APK without Android Studio / Gradle.
# Needs: JDK 17+, aapt, dalvik-exchange (dx), zipalign, apksigner (Debian/Ubuntu: apt install aapt dalvik-exchange zipalign apksigner)
# and an android.jar (API 31 — newer ones use a resource format this aapt cannot read) — pass its path as ANDROID_JAR or put it at build/android.jar.
set -euo pipefail
cd "$(dirname "$0")"

ANDROID_JAR="${ANDROID_JAR:-build/android.jar}"
OUT=build
APK_NAME="EDC-Planner.apk"
mkdir -p "$OUT"
if [ ! -f "$ANDROID_JAR" ]; then
  echo "Downloading android.jar (API 31)…"
  curl -fsSL -o "$ANDROID_JAR" https://raw.githubusercontent.com/Sable/android-platforms/master/android-31/android.jar
fi

rm -rf "$OUT/gen" "$OUT/classes" "$OUT/dex" "$OUT"/*.apk
mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex"

echo "1/5 resources"
aapt package -f -m -J "$OUT/gen" -M AndroidManifest.xml -S res -I "$ANDROID_JAR" \
  --min-sdk-version 26 --target-sdk-version 34

echo "2/5 compile"
javac -nowarn -Xlint:-options -source 8 -target 8 -encoding UTF-8 \
  -bootclasspath "$ANDROID_JAR" -d "$OUT/classes" \
  $(find src "$OUT/gen" -name '*.java')

echo "3/5 dex"
dalvik-exchange --dex --min-sdk-version=26 --output="$OUT/dex/classes.dex" "$OUT/classes"

echo "4/5 package"
aapt package -f -M AndroidManifest.xml -S res -A assets -I "$ANDROID_JAR" \
  --min-sdk-version 26 --target-sdk-version 34 -F "$OUT/unsigned.apk"
(cd "$OUT/dex" && aapt add ../unsigned.apk classes.dex >/dev/null)
zipalign -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

echo "5/5 sign"
KS="${KEYSTORE:-keystore/edc-planner.jks}"
if [ ! -f "$KS" ]; then
  mkdir -p "$(dirname "$KS")"
  keytool -genkeypair -keystore "$KS" -alias edcplanner -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass edcplanner -keypass edcplanner -dname "CN=EDC Planner" >/dev/null 2>&1
fi
apksigner sign --ks "$KS" --ks-pass pass:edcplanner --key-pass pass:edcplanner \
  --out "$APK_NAME" "$OUT/aligned.apk"
apksigner verify "$APK_NAME"
echo "Built $(pwd)/$APK_NAME ($(du -h "$APK_NAME" | cut -f1))"
