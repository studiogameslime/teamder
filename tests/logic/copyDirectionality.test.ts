// No user-facing string may carry a horizontal arrow.
//
// WHY THIS EXISTS. The pair card printed "ראובן מימון → איתי דוידי 7". An arrow
// is a bidi-NEUTRAL character: the algorithm places it correctly inside the
// right-to-left run, but the glyph still DRAWS pointing right, and in a
// right-to-left reading order "rightwards" is backwards. The line therefore
// claimed that Itai fed Reuven — the exact opposite of the data, which says
// Reuven fed Itai seven times.
//
// It is not a rendering bug that a careful reviewer catches, because the string
// looks perfectly correct in a left-to-right editor. It only inverts on the
// device. So the rule is mechanical: direction is carried by WORDS ("בישל ל"),
// never by ↔ glyphs, and this test refuses the next one.
//
// Vertical arrows are fine — they mean up/down, which bidi does not touch.

import { he } from '@/i18n/he';

const HORIZONTAL_ARROWS = /[→←⇒⇐➔➜➝➞➟➠➡⬅↔⟵⟶]/u;

/** Every leaf string the dictionary can produce. Functions are invoked with
 *  cheap stand-ins so their TEMPLATE is inspected, not just their source. */
function leafStrings(): { path: string; value: string }[] {
  const out: { path: string; value: string }[] = [];
  const visit = (node: unknown, path: string) => {
    if (typeof node === 'string') {
      out.push({ path, value: node });
      return;
    }
    if (typeof node === 'function') {
      const fn = node as (...args: unknown[]) => unknown;
      // Feed both a name-ish string and a number to each parameter position; the
      // dictionary's helpers only ever take those two shapes.
      for (const filler of ['א', 1]) {
        try {
          const r = fn(...Array.from({ length: fn.length }, () => filler));
          if (typeof r === 'string') out.push({ path, value: r });
        } catch {
          // A helper that rejects the stand-in has nothing to check here.
        }
      }
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        visit(v, path ? `${path}.${k}` : k);
      }
    }
  };
  visit(he, '');
  return out;
}

describe('user-facing copy directionality', () => {
  it('never draws direction with a horizontal arrow', () => {
    const offenders = leafStrings()
      .filter(({ value }) => HORIZONTAL_ARROWS.test(value))
      .map(({ path, value }) => `${path}: ${value}`);

    expect(offenders).toEqual([]);
  });

  it('states assist direction in words, in both places it appears', () => {
    // The two strings the bug was reported on. Pinned by MEANING: whoever is
    // named first must be the one doing the feeding, and the sentence must
    // survive being read right-to-left.
    expect(he.pairCardAssistLeg('ראובן', 'איתי')).toContain('ראובן בישל לאיתי');
    expect(he.roundSummaryPairLeg('ראובן', 'איתי', 7)).toContain('ראובן בישל לאיתי');
  });
});
