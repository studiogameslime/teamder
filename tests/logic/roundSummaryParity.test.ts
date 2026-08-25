import fs from 'fs';
import path from 'path';

// The summary core is authored on the client and sealed by a Cloud Function.
// They are one source plus a generated copy; this test is what makes
// "generated" true. If it fails, run:
//   node functions/scripts/genRoundSummary.mjs
const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src/utils/roundSummary.ts');
const GEN = path.join(ROOT, 'functions/src/roundSummary.ts');

describe('client/server round-summary parity', () => {
  it('the backend copy is byte-identical to the client source', () => {
    const src = fs.readFileSync(SRC, 'utf8');
    const gen = fs.readFileSync(GEN, 'utf8');
    const marker = '// Round summary core';
    const idx = gen.indexOf(marker);
    expect(idx).toBeGreaterThan(-1);
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
});
