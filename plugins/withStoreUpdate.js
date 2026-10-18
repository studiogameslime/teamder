const { withDangerousMod, withMainApplication, withAppBuildGradle } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');
const REGISTER = 'com.studiogameslime.soccerapp.storeupdate.StoreUpdatePackage()';
const DEPENDENCY = 'com.google.android.play:app-update:2.1.0';

module.exports = function withStoreUpdate(config) {
  config = withAppBuildGradle(config, cfg => {
    if (!cfg.modResults.contents.includes(DEPENDENCY)) {
      if (!cfg.modResults.contents.includes('dependencies {')) throw new Error('Store update: Gradle dependencies block missing');
      cfg.modResults.contents = cfg.modResults.contents.replace('dependencies {', `dependencies {\n    implementation("${DEPENDENCY}")`);
    }
    return cfg;
  });
  config = withMainApplication(config, cfg => {
    if (!cfg.modResults.contents.includes(REGISTER)) {
      const anchor = 'val packages = PackageList(this).packages';
      if (!cfg.modResults.contents.includes(anchor)) throw new Error('Store update: package registration anchor missing');
      cfg.modResults.contents = cfg.modResults.contents.replace(anchor, `${anchor}\n            packages.add(${REGISTER})`);
    }
    return cfg;
  });
  return withDangerousMod(config, ['android', cfg => {
    const dest = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/java/com/studiogameslime/soccerapp/storeupdate');
    fs.mkdirSync(dest, { recursive: true });
    for (const name of ['StoreUpdateModule.kt', 'StoreUpdatePackage.kt']) fs.copyFileSync(path.join(__dirname, 'store-update-src', name), path.join(dest, name));
    return cfg;
  }]);
};
