const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const existing = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
  // Release source snapshots and tooling are not application modules.
  /[/\\]artifacts[/\\].*/,
  /[/\\]\.codex-remote-attachments[/\\].*/,
];

module.exports = config;
