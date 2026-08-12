// The evening summary's "what moved tonight" lines.
//
// Two jobs, both pure so they can be tested without Firebase:
//
//   • turn the server's per-metric before/after standing into the sentence a
//     player actually cares about — WHO they went past, and who went past them;
//   • when the evening score was poor, replace the boast with a joke at the
//     player's expense, so a bad night still reads as something rather than as
//     an empty card.
//
// ONE fact per movement. The row underneath already shows the number and the
// place, so a "▲3 מקומות" chip next to "עקפת את שלומי, יוסי ונדב" would say the
// same thing twice — the names win, the chip goes.

import type { EveningMetric } from '@/services/eveningSummaryService';

export type ProgressTone = 'crown' | 'good' | 'bad' | 'snark';

export interface ProgressLine {
  id: string;
  tone: ProgressTone;
  /** Leading emoji — the line renders as a strip, like the insight rows. */
  icon: string;
  text: string;
}

/**
 * Right-to-left mark. React Native picks a line's paragraph direction from its
 * FIRST STRONG character, so "Haim Yaakov עקף אותך בשערים" was detected as an
 * LTR line and rendered with the Hebrew reordered around the name — the name
 * ended up on the far left of a right-aligned card. Prefixing this invisible
 * mark fixes the base direction regardless of whose name it is.
 */
const RLM = '\u200F';

/**
 * First-strong isolate around a name. The RLM above fixes the LINE's direction,
 * but a Latin name sitting next to a number still reorders inside it: "Eliran
 * Tzabari +3 ממך" rendered as "+3" first. Isolating the name makes it a single
 * opaque run, so the digits stay where they were written. Seen on-device with
 * a real club's mixed Hebrew/Latin names.
 */
function iso(name: string): string {
  return `\u2068${name}\u2069`;
}

/** Hebrew label for a metric, in the "בשערים" (prepositional) form. */
const IN_METRIC: Record<EveningMetric['key'], string> = {
  goals: 'בשערים',
  assists: 'בבישולים',
  wins: 'בניצחונות',
};

/** The club title that comes with topping a column. */
const CROWN_TITLE: Record<EveningMetric['key'], string> = {
  goals: 'מלך השערים',
  assists: 'מלך הבישולים',
  wins: 'מלך הניצחונות',
};

const METRIC_ICON: Record<EveningMetric['key'], string> = {
  goals: '⚽',
  assists: '🎯',
  wins: '🏆',
};

/**
 * Below this evening score the coach stops congratulating and starts teasing.
 * The scale is 0–10 and a normal night lands 6–9, so this only fires on a
 * genuinely quiet evening.
 */
export const SNARK_SCORE_MAX = 5;

/**
 * Join names the way a person would: "שלומי, יוסי ונדב".
 */
export function joinNames(names: readonly string[]): string {
  if (names.length === 0) return '';
  const safe = names.map(iso);
  if (safe.length === 1) return safe[0];
  return `${safe.slice(0, -1).join(', ')} ו${safe[safe.length - 1]}`;
}

/**
 * Teasing lines for a poor evening. Aimed at the night, never at the person —
 * "the legs showed up late" lands as banter; "you're bad" doesn't, and the
 * player who most needs to come back next week is exactly the one having a
 * bad night.
 */
export const SNARK_LINES: ReadonlyArray<(score: string) => string> = [
  (s) => `ציון ${s} הערב. תפסת מקום על המגרש, וגם זה תפקיד 🙃`,
  (s) => `${s} הערב. היה מישהו ברשימת ההמתנה שממש רצה את המקום הזה 😅`,
  (s) => `ציון ${s}. אפילו הכדור עצר לשאול אם הכל בסדר ⚽`,
  (s) => `${s} הערב — הרגליים הגיעו, השאר עוד בדרך 🦵`,
  (s) => `ציון ${s}. יש ימים כאלה. יש גם ימים אחרים, תיאורטית 😄`,
  (s) => `${s} הערב. המגרש כבר שכח, אנחנו רשמנו 📝`,
  (s) => `ציון ${s} — לפחות הגעת, וזו חצי מהעבודה 🙂`,
];

/** Deterministic pick so the same evening always shows the same joke. */
function pickSnark(seed: string, score: number): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const idx = (h >>> 0) % SNARK_LINES.length;
  // One decimal, and no trailing ".0" — "4" reads better than "4.0".
  const s = Number.isInteger(score) ? String(score) : score.toFixed(1);
  return SNARK_LINES[idx](s);
}

/** "דניאל +2 ממך" — same first-strong problem, same fix. */
export function aheadLabel(name: string, gap: number): string {
  return `${RLM}${iso(name)} +${gap} ממך`;
}

/**
 * The lines above the metric rows.
 *
 * A weak evening gets the joke INSTEAD of the movement lines, not on top of
 * them: "עקפת את שלומי" and "תפסת מקום על המגרש" in the same breath contradict
 * each other. Movement still shows in the rows below either way.
 */
export function progressLines(
  metrics: readonly EveningMetric[],
  score: number,
  seed: string,
): ProgressLine[] {
  if (score > 0 && score < SNARK_SCORE_MAX) {
    return [{ id: 'snark', tone: 'snark', icon: '🙃', text: pickSnark(seed, score) }];
  }

  const out: ProgressLine[] = [];

  // ── the crown ──
  // Topping a column is the loudest thing that can happen, so it leads. And
  // KEEPING it is its own event: a player who was first last week and is
  // first again didn't overtake anyone, so without this the card would have
  // nothing to say to the best player in the club.
  for (const m of metrics) {
    if (m.rank !== 1) continue;
    const held = m.delta === 0;
    out.push({
      id: `crown-${m.key}`,
      tone: 'crown',
      icon: '👑',
      text: held
        ? `${RLM}שמרת על התואר ${CROWN_TITLE[m.key]} גם אחרי המחזור הזה`
        : `${RLM}לקחת את התואר ${CROWN_TITLE[m.key]}`,
    });
  }

  for (const m of metrics) {
    if (m.passed.length > 0) {
      out.push({
        id: `passed-${m.key}`,
        tone: 'good',
        icon: METRIC_ICON[m.key],
        text: `${RLM}עקפת את ${joinNames(m.passed)} ${IN_METRIC[m.key]}`,
      });
    }
  }
  for (const m of metrics) {
    if (m.passedBy.length > 0) {
      const who = joinNames(m.passedBy);
      out.push({
        id: `passedby-${m.key}`,
        tone: 'bad',
        icon: METRIC_ICON[m.key],
        text:
          m.passedBy.length === 1
            ? `${RLM}${who} עקף אותך ${IN_METRIC[m.key]}`
            : `${RLM}${who} עקפו אותך ${IN_METRIC[m.key]}`,
      });
    }
  }
  return out;
}
