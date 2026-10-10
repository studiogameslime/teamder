// Cross-platform equivalent of the former find + patch-package lifecycle.
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');
const root = path.resolve(__dirname, '..');
const firebaseRoot = path.join(root, 'node_modules', '@react-native-firebase');
if (fs.existsSync(firebaseRoot)) {
  for (const name of fs.readdirSync(firebaseRoot)) {
    const target = path.join(firebaseRoot, name, 'dist', 'module', 'package.json');
    // Only this package metadata file, never a directory or dependency tree.
    if (target.startsWith(firebaseRoot + path.sep) && fs.existsSync(target)) fs.unlinkSync(target);
  }
}
execFileSync(process.execPath, [require.resolve('patch-package'), '--error-on-fail'], {cwd: root, stdio: 'inherit'});
// The pinned native-stack scene must stay mounted across focus changes.
execFileSync(process.execPath, [path.join(root, 'scripts', 'verify-native-stack-scene.cjs')], {cwd: root, stdio: 'inherit'});
