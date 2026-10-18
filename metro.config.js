const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
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
