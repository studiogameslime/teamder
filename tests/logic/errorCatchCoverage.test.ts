import fs from 'fs';
import { execFileSync } from 'child_process';
const { inspect } = require('../../scripts/error-catch-audit.cjs');

test('all owned TypeScript catches, rejection handlers, snapshots and HTTP fallbacks have observation or a documented recursion boundary', () => {
  const report = JSON.parse(execFileSync(process.execPath,['scripts/error-catch-audit.cjs','--json'],{encoding:'utf8'}));
  expect(report.rows.filter((row:any)=>row.runtime!=='tooling-or-third-party'&&!['observed','recursion-boundary'].includes(row.state))).toEqual([]);
});
test('instrumentation preserves control flow and is repeatable', () => {
  const input='export async function load(p: Promise<number>) { try { return await p; } catch { return 4; } }';
  const first=inspect('src/example.ts',input,true).source;
  expect(first).toContain('observeCaughtError(');expect(first).toContain('return 4;');
  expect(inspect('src/example.ts',first,true).source).toBe(first);
});
test('domain result.ok is not mistaken for an HTTP response', () => {
  const input="async function select() { const result = await pickPhoto(); if (!result.ok) return null; }";
  expect(inspect('src/example.ts',input,true).source).toBe(input);
  const http="async function load() { const response = await fetch('/endpoint'); if (!response.ok) return null; }";
  expect(inspect('src/example.ts',http,true).source).toContain('observeCaughtError(');
});
test('server trigger factories all use the reporting lifetime wrapper, except diagnostic ingestion', () => {
  const files=execFileSync('git',['ls-files','functions/src'],{encoding:'utf8'}).trim().split('\n');
  const misses=files.filter(file=>file.endsWith('.ts')&&!file.endsWith('/clientDiagnostics.ts')).filter(file=>
    /import\s*\{[^}]*\bon(?:Call|Request|Document\w+|Schedule|TaskDispatched)\b[^}]*\}\s*from\s*['"]firebase-functions\/v2\//s.test(fs.readFileSync(file,'utf8')));
  expect(misses).toEqual([]);
});
