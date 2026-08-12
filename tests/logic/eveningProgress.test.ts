// The evening summary's movement lines: who you passed, who passed you, and
// the joke that replaces both on a bad night.

import {
  aheadLabel,
  SNARK_LINES,
  SNARK_SCORE_MAX,
  joinNames,
  progressLines,
} from '@/utils/eveningProgress';
import type { EveningMetric } from '@/services/eveningSummaryService';

const m = (over: Partial<EveningMetric> = {}): EveningMetric => ({
  key: 'goals',
  value: 31,
  rank: 4,
  delta: 0,
  passed: [],
  passedCount: 0,
  passedBy: [],
  passedByCount: 0,
  aheadName: 'דניאל',
  aheadGap: 2,
  ...over,
});

describe('naming the people you passed', () => {
  it('joins names the way a person speaks', () => {
    // Names are isolated (U+2068…U+2069) so a Latin name can't reorder the
    // digits beside it; strip the marks to read the sentence.
    const plain = (s: string) => s.replace(/[\u2066-\u2069\u200F]/g, '');
    expect(plain(joinNames(['שלומי']))).toBe('שלומי');
    expect(plain(joinNames(['שלומי', 'יוסי']))).toBe('שלומי ויוסי');
    // The count is the truth even when we were handed fewer names than that.
    expect(plain(joinNames(['שלומי', 'יוסי'], 6))).toBe('שלומי ויוסי ועוד 4');
    expect(plain(joinNames(['שלומי', 'יוסי', 'נדב'], 3))).toBe('שלומי ויוסי ועוד 1');
    expect(joinNames([])).toBe('');
  });

  it('says who you went past, per metric', () => {
    const lines = progressLines(
      [m({ passed: ['שלומי', 'יוסי'], passedCount: 2 })],
      7.1,
      'g1',
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].text.replace(/[\u2066-\u2069\u200F]/g, '')).toBe(
      'עקפת את שלומי ויוסי בשערים',
    );
    expect(lines[0].tone).toBe('good');
  });

  it('names two and counts the rest', () => {
    const lines = progressLines(
      [m({ key: 'wins', passedBy: ['אבי', 'רן', 'דור', 'עומר'], passedByCount: 4 })],
      7,
      'x',
    );
    const t = lines[0].text.replace(/[\u2066-\u2069\u200F]/g, '');
    expect(t).toBe('אבי ורן ועוד 2 עקפו אותך בניצחונות');
  });

  it('matches the verb to one person or several', () => {
    const one = progressLines(
      [m({ key: 'assists', passedBy: ['אבי'], passedByCount: 1 })],
      7,
      'x',
    );
    expect(one[0].text.replace(/[\u2066-\u2069\u200F]/g, '')).toBe(
      'אבי עקף אותך בבישולים',
    );
    const many = progressLines(
      [m({ key: 'assists', passedBy: ['אבי', 'רן'], passedByCount: 2 })],
      7,
      'x',
    );
    expect(many[0].text.replace(/[\u2066-\u2069\u200F]/g, '')).toBe(
      'אבי ורן עקפו אותך בבישולים',
    );
  });

  it('puts the wins you gained before the ones you lost', () => {
    const lines = progressLines(
      [
        m({ passed: ['שלומי'], passedCount: 1 }),
        m({ key: 'assists', passedBy: ['אבי'], passedByCount: 1 }),
      ],
      8,
      'x',
    );
    expect(lines.map((l) => l.tone)).toEqual(['good', 'bad']);
  });

  it('stays silent when nothing moved', () => {
    // The common case — most evenings nobody is overtaken. With the table
    // gone there is nothing else in this band, so it disappears entirely
    // rather than showing an empty box.
    expect(progressLines([m()], 7.5, 'x')).toEqual([]);
  });

  it('says you KEPT the crown when you were already first', () => {
    // The best player in the club overtakes nobody, so without this the card
    // has nothing to tell them — the one player it should be loudest for.
    const lines = progressLines([m({ key: 'assists', rank: 1, delta: 0 })], 7.5, 'x');
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toContain('שמרת על התואר מלך הבישולים');
    expect(lines[0].tone).toBe('crown');
  });

  it('says you TOOK the crown when you just climbed to first', () => {
    const lines = progressLines(
      [m({ key: 'goals', rank: 1, delta: 2, passed: ['דור', 'רן'], passedCount: 2 })],
      7.5,
      'x',
    );
    expect(lines[0].text).toContain('לקחת את התואר מלך השערים');
    // …and the overtake still gets named underneath it.
    expect(lines[1].text).toContain('עקפת את');
  });

  it('gives every line an icon to render with', () => {
    const lines = progressLines(
      [
        m({ rank: 1, delta: 0 }),
        m({ key: 'wins', passedBy: ['אבי'], passedByCount: 1 }),
      ],
      7,
      'x',
    );
    expect(lines.every((l) => l.icon.length > 0)).toBe(true);
  });

  it('puts the crown before the overtakes', () => {
    const lines = progressLines(
      [
        m({ key: 'assists', rank: 1 }),
        m({ key: 'goals', passed: ['דור'], passedCount: 1 }),
      ],
      8,
      'x',
    );
    expect(lines[0].id).toContain('crown');
  });
});

