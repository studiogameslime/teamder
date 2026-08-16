#!/usr/bin/env node
// Regenerate the backend copy of the team-balance core:
//   src/utils/teamBalanceCore.ts  →  functions/src/teamBalanceCore.ts
//
// The split algorithm runs in two places — the phone (the admin's "חלוקה
// אוטומטית" button) and the scheduled Cloud Function — and the two MUST stay
// identical, or the same roster splits differently depending on who triggered
// it. That used to be enforced by hand-copying a block inside a 14k-line file,
// which is exactly how the evening-score formula drifted and silently dropped
// its penalty axis. Same convention as genHolidays.mjs: one source, generated
// twin, and a test (tests/logic/balanceParity.test.ts) that fails on drift.
//
// Run from the repo root or from functions/:
//   node functions/scripts/genTeamBalanceCore.mjs

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const root = existsSync(join(here, '../../src/utils/teamBalanceCore.ts'))
  ? join(here, '../..')
  : join(here, '..');

const SRC = join(root, 'src/utils/teamBalanceCore.ts');
const OUT = join(root, 'functions/src/teamBalanceCore.ts');

const HEADER = `// GENERATED FILE — DO NOT EDIT.
// Backend copy of src/utils/teamBalanceCore.ts, produced by
// functions/scripts/genTeamBalanceCore.mjs. Edit the client source and re-run
// the generator; tests/logic/balanceParity.test.ts fails if the two drift.
`;

const body = readFileSync(SRC, 'utf8');
writeFileSync(OUT, HEADER + body, 'utf8');
console.log(`wrote ${OUT} (${body.length} bytes from ${SRC})`);
