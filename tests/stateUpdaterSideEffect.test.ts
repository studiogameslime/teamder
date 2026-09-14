/**
 * A React state updater is not a place to compute a value for the line below.
 *
 * `setX(prev => ...)` looks synchronous, and usually behaves that way: React
 * evaluates the updater at the call site as an optimisation — but ONLY when
 * that component has no update already queued. When something else has just
 * scheduled one (a live Firestore snapshot, say), the updater is deferred to
 * the next render and any variable it was supposed to assign is still holding
 * its initial value.
 *
 * So code shaped like
 *
 *     let result = null;
 *     setGame((prev) => { result = next; return next; });
 *     if (!result) reportSomethingWentWrong();
 *
 * reports on React's scheduling, not on the thing it meant to check. That is
 * exactly what MatchDetailsScreen did after a join: the join had landed, the
 * server had seated the player, and the screen filed "the game disappeared"
 * because a snapshot from that very join had queued a render first.
 *
 * The fix is to read the COMMITTED state (a ref, a store's getState()) instead
 * of a variable the updater writes. This test walks the source and fails on
 * the shape, because the runtime symptom only appears under a race.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.join(__dirname, '..', 'src');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** Index just past the `{` that opens a block, given the index OF that `{`. */
function matchBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** End of the block that ENCLOSES `from` — where a captured value stops being
 *  readable in the same synchronous run. */
function enclosingEnd(src: string, from: number): number {
  let depth = 0;
  for (let i = from; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return src.length;
}

interface Offence {
  file: string;
  line: number;
  name: string;
}

/** `setThing((prev) => {` — a state updater with a block body. */
const UPDATER = /\bset[A-Z]\w*\(\s*\(\s*([A-Za-z_$][\w$]*)?\s*(?::[^)]*)?\)\s*(?::[^=]*?)?=>\s*\{/g;

function offences(file: string, src: string): Offence[] {
  const out: Offence[] = [];
  for (const m of src.matchAll(UPDATER)) {
    const open = src.indexOf('{', m.index! + m[0].length - 1);
    const close = matchBrace(src, open);
    if (close < 0) continue;
    const body = src.slice(open + 1, close);
    // Names the body assigns without declaring them — i.e. captured from outside.
    const declared = new Set(
      [...body.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map((d) => d[1]),
    );
    const assigned = new Set(
      [...body.matchAll(/(?:^|[;{}\n])\s*([A-Za-z_$][\w$]*)\s*=(?!=|>)/g)]
        .map((a) => a[1])
        .filter((n) => !declared.has(n)),
    );
    if (assigned.size === 0) continue;
    const after = src.slice(close + 1, enclosingEnd(src, close + 1));
    for (const name of assigned) {
      if (new RegExp(`\\b${name}\\b`).test(after)) {
        out.push({
          file: path.relative(SRC, file),
          line: src.slice(0, m.index!).split('\n').length,
          name,
        });
      }
    }
  }
  return out;
}

describe('no value is carried out of a state updater', () => {
  it('across every screen, component and hook', () => {
    const found = sourceFiles(SRC).flatMap((f) =>
      offences(f, fs.readFileSync(f, 'utf8')),
    );
    const report = found
      .map((o) => `  ${o.file}:${o.line} — "${o.name}" is assigned inside a state updater and read after it`)
      .join('\n');
    expect(report).toBe('');
  });
});

describe('the detector actually catches the shape', () => {
  const bad = `
function Screen() {
  const handle = async () => {
    let joined = null;
    setGame((prev) => {
      if (!prev) return prev;
      joined = { ...prev };
      return joined;
    });
    if (!joined) report('gameDisappeared');
  };
}`;

  it('flags a value read after the updater', () => {
    expect(offences('x.tsx', bad).map((o) => o.name)).toEqual(['joined']);
  });

  it('allows an updater that keeps to itself', () => {
    const ok = `
setGame((prev) => {
  const next = { ...prev };
  return next;
});
doSomethingElse();`;
    expect(offences('x.tsx', ok)).toEqual([]);
  });

  it('allows a cleanup flag — it is not a state updater', () => {
    const ok = `
let cancelled = false;
useEffect(() => {
  run().then(() => { if (!cancelled) setRows([]); });
  return () => { cancelled = true; };
}, []);`;
    expect(offences('x.tsx', ok)).toEqual([]);
  });

  it('allows a value the updater assigns but nobody reads afterwards', () => {
    const ok = `
const handle = () => {
  let seen = null;
  setGame((prev) => {
    seen = prev;
    return prev;
  });
};`;
    expect(offences('x.tsx', ok)).toEqual([]);
  });
});
