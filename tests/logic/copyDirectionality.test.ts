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

import { he, prefixName } from '@/i18n/he';

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
    //
    // Compared with the bidi ISOLATES stripped. Names are wrapped in
    // FSI…PDI (see `iso` in he.ts) so a Latin name cannot drag the Hebrew
    // around it — invisible characters that change nothing about the word
    // order this test is actually about. Stripping them keeps the assertion
    // on the meaning instead of on the encoding.
    const plain = (s: string) => s.replace(/[\u2066-\u2069]/g, '');
    expect(plain(he.pairCardAssistLeg('ראובן', 'איתי'))).toContain('ראובן בישל לאיתי');
    expect(plain(he.roundSummaryPairLeg('ראובן', 'איתי', 7))).toContain(
      'ראובן בישל לאיתי',
    );
  });

  it('wraps every interpolated NAME in a bidi isolate', () => {
    // The actual regression, from 01.10: a Hebrew name standing between two
    // Latin ones had its words pulled apart by the bidi algorithm —
    // "שלומי צדוק" rendered with its halves on opposite ends of a line.
    // An isolate round each name is what stops it, so assert the isolates
    // are THERE, not merely that the words are in order.
    const FSI = '\u2068';
    const PDI = '\u2069';
    expect(he.roundSummaryPairText('Lioz Madar', 'שלומי צדוק', 2)).toBe(
      `${FSI}Lioz Madar${PDI} ו${FSI}שלומי צדוק${PDI} — 2 שערים נוצרו ביניהם`,
    );
    expect(he.summaryNamesAndMore('Haim', 'דור', 3)).toBe(
      `${FSI}Haim${PDI}, ${FSI}דור${PDI} ועוד 3`,
    );
    // A number keeps its LRM treatment and must NOT be isolated as a name —
    // the two guards do different jobs.
    expect(he.summaryRecordNew('Eliran', 7, 'שערים', 5)).toContain(
      `${FSI}Eliran${PDI}`,
    );
  });
});

/**
 * A Hebrew prefix letter in front of a LATIN name.
 *
 * Found on the device, not in review: "מתן לוי ו⁨Eliran Tzabari⁩" rendered as
 * "מתן לויו Eliran Tzabari" — the words were in the right order (the isolate
 * was doing its job) and the vav had still welded itself to the end of the
 * PREVIOUS Hebrew word. Hebrew typography puts a maqaf before a foreign word.
 */
describe('a Hebrew prefix letter before a name', () => {
  const plain = (s: string) => s.replace(/[\u2066-\u2069]/g, '');

  it('takes a maqaf before a Latin name', () => {
    expect(plain(prefixName('ו', 'Eliran Tzabari'))).toBe('ו-Eliran Tzabari');
    expect(plain(prefixName('ל', 'Eliran Tzabari'))).toBe('ל-Eliran Tzabari');
  });

  it('glues straight onto a Hebrew name, as Hebrew does', () => {
    expect(plain(prefixName('ו', 'מתן לוי'))).toBe('ומתן לוי');
    expect(plain(prefixName('ל', 'אורי'))).toBe('לאורי');
  });

  it('still isolates the name either way', () => {
    // The maqaf is about reading; the isolate is about order. Both, always.
    expect(prefixName('ו', 'Eliran')).toContain('\u2068');
    expect(prefixName('ו', 'דני')).toContain('\u2068');
  });

  it('reaches the two-player strings that carry one', () => {
    expect(plain(he.pairAssistDirection('מתן לוי', 'Eliran Tzabari'))).toBe(
      'מתן לוי בישל ל-Eliran Tzabari',
    );
    expect(plain(he.pairEntryTitle('Eliran Tzabari'))).toBe('אתה ו-Eliran Tzabari');
    expect(plain(he.pairEntryTitle('אורי'))).toBe('אתה ואורי');
  });
});
