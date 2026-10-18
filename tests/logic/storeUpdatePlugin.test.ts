jest.mock('@expo/config-plugins', () => ({
  withMainApplication: (config: any, action: any) => { config.main = action; return config; },
  withAppBuildGradle: (config: any, action: any) => { config.gradle = action; return config; },
  withDangerousMod: (config: any, [, action]: any) => { config.copy = action; return config; },
}));
const plugin = require('../../plugins/withStoreUpdate');
test('prebuild registers the actual package and pinned Play library once, preserving existing packages', () => {
  const config = plugin({});
  const main = { modResults: { contents: 'val packages = PackageList(this).packages\npackages.add(Existing())' } };
  config.main(main); config.main(main);
  expect(main.modResults.contents.match(/StoreUpdatePackage\(\)/g)).toHaveLength(1);
  expect(main.modResults.contents).toContain('packages.add(Existing())');
  const gradle = { modResults: { contents: 'dependencies {\nimplementation("existing")\n}' } };
  config.gradle(gradle); config.gradle(gradle);
  expect(gradle.modResults.contents.match(/app-update:2.1.0/g)).toHaveLength(1);
  expect(gradle.modResults.contents).toContain('implementation("existing")');
});
test('a changed native template fails visibly instead of silently shipping an absent bridge', () => {
  const config = plugin({});
  expect(() => config.main({ modResults: { contents: 'changed template' } })).toThrow('registration anchor missing');
  expect(() => config.gradle({ modResults: { contents: 'changed template' } })).toThrow('dependencies block missing');
});
