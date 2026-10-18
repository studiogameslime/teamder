const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Keep ordinary preferences backed up, but never transport device-bound login material.
function backupDocuments(projectRoot, googleServicesFile) {
  const prefs = ['SecureStore.xml'];
  if (googleServicesFile) {
    const config = JSON.parse(fs.readFileSync(path.resolve(projectRoot, googleServicesFile), 'utf8'));
    for (const client of config.client ?? []) {
      const appId = client.client_info?.mobilesdk_app_id;
      if (typeof appId === 'string') prefs.push(`com.google.firebase.auth.api.Store.${Buffer.from('[DEFAULT]').toString('base64url')}+${Buffer.from(appId).toString('base64url')}.xml`);
    }
  }
  const excludes = prefs.map(p => `    <exclude domain="sharedpref" path="${p}" />`).join('\n');
  return {
    'auth_backup_rules.xml': `<?xml version="1.0" encoding="utf-8"?>\n<full-backup-content>\n${excludes}\n</full-backup-content>\n`,
    'auth_data_extraction_rules.xml': `<?xml version="1.0" encoding="utf-8"?>\n<data-extraction-rules>\n  <cloud-backup>\n${excludes}\n  </cloud-backup>\n  <device-transfer>\n${excludes}\n  </device-transfer>\n</data-extraction-rules>\n`,
  };
}
module.exports = config => {
  const googleServicesFile = config.android?.googleServicesFile;
  config = withAndroidManifest(config, mod => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    app.$['android:fullBackupContent'] = '@xml/auth_backup_rules';
    app.$['android:dataExtractionRules'] = '@xml/auth_data_extraction_rules';
    return mod;
  });
  return withDangerousMod(config, ['android', async mod => {
    const dir = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(backupDocuments(mod.modRequest.projectRoot, googleServicesFile)))
      fs.writeFileSync(path.join(dir, name), content);
    return mod;
  }]);
};
module.exports.backupDocuments = backupDocuments;
