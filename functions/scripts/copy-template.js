// Copies the public community-page HTML template into the functions
// directory so the SSR Cloud Function (`serveCommunityPage`) can read
// it from disk at cold start. We can't reach across to ../public at
// runtime — the functions deploy bundle only contains paths under
// `functions/`. Run as part of the functions build step (see
// package.json `build`).
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'public', 'c', 'index.html');
const DEST_DIR = path.join(__dirname, '..', 'templates');
const DEST = path.join(DEST_DIR, 'community.html');

if (!fs.existsSync(SRC)) {
  console.error('[copy-template] source missing:', SRC);
  process.exit(1);
}
fs.mkdirSync(DEST_DIR, { recursive: true });
fs.copyFileSync(SRC, DEST);
console.log(
  '[copy-template] copied',
  path.relative(process.cwd(), SRC),
  '→',
  path.relative(process.cwd(), DEST),
);
