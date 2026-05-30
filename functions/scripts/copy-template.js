// Copies the public-facing SSR-targeted HTML templates into the
// functions directory so the `serveCommunityPage` CF can read them
// from disk at cold start. We can't reach across to ../public at
// runtime — the functions deploy bundle only contains paths under
// `functions/`. Run as part of the functions build step (see
// package.json `build`).
//
// Two templates currently:
//   • community.html  — backs /c/{groupId} (community showcase)
//   • invite.html     — backs /team/{groupId} (community invite page,
//                        used by WhatsApp share previews → needs SSR
//                        OG tags + per-group cover image)

const fs = require('fs');
const path = require('path');

const DEST_DIR = path.join(__dirname, '..', 'templates');
fs.mkdirSync(DEST_DIR, { recursive: true });

const COPIES = [
  {
    src: path.join(__dirname, '..', '..', 'public', 'c', 'index.html'),
    dest: path.join(DEST_DIR, 'community.html'),
  },
  {
    src: path.join(__dirname, '..', '..', 'public', 'invite.html'),
    dest: path.join(DEST_DIR, 'invite.html'),
  },
];

for (const { src, dest } of COPIES) {
  if (!fs.existsSync(src)) {
    console.error('[copy-template] source missing:', src);
    process.exit(1);
  }
  fs.copyFileSync(src, dest);
  console.log(
    '[copy-template] copied',
    path.relative(process.cwd(), src),
    '→',
    path.relative(process.cwd(), dest),
  );
}
