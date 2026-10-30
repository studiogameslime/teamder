import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { addGuard, SCRIPT, PHASE_NAME } = require('../../plugins/withIosLegacySdkGuard');
const xcode = require('xcode');
const shell = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/sh';

function runGuard(version: string, sdkRoot = '/Applications/Xcode 26.app/SDKs/iPhoneOS.sdk', fail = false) {
  // Execute the actual build-phase script. Only the platform SDK discovery is
  // replaced, so rejection, shell syntax, argument quoting and exit codes run.
  const discover = `xcrun() {
    [ "$#" = 3 ] && [ "$1" = --sdk ] && [ "$2" = "$SDKROOT" ] && [ "$3" = --show-sdk-version ] || return 9
    [ "$TEAMDER_TEST_FAIL" != 1 ] || return 8
    printf '%s\\n' "$TEAMDER_TEST_SDK"
  }
`;
  return spawnSync(shell, ['-c', discover + SCRIPT], { encoding: 'utf8', env: {
    ...process.env, SDKROOT: sdkRoot, TEAMDER_TEST_SDK: version, TEAMDER_TEST_FAIL: fail ? '1' : '0',
  } });
}

test.each(['26.0', '26.6', '18.5'])('selected SDK %s passes independently of device OS', version => {
  const result = runGuard(version);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Device launch still requires verification');
});

test.each(['27.0', '27.0.1', '28.0'])('selected SDK %s blocks a legacy-lifecycle build', version => {
  const result = runGuard(version);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('complete UIScene migration');
});

test('unknown SDK, failed discovery and missing build context fail closed', () => {
  expect(runGuard('unknown').status).toBe(1);
  expect(runGuard('').status).toBe(1);
  expect(runGuard('26.6', undefined, true).status).toBe(1);
  expect(runGuard('26.6', '').status).toBe(1);
});

function makeProject() {
  const project = xcode.project('unused.pbxproj');
  project.hash = { project: { archiveVersion: 1, objectVersion: 54, rootObject: 'ROOT', objects: {
    PBXProject: { ROOT: { isa: 'PBXProject', targets: [{ value: 'WATCH' }, { value: 'APP' }] } },
    PBXNativeTarget: {
      WATCH: { isa: 'PBXNativeTarget', name: 'Watch', productType: '"com.apple.product-type.application.watchapp2"', buildPhases: [] },
      APP: { isa: 'PBXNativeTarget', name: 'Teamder', productType: '"com.apple.product-type.application"', buildPhases: [{ value: 'SOURCES', comment: 'Sources' }] },
    },
    PBXBuildFile: {}, PBXFileReference: {},
    PBXSourcesBuildPhase: { SOURCES: { isa: 'PBXSourcesBuildPhase', files: [] } },
  } } };
  return project;
}

test('guard survives project serialization, runs first and is idempotent without touching the watch', () => {
  const project = makeProject();
  addGuard(project);
  addGuard(project);
  const folder = mkdtempSync(join(tmpdir(), 'teamder-ios-guard-'));
  const filename = join(folder, 'project.pbxproj');
  try {
    writeFileSync(filename, project.writeSync());
    const parsed = xcode.project(filename).parseSync();
    const target = parsed.getTarget('com.apple.product-type.application').target;
    expect(target.buildPhases).toHaveLength(2);
    expect(target.buildPhases[0].comment).toBe(PHASE_NAME);
    const phase = parsed.hash.project.objects.PBXShellScriptBuildPhase[target.buildPhases[0].value];
    expect(JSON.parse(phase.shellScript)).toBe(SCRIPT);
    expect(phase.alwaysOutOfDate).toBe(1);
    expect(parsed.hash.project.objects.PBXNativeTarget.WATCH.buildPhases).toEqual([]);
  } finally {
    unlinkSync(filename);
    rmdirSync(folder);
  }
});

test('plugin is registered and release cloud image stays pinned below Xcode 27', () => {
  const root = join(__dirname, '../..');
  const config = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'));
  expect(config.expo.plugins).toContain('./plugins/withIosLegacySdkGuard.js');
  const eas = JSON.parse(readFileSync(join(root, 'eas.json'), 'utf8'));
  expect(eas.build.production.ios.image).toBe('macos-tahoe-26.5-xcode-26.6');
});
