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
  ['seasonDates', 'src/utils/seasonDates.ts', 'functions/src/seasonDates.ts'],
  [
    'seasonActivation',
    'src/utils/seasonActivation.ts',
    'functions/src/seasonActivation.ts',
  ],
])('the two copies of %s', (_name, clientPath, serverPath) => {
  // The paths the table declares, not one file hard-coded five times.
  //
  // This block read `src/utils/eveningPlayed.ts` regardless of which row was
  // running, so four of the five mirrors were never compared at all and the
  // suite reported ten green assertions that were two assertions run five
  // times. seasonSeed decides `roundsAtStart` and `playedRounds` for every
  // season the server opens, seasonActivation decides what "continue" means,
  // seasonParticipants decides the "0 שחקנים" number — all four could drift
  // from the client copy with this test passing.
  const client = fs.readFileSync(path.join(ROOT, clientPath), 'utf8');
  const server = fs.readFileSync(path.join(ROOT, serverPath), 'utf8');

  it('the server copy declares itself a copy', () => {
    expect(server).toContain(MARKER);
  });

  it('and is byte-identical to the client file below the marker', () => {
    const copied = server
      .slice(server.indexOf(MARKER) + MARKER.length)
      .replace(/^\n+/, '')
      // Cloud Functions have no `@/` alias, so that one line is allowed to
      // differ — and ONLY that one.
      .replace(/from '\.\/seasonDates'/g, "from '@/utils/seasonDates'");
    expect(copied).toBe(client);
  });
});
