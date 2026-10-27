// Android-only, read-only Health Connect integration. No iOS capabilities.
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withMainActivity, withDangerousMod, AndroidConfig } = require('expo/config-plugins');
const HC_READ_PERMISSIONS = ['DISTANCE', 'STEPS', 'SPEED', 'ACTIVE_CALORIES_BURNED']
  .map(type => `android.permission.health.READ_${type}`);

function withHealth(config) {
  if (!require('../src/config/sportsActivity.json').enabled) return config;
  config = withAndroidManifest(config, cfg => {
    const manifest = cfg.modResults.manifest;
    manifest['uses-permission'] ??= [];
    for (const name of HC_READ_PERMISSIONS) {
      if (!manifest['uses-permission'].some(p => p.$['android:name'] === name)) {
        manifest['uses-permission'].push({ $: { 'android:name': name } });
      }
    }
    manifest.queries ??= [];
    if (!manifest.queries.some(q => q.package?.some(p => p.$['android:name'] === 'com.google.android.apps.healthdata'))) {
      manifest.queries.push({ package: [{ $: { 'android:name': 'com.google.android.apps.healthdata' } }] });
    }
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.activity ??= [];
    const name = '.HealthPermissionsRationaleActivity';
    app.activity = app.activity.filter(a => a.$['android:name'] !== name);
    app.activity.push({ $: { 'android:name': name, 'android:exported': 'true' },
      'intent-filter': [{ action: [{ $: { 'android:name': 'androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE' } }] }] });
    app['activity-alias'] ??= [];
    app['activity-alias'] = app['activity-alias'].filter(a => a.$['android:name'] !== '.ViewHealthPermissionUsageActivity');
    app['activity-alias'].push({ $: { 'android:name': '.ViewHealthPermissionUsageActivity',
      'android:exported': 'true', 'android:targetActivity': name,
      'android:permission': 'android.permission.START_VIEW_PERMISSION_USAGE' },
      'intent-filter': [{ action: [{ $: { 'android:name': 'android.intent.action.VIEW_PERMISSION_USAGE' } }],
        category: [{ $: { 'android:name': 'android.intent.category.HEALTH_PERMISSIONS' } }] }] });
    return cfg;
  });
  config = withMainActivity(config, cfg => {
    if (cfg.modResults.language !== 'kt') throw new Error('Health Connect requires Kotlin MainActivity');
    let source = cfg.modResults.contents;
    const delegate = 'HealthConnectPermissionDelegate.setPermissionDelegate(this)';
    if (!source.includes(delegate)) {
      const onCreate = /super\.onCreate\([^\n]*\)/;
      if (!onCreate.test(source)) throw new Error('Missing MainActivity onCreate');
      source = source.replace(onCreate, call => `${call}\n    ${delegate}`);
      source = source.replace(/^(package [^\n]+\n)/, '$1import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate\n');
    }
    cfg.modResults.contents = source;
    return cfg;
  });
  return withDangerousMod(config, ['android', async cfg => {
    const packageName = cfg.android.package;
    const folder = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/java', ...packageName.split('.'));
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'HealthPermissionsRationaleActivity.kt'), `package ${packageName}

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.TextView

/** The same policy URL as the Play listing, independent of login and React startup. */
class HealthPermissionsRationaleActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val policy = "https://teamderfc.web.app/privacy"
    try {
      startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(policy)))
      finish()
    } catch (_: ActivityNotFoundException) {
      setContentView(TextView(this).apply {
        text = "מדיניות הפרטיות זמינה בכתובת:\\n" + policy
        textSize = 18f
        setPadding(32, 48, 32, 48)
        setTextIsSelectable(true)
      })
    }
  }
}
`);
    return cfg;
  }]);
}
module.exports = withHealth;