describe('lines that start with a name', () => {
  it('forces RTL so a Latin name does not flip the sentence', () => {
    // React Native reads a line's direction from its first strong character,
    // so "Haim Yaakov עקף אותך" was detected LTR and rendered with the name
    // stranded on the far left of a right-aligned card. Seen on-device.
    const line = progressLines(
      [m({ key: 'goals', passedBy: ['Haim Yaakov'], passedByCount: 1 })],
      7,
      'x',
    )[0];
    expect(line.text.startsWith('\u200F')).toBe(true);
    expect(line.text.replace(/[\u2066-\u2069\u200F]/g, '')).toContain(
      'Haim Yaakov עקף אותך בשערים',
    );
  });

  it('marks the "who is ahead" label too', () => {
    expect(aheadLabel('Eliran Tzabari', 3)).toBe(
      '\u200F\u2068Eliran Tzabari\u2069 +3 ממך',
    );
  });

  it('marks the boast line as well — names can be Latin on either side', () => {
    const line = progressLines([m({ passed: ['Dor'], passedCount: 1 })], 7, 'x')[0];
    expect(line.text.startsWith('\u200F')).toBe(true);
  });
});

describe('the joke on a bad night', () => {
  it('replaces the movement lines rather than joining them', () => {
    // "עקפת את שלומי" next to "תפסת מקום על המגרש" contradict each other.
    const lines = progressLines([m({ passed: ['שלומי'], passedCount: 1 })], 3.2, 'x');
    expect(lines).toHaveLength(1);
    expect(lines[0].tone).toBe('snark');
  });

  it('only fires on a genuinely quiet evening', () => {
    expect(progressLines([m()], SNARK_SCORE_MAX, 'x')).toEqual([]);
    expect(progressLines([m()], SNARK_SCORE_MAX + 0.1, 'x')).toEqual([]);
    expect(progressLines([m()], SNARK_SCORE_MAX - 0.1, 'x')[0].tone).toBe('snark');
  });

  it('never fires on a missing score', () => {
    // score 0 means "not computed", not "terrible" — mocking it as terrible
    // would insult players whose evening simply had no data.
    expect(progressLines([m()], 0, 'x')).toEqual([]);
  });

  it('shows the real score, and drops a pointless .0', () => {
    expect(progressLines([m()], 4, 'x')[0].text).toContain('4');
    expect(progressLines([m()], 4, 'x')[0].text).not.toContain('4.0');
    expect(progressLines([m()], 3.4, 'x')[0].text).toContain('3.4');
  });

  it('is stable for one evening but varies across evenings', () => {
    const a = progressLines([m()], 3, 'game1:me')[0].text;
    expect(progressLines([m()], 3, 'game1:me')[0].text).toBe(a);
    const seen = new Set(
      Array.from({ length: 40 }, (_, i) => progressLines([m()], 3, `g${i}`)[0].text),
    );
    expect(seen.size).toBeGreaterThan(3);
  });

  it('teases the evening, never the person', () => {
    // The player having a bad night is the one most likely to stop coming.
    const BANNED = ['גרוע', 'חלש', 'מביך', 'כישלון', 'עלוב', 'מיותר'];
    for (const line of SNARK_LINES) {
      const t = line('4');
      for (const w of BANNED) expect(t).not.toContain(w);
    }
  });
});
