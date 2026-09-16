/**
 * The "did the evening happen" rule exists twice and must stay identical.
 *
 * Cloud Functions cannot import from the app source, so `functions/src/
 * eveningPlayed.ts` is a copy of `src/utils/eveningPlayed.ts`. A copy that
 * drifts is worse than no copy: this is the exact failure the module was
 * written to end — the server crediting an evening by one rule while the app
 * shows it by another — so letting the two halves diverge would rebuild the
 * bug inside the fix for it.
 *
 * The server file carries a header explaining itself; everything after the
 * marker must match the client file exactly.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const MARKER =
  '// ---- everything below this line is a copy of the client file ----';

describe.each([
  ['eveningPlayed', 'src/utils/eveningPlayed.ts', 'functions/src/eveningPlayed.ts'],
  [
    'seasonParticipants',
    'src/utils/seasonParticipants.ts',
    'functions/src/seasonParticipants.ts',
  ],
  ['seasonSeed', 'src/utils/seasonSeed.ts', 'functions/src/seasonSeed.ts'],
])('the two copies of %s', (_name, clientPath, serverPath) => {
  const client = fs.readFileSync(
    path.join(ROOT, 'src/utils/eveningPlayed.ts'),
    'utf8',
  );
  const server = fs.readFileSync(
    path.join(ROOT, 'functions/src/eveningPlayed.ts'),
    'utf8',
  );

  it('the server copy declares itself a copy', () => {
    expect(server).toContain(MARKER);
  });

  it('and is byte-identical to the client file below the marker', () => {
    const copied = server
      .slice(server.indexOf(MARKER) + MARKER.length)
      .replace(/^\n+/, '');
    expect(copied).toBe(client);
  });
});
