// Guard for the crash that took the live screen down in 1.1.3.
//
// AdvancedLiveMatchScreen returns early twice near the middle of the component —
// once for a deleted game (`notFound`) and once while the game is still loading
// (`!game`). The empty-team retire handler was added BELOW those returns as a
// `React.useCallback`. On the spinner render the component bailed before
// reaching it and called N hooks; the moment the game arrived it called N+1, and
// React tore the tree down:
//
//   Rendered more hooks than during the previous render.
//
// The screen did not degrade — it never rendered at all, for every user, on
// every entry. Reported from production as "מסך לייב לא נטען בכלל".
//
// This is the classic Rules-of-Hooks violation, and `react-hooks/rules-of-hooks`
// is exactly the lint rule that catches it — but this project has no ESLint set
// up, and standing one up is not this fix's job. So, in the spirit of
// overlayTouchRegion.test.ts, this reads the sources instead. Shallow, but it is
// the check that would have caught the bug, and it costs nothing to keep.

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');

/** Screens that return early from the component body and so must keep every
 *  hook above the first return. Add a screen here when it grows an early exit. */
const SCREENS = ['src/screens/AdvancedLiveMatchScreen.tsx'];

const HOOK_CALL = /(?:^|[^.\w])(?:React\.)?(use[A-Z]\w*)\s*\(/;

/** An early exit looks like a guard clause at the component's own indentation:
 *
 *    if (!game) {          // two spaces — top level of the component body
 *      return (            // four   — inside that guard
 *
 *  Matching the `return` alone is not enough: the component's FINAL return sits
 *  at two spaces with nothing after it, so keying on that makes the test pass
 *  vacuously — which it did on the first draft of this file, against the very
 *  code it was written to catch. Anchor on the guard, then look inside it. */
const GUARD_OPEN = /^ {2}if \(/;
const GUARD_CLOSE = /^ {2}\}/;
const GUARD_RETURN = /^ {4}return\b/;

/** Where the component itself begins. Module-level helpers above it are
 *  indented the same way and have guard clauses of their own — scanning from
 *  the top of the file finds one of those and reports every hook in the
 *  component as an offender. */
function componentStart(lines: string[], name: string): number {
  const decl = new RegExp(`^(?:export )?(?:default )?function ${name}\\b`);
  return lines.findIndex((l) => decl.test(l));
}

/** Line index of the first guard clause that returns, or -1. */
function firstEarlyReturn(lines: string[], from: number): number {
  for (let i = from; i < lines.length; i++) {
    if (!GUARD_OPEN.test(lines[i])) continue;
    for (let j = i + 1; j < lines.length && !GUARD_CLOSE.test(lines[j]); j++) {
      if (GUARD_RETURN.test(lines[j])) return j;
    }
  }
  return -1;
}

/** Lines that only look like hook calls: definitions, imports, types, comments. */
function isRealCall(line: string): boolean {
  const t = line.trim();
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false;
  if (t.startsWith('import ') || t.startsWith('export ')) return false;
  if (/^(function|type|interface)\b/.test(t)) return false;
  return true;
}

describe('no hook is called after a component bails out early', () => {
  for (const rel of SCREENS) {
    it(`${rel} keeps every hook above its first early return`, () => {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      const lines = src.split('\n');

      const start = componentStart(lines, path.basename(rel, '.tsx'));
      expect(start).toBeGreaterThan(-1); // the component must be findable

      const firstReturn = firstEarlyReturn(lines, start);
      expect(firstReturn).toBeGreaterThan(-1); // the guard needs a bail-out to guard

      const offenders: string[] = [];
      for (let i = firstReturn + 1; i < lines.length; i++) {
        const line = lines[i];
        if (!isRealCall(line)) continue;
        const m = HOOK_CALL.exec(line);
        // `useCallback` inside a nested render-prop is still a hook, but this
        // file has none and flagging honestly beats silently allowing a class
        // of them — anything matching here needs a human to look.
        if (m) offenders.push(`  line ${i + 1}: ${m[1]} — ${line.trim().slice(0, 90)}`);
      }

      if (offenders.length > 0) {
        throw new Error(
          `${rel} calls ${offenders.length} hook(s) after the early return on ` +
            `line ${firstReturn + 1}. React counts a different number of hooks ` +
            `on the render before and after the guard and unmounts the screen:\n` +
            offenders.join('\n') +
            `\n\nMove them above the early returns, or make them plain functions ` +
            `if they were never memoised for a reason.`,
        );
      }
    });
  }
});
