#!/usr/bin/env node
// One source for completed-game participation on the client and server.
// Run: node functions/scripts/genRoundParticipants.mjs
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const source = join(root, 'src/utils/roundParticipants.ts');
const target = join(root, 'functions/src/roundParticipants.ts');
const header = '// GENERATED FILE — DO NOT EDIT.\n' +
  '// Source: src/utils/roundParticipants.ts. Regenerate with\n' +
  '// node functions/scripts/genRoundParticipants.mjs.\n';
writeFileSync(target, header + readFileSync(source, 'utf8'), 'utf8');
console.log(`wrote ${target}`);
