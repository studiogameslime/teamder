import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = join(__dirname, '..', '..');
const sdkRoot = dirname(require.resolve('@react-native-firebase/crashlytics/package.json'));
const appConfig = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo;
const flags = JSON.parse(readFileSync(join(root, 'firebase.json'), 'utf8'))['react-native'];

/** Execute each published SDK entry with native and handler boundaries mocked.
 * This tests the installed patch's behavior, without loading a native runtime. */
function loadSdk(file: string, automaticJs = false) {
  const native = {
    isErrorGenerationOnJSCrashEnabled: automaticJs,
    isCrashlyticsCollectionEnabled: true,
    recordError: jest.fn((_error: unknown): unknown => undefined),
  };
  const fromError = jest.fn((_error: Error, _options: unknown): Promise<unknown[]> => Promise.resolve([]));
  const globalHandler = jest.fn();
  const rejectionHandler = jest.fn();
  let ModuleClass: any;
  const handlers = {
    setGlobalErrorHandler: globalHandler,
    setOnUnhandledPromiseRejectionHandler: rejectionHandler,
    createNativeErrorObj: (error: Error, frames: unknown[], isUnhandledRejection: boolean, name?: string) => ({ error, frames, isUnhandledRejection, name }),
  };
  const dependencies: Record<string, unknown> = {
    '@react-native-firebase/app': { getApp: jest.fn() },
    '@react-native-firebase/app/dist/module/common': {
      isOther: true,
      isError: (value: unknown) => value instanceof Error,
      isBoolean: (value: unknown) => typeof value === 'boolean',
      isObject: (value: unknown) => typeof value === 'object',
      isString: (value: unknown) => typeof value === 'string',
    },
    '@react-native-firebase/app/dist/module/internal': {
      FirebaseModule: class { native = native; },
      createModuleNamespace: (config: { ModuleClass: unknown }) => { ModuleClass = config.ModuleClass; return jest.fn(); },
      getFirebaseRoot: () => ({}),
    },
    'stacktrace-js': { __esModule: true, default: { fromError } },
    './handlers': handlers,
    './handlers.js': handlers,
    './version': { version: '24.0.0' },
    './version.js': { version: '24.0.0' },
  };
  const compiled = ts.transpileModule(readFileSync(join(sdkRoot, file), 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  vm.runInNewContext(compiled.outputText, {
    exports: {}, console,
    require: (id: string) => {
      if (!(id in dependencies)) throw new Error(`Unexpected SDK dependency: ${id}`);
      return dependencies[id];
    },
  }, { filename: file });
  return { sdk: new ModuleClass(), native, fromError, globalHandler, rejectionHandler };
}

const drainReporting = () => new Promise<void>(resolve => setImmediate(resolve));

describe.each(['lib/namespaced.ts', 'dist/module/namespaced.js'])('patched SDK %s', file => {
  test('disables both raw JS reporters while preserving collection and manual reports', async () => {
    const { sdk, native, fromError, globalHandler, rejectionHandler } = loadSdk(file, flags.crashlytics_is_error_generation_on_js_crash_enabled);
    expect(globalHandler).not.toHaveBeenCalled();
    expect(rejectionHandler).not.toHaveBeenCalled();
    expect(sdk.isCrashlyticsCollectionEnabled).toBe(true);
    const error = new Error('sanitized failure');
    const frames = [{ fileName: 'src/services/gameService.ts', lineNumber: 12 }];
    fromError.mockResolvedValueOnce(frames);
    sdk.recordError(error, 'games.load');
    await drainReporting();
    expect(fromError).toHaveBeenCalledWith(error, { offline: true });
    expect(native.recordError).toHaveBeenCalledTimes(1);
    expect(native.recordError).toHaveBeenCalledWith({ error, frames, isUnhandledRejection: false, name: 'games.load' });
  });

  test('retains both upstream reporters when automatic JS generation is explicitly enabled', () => {
    const { native, globalHandler, rejectionHandler } = loadSdk(file, true);
    expect(globalHandler).toHaveBeenCalledTimes(1);
    expect(globalHandler).toHaveBeenCalledWith(native);
    expect(rejectionHandler).toHaveBeenCalledTimes(1);
    expect(rejectionHandler).toHaveBeenCalledWith(native);
  });

  test('still sends a manual error if stack parsing rejects', async () => {
    const { sdk, native, fromError } = loadSdk(file);
    fromError.mockRejectedValueOnce(new Error('stack parser unavailable'));
    const error = new Error('sanitized failure');
    sdk.recordError(error, 'games.load');
    await drainReporting();
    expect(native.recordError).toHaveBeenCalledWith({ error, frames: [], isUnhandledRejection: false, name: 'games.load' });
  });

  test.each(['throw', 'reject'])('contains a native reporting %s without an unhandled rejection', async failure => {
    const { sdk, native } = loadSdk(file);
    native.recordError.mockImplementationOnce(() => {
      if (failure === 'throw') throw new Error('bridge unavailable');
      return Promise.reject(new Error('bridge unavailable'));
    });
    expect(() => sdk.recordError(new Error('sanitized failure'))).not.toThrow();
    // Jest fails on an unhandled rejection during this turn if the SDK fails to consume it.
    await drainReporting();
    expect(native.recordError).toHaveBeenCalledTimes(1);
  });
});

test('loads the Crashlytics plugin after app and uses supported native collection flags', () => {
  const plugins = appConfig.plugins.map((plugin: string | [string, unknown]) => typeof plugin === 'string' ? plugin : plugin[0]);
  expect(plugins.filter((plugin: string) => plugin === '@react-native-firebase/crashlytics')).toHaveLength(1);
  expect(plugins.indexOf('@react-native-firebase/app')).toBeGreaterThanOrEqual(0);
  expect(plugins.indexOf('@react-native-firebase/crashlytics')).toBeGreaterThan(plugins.indexOf('@react-native-firebase/app'));
  expect(flags).toMatchObject({
    crashlytics_auto_collection_enabled: true,
    crashlytics_debug_enabled: false,
    crashlytics_is_error_generation_on_js_crash_enabled: false,
    crashlytics_javascript_exception_handler_chaining_enabled: true,
    crashlytics_ndk_enabled: true,
  });
  const schema = JSON.parse(readFileSync(join(dirname(require.resolve('@react-native-firebase/app/package.json')), 'firebase-schema.json'), 'utf8'));
  for (const [key, value] of Object.entries(flags).filter(([key]) => key.startsWith('crashlytics_'))) {
    expect(schema.properties['react-native'].properties[key]?.type).toBe(typeof value);
  }
  const buildProperties = appConfig.plugins.find((plugin: unknown) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties');
  expect(buildProperties[1].ios.useFrameworks).toBe('static');
});

describe('real Expo Android plugin actions in memory', () => {
  async function transform(modName: string, contents: string) {
    const plugin = require(join(sdkRoot, 'app.plugin.js')).default;
    const config = plugin({ name: 'Teamder', slug: 'soccer-game', _internal: { projectRoot: root } });
    const result = await config.mods.android[modName]({
      name: 'Teamder', slug: 'soccer-game',
      modResults: { language: 'groovy', contents },
      modRequest: { projectRoot: root, platformProjectRoot: join(root, 'android'), platform: 'android', modName },
    });
    return result.modResults.contents as string;
  }

  test('adds the shared Crashlytics Gradle dependency once and preserves existing dependencies', async () => {
    const original = 'buildscript {\n dependencies {\n classpath("com.android.tools.build:gradle:8.4.0")\n }\n}\n';
    const transformed = await transform('projectBuildGradle', original);
    const version = require('@react-native-firebase/app/package.json').sdkVersions.android.firebaseCrashlyticsGradle;
    expect(transformed).toContain(`classpath 'com.google.firebase:firebase-crashlytics-gradle:${version}'`);
    expect(transformed).toContain('classpath("com.android.tools.build:gradle:8.4.0")');
    expect(await transform('projectBuildGradle', transformed)).toBe(transformed);
  });

  test('applies the app Crashlytics plugin once without removing Google Services', async () => {
    const original = 'apply plugin: "com.android.application"\napply plugin: "com.google.gms.google-services"\n';
    const transformed = await transform('appBuildGradle', original);
    expect(transformed).toContain("apply plugin: 'com.google.firebase.crashlytics'");
    expect(transformed).toContain(original);
    expect(await transform('appBuildGradle', transformed)).toBe(transformed);
  });
});

describe('iOS symbol upload wiring', () => {
  test('autolinking registers the dSYM upload script after compilation with required inputs', () => {
    const phases = require(join(sdkRoot, 'react-native.config.js')).dependency.platforms.ios.scriptPhases;
    expect(phases).toEqual(expect.arrayContaining([expect.objectContaining({
      path: './ios_config.sh', execution_position: 'after_compile',
      input_files: expect.arrayContaining([
        '${DWARF_DSYM_FOLDER_PATH}/${DWARF_DSYM_FILE_NAME}/Contents/Resources/DWARF/${TARGET_NAME}',
        '$(BUILT_PRODUCTS_DIR)/$(INFOPLIST_PATH)',
      ]),
    })]));
  });
});
