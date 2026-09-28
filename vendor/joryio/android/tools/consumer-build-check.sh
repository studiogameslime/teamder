#!/usr/bin/env bash
# Build the two modules THE WAY AN APP CONSUMES THEM: as projects of another
# Gradle build (`include ':joryio-sdk'` + projectDir), not as this repo's own
# root build. That is the arrangement two bugs slipped through (Teamder,
# 2026-09-28): the standalone build read this repo's gradle.properties and the
# consumer's did not. Needs JDK 17 and ANDROID_HOME, like the SDK itself.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp -R "$HERE/gradle" "$HERE/gradlew" "$TMP/"
# The app root's settings: the SDK's own pluginManagement block (plugin
# versions + the legacy kotlin-kapt mapping an app's classpath provides), then
# the two modules included the way an app includes them - by projectDir, under
# the names the React Native bridge uses.
sed -n '1,/^rootProject.name/p' "$HERE/settings.gradle.kts" | sed 's/^rootProject.name.*/rootProject.name = "consumer-app"/' > "$TMP/settings.gradle.kts"
cat >> "$TMP/settings.gradle.kts" <<SETTINGS
include(":joryio-sdk")
project(":joryio-sdk").projectDir = file("$HERE/joryio")
include(":joryio-sdk-ui")
project(":joryio-sdk-ui").projectDir = file("$HERE/joryio-ui")
SETTINGS
# A root build with NO joryioSdkVersion, the way an app's root looks.
printf 'android.useAndroidX=true\n' > "$TMP/gradle.properties"
cd "$TMP" && ./gradlew :joryio-sdk:compileReleaseKotlin :joryio-sdk-ui:compileReleaseKotlin --no-daemon -q
echo "consumer arrangement: both modules compile"
