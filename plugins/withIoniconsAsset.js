// withIoniconsAsset — config plugin that copies the Ionicons.ttf
// from @expo/vector-icons into android/app/src/main/assets/fonts as
// `ionicons.ttf` (lowercase). React Native auto-registers any TTF in
// that folder under its filename, and @expo/vector-icons internally
// resolves the Ionicons set via `createIconSet(glyphMap, 'ionicons',
// font)` — i.e. it asks RN for a fontFamily named "ionicons" (all
// lowercase). The package's default file is "Ionicons.ttf" (capital
// I), so without this rename the font registers under the wrong name
// and every <Ionicons /> glyph renders as a blank box on SDK 53.
//
// The standard escape hatch on older SDKs was the `expo-font` plugin's
// `fonts` array, but SDK 53 ships a version of `expo-asset` whose
// `downloadAsync` relies on the legacy `AppDirectoriesModuleInterface`
// that `expo-file-system@18` no longer provides, so the runtime
// `useFonts(Ionicons.font)` path also fails. Embedding the file at
// prebuild time with the correct name sidesteps both issues.

const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('expo/config-plugins');

const SOURCE = path.join(
  'node_modules',
  '@expo',
  'vector-icons',
  'build',
  'vendor',
  'react-native-vector-icons',
  'Fonts',
  'Ionicons.ttf',
);
const DEST_REL = path.join('app', 'src', 'main', 'assets', 'fonts', 'ionicons.ttf');

function withIoniconsAsset(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const platformRoot = cfg.modRequest.platformProjectRoot;
      const src = path.join(projectRoot, SOURCE);
      const dest = path.join(platformRoot, DEST_REL);
      if (!fs.existsSync(src)) {
        // Don't fail prebuild if @expo/vector-icons hasn't been
        // installed yet — npm install will reinstall it and the next
        // prebuild will land the font.
        // eslint-disable-next-line no-console
        console.warn(`[withIoniconsAsset] source font not found: ${src}`);
        return cfg;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      // eslint-disable-next-line no-console
      console.log(`[withIoniconsAsset] copied → ${dest}`);
      return cfg;
    },
  ]);
}

module.exports = withIoniconsAsset;
