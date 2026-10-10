/** Official npm bridge and publisher native beta artifacts. */
const { withSettingsGradle, withProjectBuildGradle, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');
const VERSION = '1.3.0-beta.1';
const REPOSITORY = `../vendor/joryio/releases/android-${VERSION}`;
const MAVEN_MARKER = '// joryio-official-maven';

function removeSourceProjects(contents) {
  return contents
    .replace(/^\/\/ joryio-sdk[^\r\n]*\r?\n/gm, '')
    .replace(/^include ':joryio-sdk(?:-ui)?'\r?\n/gm, '')
    .replace(/^project\(':joryio-sdk(?:-ui)?'\)\.projectDir[^\r\n]*\r?\n?/gm, '');
}
function addOfficialRepository(contents) {
  if (contents.includes(MAVEN_MARKER)) return contents;
  const block = /allprojects\s*\{\s*repositories\s*\{/;
  if (!block.test(contents)) throw new Error('withJoryioSdk: repositories block missing');
  return contents.replace(block, (match) => `${match}\n        ${MAVEN_MARKER}\n        maven { url = uri(new File(rootDir, '${REPOSITORY}')) }`);
}
function useOfficialPod(contents) {
  // Replace the old path override, including during incremental prebuild.
  const clean = contents
    .replace(/^[ \t]*# joryio-sdk[^\r\n]*\r?\n/gm, '')
    .replace(/^[ \t]*pod 'Joryio',[^\r\n]*\r?\n/gm, '');
  const target = /target '([^']+)' do\r?\n/;
  if (!target.test(clean)) throw new Error('withJoryioSdk: app target missing');
  return clean.replace(target, (match) => `${match}  # joryio-sdk — official ${VERSION}\n  pod 'Joryio', :git => 'https://github.com/joryio/joryio-ios-sdk.git', :tag => '${VERSION}', :subspecs => ['Core', 'UI']\n`);
}
module.exports = function withJoryioSdk(config) {
  config = withSettingsGradle(config, (cfg) => {
    cfg.modResults.contents = removeSourceProjects(cfg.modResults.contents);
    return cfg;
  });
  config = withProjectBuildGradle(config, (cfg) => {
    cfg.modResults.contents = addOfficialRepository(cfg.modResults.contents);
    return cfg;
  });
  return withDangerousMod(config, ['ios', (cfg) => {
    const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
    fs.writeFileSync(podfile, useOfficialPod(fs.readFileSync(podfile, 'utf8')));
    return cfg;
  }]);
};
module.exports.removeSourceProjects = removeSourceProjects;
module.exports.addOfficialRepository = addOfficialRepository;
module.exports.useOfficialPod = useOfficialPod;
