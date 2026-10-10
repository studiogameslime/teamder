import fs from 'fs';
import path from 'path';

const { assertStableScene, verifyInstalled } = require('../../scripts/verify-native-stack-scene.cjs');
const root = path.resolve(__dirname, '../..');
const installed = path.join(root, 'node_modules/@react-navigation/native-stack/src/views/NativeStackView.native.tsx');
const source = () => fs.readFileSync(installed, 'utf8');

test('the exact native entry and pinned installed scene pass the build-time guard', () => {
  expect(() => verifyInstalled(root)).not.toThrow();
});

test('the original focus-dependent flattening source fails the guard', () => {
  const before = source().replace(/\s+collapsable=\{false\}/, '');
  expect(() => assertStableScene(before)).toThrow(/must have collapsable/);
});

test('stabilizing the content child does not pass as stabilizing the actual scene ancestor', () => {
  const wrongParent = `<View importantForAccessibility={focused ? 'auto' : 'no-hide-descendants'} style={styles.scene}>
    <View collapsable={false} />
  </View>`;
  expect(() => assertStableScene(wrongParent)).toThrow(/must have collapsable/);
});

test('an ambiguous duplicated scene is rejected instead of silently checking the first match', () => {
  expect(() => assertStableScene(source() + source())).toThrow(/exactly one/);
});

test('a dependency version change requires explicit patch revalidation', () => {
  const read = jest.spyOn(fs, 'readFileSync').mockImplementationOnce(() => JSON.stringify({ version: '6.12.0', 'react-native': 'src/index.tsx' }));
  try { expect(() => verifyInstalled(root)).toThrow(/version changed/); }
  finally { read.mockRestore(); }
});

test('postinstall applies patches before checking the scene and no temporary fault/provider remains', () => {
  const postinstall = fs.readFileSync(path.join(root, 'scripts/postinstall.cjs'), 'utf8');
  expect(postinstall.indexOf("require.resolve('patch-package')")).toBeGreaterThan(-1);
  expect(postinstall.indexOf('verify-native-stack-scene.cjs')).toBeGreaterThan(postinstall.indexOf("require.resolve('patch-package')"));
  const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
  const chat = fs.readFileSync(path.join(root, 'src/screens/chat/CommunityChatScreen.tsx'), 'utf8');
  expect(app).not.toContain('StableNativeScreens');
  expect(chat).not.toMatch(/QA_RA01_CONTROLLED_FAULT|ra01ControlledFault/);
});
