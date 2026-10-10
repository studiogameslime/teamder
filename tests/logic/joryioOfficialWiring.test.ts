const { removeSourceProjects, addOfficialRepository, useOfficialPod } = require('../../plugins/withJoryioSdk');
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
});
