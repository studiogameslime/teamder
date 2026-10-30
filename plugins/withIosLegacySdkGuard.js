// Temporary compatibility gate for Expo SDK 53's application lifecycle.
// iOS 27 terminates SDK-27-linked apps without UIScene adoption at launch.
// Pinning an EAS image alone does not protect builds made on a local Mac.
const { withXcodeProject } = require('expo/config-plugins');

const PHASE_NAME = '[Teamder] Verify iOS lifecycle compatibility';
const SCRIPT = `set -eu
if [ -z "\${SDKROOT:-}" ]; then
  echo "error: Teamder cannot verify the selected SDK: SDKROOT is missing." >&2
  exit 1
fi
if ! sdk_version="$(xcrun --sdk "$SDKROOT" --show-sdk-version)"; then
  echo "error: Teamder could not read the selected SDK version." >&2
  exit 1
fi
sdk_major="\${sdk_version%%.*}"
case "$sdk_major" in
  ''|*[!0-9]*)
    echo "error: Teamder received an invalid SDK version: $sdk_version" >&2
    exit 1 ;;
esac
if [ "$sdk_major" -ge 27 ]; then
  echo "error: Teamder's current native lifecycle cannot be linked with SDK $sdk_version. Select Xcode 26 with an iOS 26 SDK, regenerate the native project and rebuild. SDK 27 requires a complete UIScene migration; adding a scene manifest alone is not sufficient." >&2
  exit 1
fi
echo "Teamder lifecycle compatibility: selected SDK $sdk_version is below 27. Device launch still requires verification."
`;

function addGuard(project) {
  const app = project.getTarget('com.apple.product-type.application');
  if (!app) throw new Error('withIosLegacySdkGuard: application target missing');
  const phases = project.hash.project.objects.PBXShellScriptBuildPhase || {};
  const existing = app.target.buildPhases.filter(ref => phases[ref.value]?.name === JSON.stringify(PHASE_NAME));
  if (existing.length > 1) throw new Error('withIosLegacySdkGuard: duplicate guard phases');
  let ref = existing[0];
  if (!ref) {
    const added = project.addBuildPhase([], 'PBXShellScriptBuildPhase', PHASE_NAME, app.uuid, {
      shellPath: '/bin/sh', shellScript: SCRIPT.replace(/\n/g, '\\n'),
    });
    ref = { value: added.uuid, comment: PHASE_NAME };
  }
  const phase = project.hash.project.objects.PBXShellScriptBuildPhase[ref.value];
  phase.shellPath = '/bin/sh';
  phase.shellScript = JSON.stringify(SCRIPT);
  // No outputs: always verify the active toolchain, including incremental builds.
  phase.alwaysOutOfDate = 1;
  app.target.buildPhases = [ref, ...app.target.buildPhases.filter(item => item.value !== ref.value)];
  return project;
}

module.exports = config => withXcodeProject(config, cfg => {
  cfg.modResults = addGuard(cfg.modResults);
  return cfg;
});
module.exports.addGuard = addGuard;
module.exports.SCRIPT = SCRIPT;
module.exports.PHASE_NAME = PHASE_NAME;
