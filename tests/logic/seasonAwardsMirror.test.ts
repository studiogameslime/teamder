/**
 * The season-title rules exist twice and must stay identical.
 *
 * Cloud Functions cannot import from the app source, so `functions/src/
 * seasonAwards.ts` is a copy of `src/utils/seasonAwards.ts`. A copy that
 * drifts is worse than no copy: the server would seal a season's titles by one
 * set of rules while the app explained them by another, and the disagreement
 * would only ever be visible to the club.
 *
 * The server file carries a header explaining itself; everything after the
 * marker must match the client file exactly.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const MARKER = '// ---- everything below this line is a copy of the client file ----';

describe('the two copies of the title rules', () => {
  const client = fs.readFileSync(path.join(ROOT, 'src/utils/seasonAwards.ts'), 'utf8');
  const server = fs.readFileSync(path.join(ROOT, 'functions/src/seasonAwards.ts'), 'utf8');

  it('the server copy declares itself a copy', () => {
    expect(server).toContain(MARKER);
  });

  it('and is byte-identical to the client file below the marker', () => {
    const copied = server.slice(server.indexOf(MARKER) + MARKER.length).replace(/^\n+/, '');
    expect(copied).toBe(client);
  });
});
