#!/usr/bin/env node
// Regenerate the backend copy of the round-summary core:
//   src/utils/roundSummary.ts  →  functions/src/roundSummary.ts
//
// The summary is SEALED by a Cloud Function, but it is authored, read and
// tested on the client side — and the two must agree exactly, or a summary
// previewed on a phone would differ from the one written to the database.
// Same convention as genTeamBalanceCore.mjs: one source, a generated twin, and
// tests/logic/roundSummaryParity.test.ts to fail on drift.
//
//   node functions/scripts/genRoundSummary.mjs

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const root = existsSync(join(here, '../../src/utils/roundSummary.ts'))
  ? join(here, '../..')
  : join(here, '..');

const SRC = join(root, 'src/utils/roundSummary.ts');
const OUT = join(root, 'functions/src/roundSummary.ts');

const HEADER = `// GENERATED FILE — DO NOT EDIT.
// Backend copy of src/utils/roundSummary.ts, produced by
// functions/scripts/genRoundSummary.mjs. Edit the client source and re-run the
// generator; tests/logic/roundSummaryParity.test.ts fails if the two drift.
`;

const body = readFileSync(SRC, 'utf8');
writeFileSync(OUT, HEADER + body, 'utf8');
console.log(`wrote ${OUT} (${body.length} bytes from ${SRC})`);
