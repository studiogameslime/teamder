import fs from 'fs';
import path from 'path';
const source = fs.readFileSync(path.resolve(__dirname, '../../functions/src/seasonManager.ts'), 'utf8');
it('both activation and rollover explicitly seed progress and its lifetime offset', () => {
  const enable = source.slice(source.indexOf('  async enable('), source.indexOf('  private async stamp('));
  const finish = source.slice(source.indexOf('  private async finish('), source.indexOf('  async sweep('));
  for (const block of [enable, finish]) {
    expect(block).toMatch(/roundsAtStart:/); expect(block).toMatch(/playedRounds:/);
    expect(block).toMatch(/currentId:/); expect(block).toMatch(/startedAt/);
  }
});
it('existing archive writers remain the sole counter reset mechanism', () => {
  expect(source).toContain('await closeSeason(');
  expect(source).not.toContain('eveningScoreSum: 0');
});
