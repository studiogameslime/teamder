/**
 * Mock data must not borrow a real club's name.
 *
 * The season summary's mock returned 'שכחת שושי' — a real club, and the
 * owner's own test club. Every screenshot of that screen showed a real club's
 * name over invented numbers, which reads exactly like the real club's data
 * being overwritten. Nothing had been: the name alone was enough to look like
 * it had, and it cost a genuine "did you reset my season?".
 *
 * The mock club is 'חמישי כדורגל'. Anything mock-facing that names a club
 * should name that one.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.join(__dirname, '..', '..', 'src');

/** Real clubs whose names have appeared in this repo's mocks or docs. */
const REAL_CLUB_NAMES = ['שכחת שושי', 'שככת שושי'];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe('no real club name is baked into the app', () => {
  it('not in mock data, not in a string, not anywhere in src', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const name of REAL_CLUB_NAMES) {
        // The explanatory comment on the fix is allowed to quote it once.
        const inCode = text
          .split('\n')
          .filter((l) => l.includes(name) && !l.trimStart().startsWith('//'));
        if (inCode.length > 0) {
          offenders.push(`${path.relative(SRC, file)} — "${name}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
