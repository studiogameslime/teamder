const { removeSourceProjects, addOfficialRepository, addSessionRestorePatch, useOfficialPod } = require('../../plugins/withJoryioSdk');
describe('official Joryio native dependency wiring', () => {
  it('removes old source projects so the npm bridge cannot prefer them', () => {
    const source = "rootProject.name = 'Teamder'\n// joryio-sdk old\ninclude ':joryio-sdk'\nproject(':joryio-sdk').projectDir = new File(rootDir, '../vendor/joryio/android/joryio')\ninclude ':joryio-sdk-ui'\nproject(':joryio-sdk-ui').projectDir = new File(rootDir, '../vendor/joryio/android/joryio-ui')\ninclude ':app'\n";
    const result = removeSourceProjects(source);
    expect(result).not.toContain('joryio-sdk');
    expect(result).toContain("include ':app'");
    expect(removeSourceProjects(result)).toBe(result);
  });
  it('adds the publisher beta Maven repository before remote repositories once', () => {
    const result = addOfficialRepository('allprojects {\n repositories {\n google()\n mavenCentral()\n }\n}');
    expect(result).toContain('vendor/joryio/releases/android-1.3.0-beta.1');
    expect(result.indexOf('joryio-official-maven')).toBeLessThan(result.indexOf('google()'));
    expect(addOfficialRepository(result)).toBe(result);
  });
  it('replaces a local CocoaPods override with the exact official tag inside the target', () => {
    const source = "platform :ios, '15.1'\ntarget 'Teamder' do\n # joryio-sdk local\n pod 'Joryio', :path => '../vendor/joryio/ios', :subspecs => ['Core', 'UI']\n use_expo_modules!\nend\n";
    const result = useOfficialPod(source);
    expect(result).not.toContain(':path');
    expect(result).toContain("https://github.com/joryio/joryio-ios-sdk.git");
    expect(result).toContain(":tag => '1.3.0-beta.1'");
    expect(result.indexOf("pod 'Joryio'")).toBeGreaterThan(result.indexOf("target 'Teamder' do"));
    expect(useOfficialPod(result)).toBe(result);
  });
  it('substitutes only the pinned Android base and resolves it from the traceable local patch repository', () => {
    const result = addSessionRestorePatch(addOfficialRepository('allprojects {\n repositories {\n google()\n mavenCentral()\n }\n}'));
    expect(result).toContain("substitute module('io.joryio:joryio-android:1.3.0-beta.1') using module('io.joryio:joryio-android:1.3.0-beta.1-teamder.1')");
    expect(result).toContain("resolutionStrategy.force 'io.joryio:joryio-android:1.3.0-beta.1-teamder.1'");
    expect(result).toContain('vendor/joryio/releases/android-1.3.0-beta.1-teamder.1');
    expect(result.indexOf('android-1.3.0-beta.1-teamder.1')).toBeLessThan(result.indexOf('google()'));
    expect(result).not.toContain('joryio-android-ui:');
    expect(result).not.toContain("include ':joryio-sdk'");
    expect(addSessionRestorePatch(result)).toBe(result);
  });
  it('updates a prior incremental patch block so the publisher strict constraint cannot silently retain the broken base', () => {
    const source = 'allprojects {\n // joryio-session-restore-patch\n configurations.configureEach {\n  resolutionStrategy.dependencySubstitution {}\n }\n repositories {}\n}';
    const result = addSessionRestorePatch(source);
    expect(result).toContain("resolutionStrategy.force 'io.joryio:joryio-android:1.3.0-beta.1-teamder.1'");
    expect(addSessionRestorePatch(result)).toBe(result);
  });
  it('the packaged patch is the exact artifact and source verified by the native regression harness', () => {
    const fs = require('fs'), crypto = require('crypto');
    const manifest = JSON.parse(fs.readFileSync('vendor/joryio/patches/android-session-restore/PROVENANCE.json', 'utf8'));
    const artifact = fs.readFileSync('vendor/joryio/releases/android-1.3.0-beta.1-teamder.1/io/joryio/joryio-android/1.3.0-beta.1-teamder.1/joryio-android-1.3.0-beta.1-teamder.1.aar');
    const source = fs.readFileSync(manifest.patchSource, 'utf8').replace(/\r\n/g, '\n');
    const hash = (value: unknown) => crypto.createHash('sha256').update(value).digest('hex');
    expect(hash(artifact)).toBe(manifest.patchedAarSha256);
    expect(hash(source)).toBe(manifest.patchSourceSha256);
    expect(manifest.changedClassEntries).toEqual(['io/joryio/sdk/core/SessionManager.class']);
    expect(manifest.after).toEqual({ passed: 12, failed: 0 });
  });
});
