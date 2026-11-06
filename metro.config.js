const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Metro does not include a local Babel plugin's source in its transform key.
// A cached module from before interaction tracking would otherwise stay silent.
const fs = require('fs');
const crypto = require('crypto');
const controlsVersion = crypto.createHash('sha256');
for (const file of ['./scripts/analytics/control-plugin.cjs','./scripts/analytics/control-sites.cjs','./scripts/analytics/actor-plugin.cjs']) {
  controlsVersion.update(fs.readFileSync(require.resolve(file)));
}
config.cacheVersion = (config.cacheVersion || '') + ':control:' + controlsVersion.digest('hex');
const existing = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
  // Release source snapshots and tooling are not application modules.
  /[/\\]artifacts[/\\].*/,
  /[/\\]\.codex-remote-attachments[/\\].*/,
  // Local QA helpers and generated media are never app modules. Watching
  // these trees can keep Metro busy while audits emit files and block reloads.
  /[/\\](?:tmp|out|output)[/\\].*/,
  // Native dependency build outputs are not JS sources. On Windows, watching
  // expo-constants/android/build generated assets caused a continuous event loop.
  /[/\\]node_modules[/\\](?:@[^/\\]+[/\\])?[^/\\]+[/\\]android[/\\]build(?:[/\\]|$)/,
];

module.exports = config;
