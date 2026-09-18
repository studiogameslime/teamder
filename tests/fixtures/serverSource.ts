// Reading the backend as text, for the handful of guards that have to.
//
// A few rules cannot be unit-tested from here at all: a Firestore merge, a
// read-modify-write race, a field missing from one of five object literals.
// The suite guards those by reading the source and asserting its SHAPE, in the
// spirit of tests/hooksAfterEarlyReturn.ts.
//
// Three such guards existed and all three read exactly one file —
// `functions/src/index.ts` — with hand-written regular expressions that also
// depended on how deeply the code they matched happened to be indented. Both
// of those are the same flaw: the guard describes where the code is today
// rather than what it must not do. Move the same write into another file, or
// re-indent it by two spaces, and the guard goes quiet while passing.
//
// So the text is the WHOLE backend, every file is named in the failure, and
// object literals are found by matching braces rather than by counting spaces.

import * as fs from 'fs';
import * as path from 'path';

const SERVER_SRC = path.join(__dirname, '..', '..', 'functions', 'src');

export interface ServerFile {
  /** Relative to the repo root, so a failure names something greppable. */
  path: string;
  text: string;
}

/** Every TypeScript file the backend deploys, index.ts included. */
export function serverFiles(): ServerFile[] {
  const out: ServerFile[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'lib') continue;
        walk(p);
        continue;
      }
      if (!/\.ts$/.test(e.name) || /\.d\.ts$/.test(e.name)) continue;
      out.push({
        path: `functions/src/${path.relative(SERVER_SRC, p)}`,
        text: fs.readFileSync(p, 'utf8'),
      });
    }
  };
  walk(SERVER_SRC);
  // Sorted, so a new file cannot change the order a guard reports in.
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export interface SourceBlock {
  /** Where it is, as `functions/src/x.ts:123`. */
  where: string;
  /** The object literal itself, braces included. */
  body: string;
}

/**
 * Every object literal opened by `marker`, across the whole backend.
 *
 * Brace-matched rather than line-matched: the version of this that shipped
 * ended its match at `\n {4,6}\};`, so the same literal indented one level
 * deeper — or written on one line — was simply not found, and a guard that
 * finds nothing asserts nothing.
 */
export function objectLiterals(marker: RegExp): SourceBlock[] {
  const out: SourceBlock[] = [];
  for (const file of serverFiles()) {
    const re = new RegExp(marker.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(file.text))) {
      const open = file.text.indexOf('{', m.index + m[0].length - 1);
      if (open < 0) continue;
      let depth = 0;
      let i = open;
      for (; i < file.text.length; i += 1) {
        if (file.text[i] === '{') depth += 1;
        else if (file.text[i] === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const line = file.text.slice(0, m.index).split('\n').length;
      out.push({ where: `${file.path}:${line}`, body: file.text.slice(open, i + 1) });
    }
  }
  return out;
}

/**
 * Every line of the backend that is not a comment.
 *
 * A guard looking for a forbidden WRITE must not fire on the comment that
 * explains why it is forbidden — and must not be satisfied by one either.
 */
export function codeLines(): Array<{ where: string; line: string }> {
  const out: Array<{ where: string; line: string }> = [];
  for (const file of serverFiles()) {
    file.text.split('\n').forEach((line, i) => {
      const t = line.trim();
      if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      out.push({ where: `${file.path}:${i + 1}`, line });
    });
  }
  return out;
}
