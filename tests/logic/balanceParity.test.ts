import fs from 'fs';
import path from 'path';

// The split algorithm runs on the phone AND in the scheduled Cloud Function.
// They are one source plus a generated copy; this test is the thing that makes
// "generated" true. If it fails, run:
//   node functions/scripts/genTeamBalanceCore.mjs
const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src/utils/teamBalanceCore.ts');
const GEN = path.join(ROOT, 'functions/src/teamBalanceCore.ts');

describe('client/server balance parity', () => {
  it('the backend copy is byte-identical to the client source', () => {
    const src = fs.readFileSync(SRC, 'utf8');
    const gen = fs.readFileSync(GEN, 'utf8');
    const marker = '// Team-balance core';
    const idx = gen.indexOf(marker);
    expect(idx).toBeGreaterThan(-1); // generated header present
    expect(gen.slice(idx)).toBe(src);
  });

  it('the generated copy carries the do-not-edit header', () => {
    const gen = fs.readFileSync(GEN, 'utf8');
    expect(gen.startsWith('// GENERATED FILE — DO NOT EDIT.')).toBe(true);
  });

  it('the core imports nothing — it has to compile in both projects', () => {
    const src = fs.readFileSync(SRC, 'utf8');
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/require\(/);
  });

  it('same input + same seed → identical split on both sides', async () => {
    // Both modules are loaded and run against one seeded RNG. Any behavioural
    // difference (a hand-edit to the backend copy) shows up as a diff here even
    // if the text check above were somehow bypassed.
    const client = await import('@/utils/teamBalanceCore');
    const server = await import('../../functions/src/teamBalanceCore');

    const ids = Array.from({ length: 15 }, (_, i) => `p${i}`);
    const ratings: Record<string, number> = {};
    [4.5, 4, 3.6, 3.2, 4, 3.3, 3, 3.5, 3.2, 4.3, 2.7, 3.4, 3, 4, 1].forEach(
      (r, i) => {
        ratings[`p${i}`] = r;
      },
    );
    const history = [
      { startsAt: 3, teams: [ids.slice(0, 5), ids.slice(5, 10), ids.slice(10)] },
      { startsAt: 2, teams: [ids.slice(0, 5), ids.slice(5, 10), ids.slice(10)] },
    ];

    const seeded = () => {
      let s = 12345;
      return () => {
        s = (s * 1103515245 + 12345) % 2147483648;
        return s / 2147483648;
      };
    };
    const args = {
      playerIds: ids,
      ratings,
      numTeams: 3,
      perTeam: 5,
      pairWeights: client.buildPairRepeatWeights(history),
    };
    const a = client.balanceCore({ ...args, rng: seeded() });
    const b = server.balanceCore({ ...args, rng: seeded() });
    expect(b.teams).toEqual(a.teams);
    expect(b.gap).toBeCloseTo(a.gap, 10);
    expect(b.repeat).toBeCloseTo(a.repeat, 10);
  });
});
