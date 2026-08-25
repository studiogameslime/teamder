#!/usr/bin/env node
// Regenerate the backend copy of the round-summary core:
//   src/utils/clubChemistry.ts  →  functions/src/clubChemistry.ts
//
// The summary is SEALED by a Cloud Function, but it is authored, read and
// tested on the client side — and the two must agree exactly, or a summary
// previewed on a phone would differ from the one written to the database.
// Same convention as genTeamBalanceCore.mjs: one source, a generated twin, and
// tests/logic/clubChemistryParity.test.ts to fail on drift.
//
//   node functions/scripts/genClubChemistry.mjs

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const root = existsSync(join(here, '../../src/utils/clubChemistry.ts'))
  ? join(here, '../..')
  : join(here, '..');

const SRC = join(root, 'src/utils/clubChemistry.ts');
const OUT = join(root, 'functions/src/clubChemistry.ts');

const HEADER = `// GENERATED FILE — DO NOT EDIT.
// Backend copy of src/utils/clubChemistry.ts, produced by
// functions/scripts/genClubChemistry.mjs. Edit the client source and re-run the
// generator; tests/logic/clubChemistryParity.test.ts fails if the two drift.
`;

const body = readFileSync(SRC, 'utf8');
writeFileSync(OUT, HEADER + body, 'utf8');
console.log(`wrote ${OUT} (${body.length} bytes from ${SRC})`);
