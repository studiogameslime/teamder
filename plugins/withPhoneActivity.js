const { withAndroidManifest, withMainApplication, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');
module.exports = function withPhoneActivity(config) {
  if (!require('../src/config/sportsActivity.json').enabled) return config;
  config = withAndroidManifest(config, cfg => {
    const manifest = cfg.modResults.manifest;
    manifest['uses-permission'] ||= [];
    for (const permission of ['FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION']) {
      const name = `android.permission.${permission}`;
      if (!manifest['uses-permission'].some(item => item.$['android:name'] === name)) manifest['uses-permission'].push({ $: { 'android:name': name } });
    }
    const app = manifest.application[0];
    app.service ||= [];
    const name = 'com.studiogameslime.soccerapp.phoneactivity.PhoneActivityService';
    if (!app.service.some(item => item.$['android:name'] === name)) app.service.push({ $: {
      'android:name': name, 'android:exported': 'false', 'android:foregroundServiceType': 'location', 'android:stopWithTask': 'true',
    } });
    return cfg;
  });
  config = withMainApplication(config, cfg => {
    const registration = 'packages.add(com.studiogameslime.soccerapp.phoneactivity.PhoneActivityPackage())';
    const anchor = 'val packages = PackageList(this).packages';
    if (!cfg.modResults.contents.includes(registration)) {
      if (!cfg.modResults.contents.includes(anchor)) throw Error('Phone activity registration anchor missing');
      cfg.modResults.contents = cfg.modResults.contents.replace(anchor, `${anchor}\n            ${registration}`);
    }
    return cfg;
  });
  return withDangerousMod(config, ['android', cfg => {
    const dest = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/java/com/studiogameslime/soccerapp/phoneactivity');
    fs.mkdirSync(dest, { recursive: true });
    for (const name of ['PhoneMovement.kt', 'PhoneActivityService.kt', 'PhoneActivityModule.kt']) fs.copyFileSync(path.join(__dirname, 'phone-activity-src', name), path.join(dest, name));
    return cfg;
  }]);
};
