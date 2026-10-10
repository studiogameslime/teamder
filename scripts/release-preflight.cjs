/** Read-only local release preflight. Never builds, submits or prints secrets. */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const platform = option('--platform', 'all');
const profile = option('--profile', 'production');
const buildProfile = option('--build-profile', profile);
const submitProfile = option('--submit-profile', profile);
if (!['ios', 'android', 'all'].includes(platform)) throw new Error('Expected --platform ios, android or all');
const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
const findings = [];
function add(name, ok, detail) { findings.push({ name, ok, detail }); }
function existsFile(value) { if (typeof value !== 'string' || !value) return false; try { return fs.statSync(path.resolve(root, value)).isFile(); } catch { return false; } }
function resolveBuild(name, visited = new Set()) {
  if (visited.has(name)) throw new Error('Cyclic build profile inheritance');
  visited.add(name);
  const current = eas.build?.[name];
  if (!current) throw new Error('Build profile not found: ' + name);
  const parent = current.extends ? resolveBuild(current.extends, visited) : {};
  return { ...parent, ...current, ios: { ...parent.ios, ...current.ios }, android: { ...parent.android, ...current.android } };
}
const build = resolveBuild(buildProfile);
const submit = eas.submit?.[submitProfile];
add('submit profile', !!submit, submit ? submitProfile : 'Missing submit profile: ' + submitProfile);
if (platform === 'ios' || platform === 'all') {
  const source = build.ios.credentialsSource ?? build.credentialsSource ?? 'remote';
  add('iOS Firebase configuration', existsFile('GoogleService-Info.plist'), 'GoogleService-Info.plist');
  if (source === 'local') {
    const credentialsPath = path.join(root, 'credentials.json');
    const present = existsFile(credentialsPath);
    add('iOS local signing configuration', present, 'credentials.json');
    if (present) {
      try {
        const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
        let paths = 0;
        const visit = (value, label) => {
          if (!value || typeof value !== 'object') return;
          for (const [key, item] of Object.entries(value)) {
            if (/Path$/.test(key) && typeof item === 'string') { paths++; add('iOS signing file ' + label + '.' + key, existsFile(item), item); }
            else if (item && typeof item === 'object') visit(item, label + '.' + key);
          }
        };
        visit(credentials.ios, 'ios');
        add('iOS signing file references', paths > 0, paths + ' file paths found; key/password values are not printed');
      } catch { add('iOS signing JSON', false, 'credentials.json cannot be parsed'); }
    }
  } else add('iOS signing source', true, 'remote; availability not verified by this local check');
  const ios = submit?.ios;
  add('iOS submission profile', !!ios, submitProfile);
  if (ios?.ascApiKeyPath) add('iOS submission key file', existsFile(ios.ascApiKeyPath), ios.ascApiKeyPath);
  else add('iOS submission key file', false, 'No ascApiKeyPath; interactive/remote authentication is not verified');
}
if (platform === 'android' || platform === 'all') {
  add('Android Firebase configuration', existsFile('google-services.json'), 'google-services.json');
  const android = submit?.android;
  add('Android submission profile', !!android, submitProfile);
  if (android) add('Android submission account file', existsFile(android.serviceAccountKeyPath), android.serviceAccountKeyPath ?? 'Missing serviceAccountKeyPath');
}
const result = { platform, buildProfile, submitProfile, ok: findings.every(f => f.ok), findings,
  limitation: 'Local file checks only. No build, network, signing validity, store entitlement or credential contents are verified.' };
if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
else { for (const f of findings) console.log(`${f.ok ? 'OK' : 'MISSING'} ${f.name}: ${f.detail}`); console.log(result.limitation); }
process.exitCode = result.ok ? 0 : 1;
