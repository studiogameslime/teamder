// eveningNarrative — the "alive" copy for the evening-summary card: an adaptive
// headline + a set of insight strips picked from a large pool by what the player
// ACTUALLY did this evening. Pure + dependency-free (unit-testable in node).
//
// Two players with different evenings get different lines; and among equally
// fitting phrasings we pick by a per-(game,player) seed, so it feels fresh
// without being random on every render (the summary of one game is stable).

export type InsightTone = 'gold' | 'lime' | 'blue' | 'purple' | 'rose';

export interface InsightLine {
  icon: string;
  text: string;
  tone: InsightTone;
}

export interface NarrativeStats {
  goals: number;
  assists: number;
  wins: number;
  losses: number;
  /** mini-games the player took the field for. */
  gamesPlayed: number;
  /** total mini-games in the evening (≥ gamesPlayed). */
  totalRounds: number;
  /** longest winner-stays streak. */
  heldPitch: number;
  /** longest consecutive-scoring streak. */
  scoringStreak: number;
  bestMiniGame: { round: number; goals: number; assists: number } | null;
  pen: { scored: number; saved: number; missed: number; conceded: number };
}

const winShareOf = (s: NarrativeStats) =>
  s.gamesPlayed > 0 ? s.wins / s.gamesPlayed : 0;

// ── seeded RNG (mulberry32 on a hashed string) ───────────────────────────────
function seededRng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(arr: T[], rng: () => number): T =>
  arr[Math.floor(rng() * arr.length) % arr.length];

// ── headline ─────────────────────────────────────────────────────────────────
interface TitleRule {
  when: (s: NarrativeStats) => boolean;
  variants: string[];
  emoji: string;
}

// Highest-priority match wins; variants vary by seed. No "ערב/מחזור" in the
// phrasing so it reads clean regardless of terminology.
//
// TONE: this is the biggest sentence on the card, so it should sound like a
// friend who watched you play — not a performance review. The earlier set
// ("מנוע בלתי-נדלה", "סוס עבודה", "חייל נאמן") described output; these describe
// the person's evening.
const TITLE_RULES: TitleRule[] = [
  { when: (s) => s.goals >= 3, emoji: '🔥',
    variants: ['ערב שלא שוכחים', 'הכל נכנס לך הערב', 'היית בכל מקום'] },
  { when: (s) => s.assists >= 3, emoji: '🅰️',
    variants: ['הכל עבר דרכך', 'נתת לכולם לזרוח', 'ראית את כל המגרש'] },
  { when: (s) => (s.goals >= 2 && s.assists >= 1) || (s.goals >= 1 && s.assists >= 2),
    emoji: '🎭', variants: ['ערב גדול שלך', 'הובלת את הערב', 'עשית את ההבדל'] },
  { when: (s) => winShareOf(s) >= 0.7 && s.gamesPlayed >= 3, emoji: '🏆',
    variants: ['איפה שאתה, מנצחים', 'הבאת איתך מזל טוב', 'הצד המנצח'] },
  { when: (s) => s.pen.saved >= 1, emoji: '🧤',
    variants: ['עצרת ברגע הנכון', 'הידיים היו שם', 'הצלת את הקבוצה'] },
  { when: (s) => s.heldPitch >= 3, emoji: '🏰',
    variants: ['לא ירדת מהמגרש', 'נשארת עד הסוף', 'החזקת את המגרש'] },
  { when: (s) => s.goals >= 1, emoji: '⚽',
    variants: ['רשמת את עצמך', 'תרמת את שלך', 'השארת חתימה'] },
  { when: (s) => s.gamesPlayed >= 6, emoji: '💪',
    variants: ['רצת בלי לעצור', 'נתת הכל הערב', 'לא ויתרת רגע'] },
  { when: (s) => s.gamesPlayed >= 3 && winShareOf(s) < 0.34 && s.goals + s.assists === 0,
    emoji: '🌱', variants: ['ערב של חימום', 'השבוע הבא שלך', 'הרגליים עוד יגיעו'] },
];
const DEFAULT_TITLE: TitleRule = {
  when: () => true, emoji: '👟',
  variants: ['טוב שהיית', 'נעים לראות אותך על הדשא', 'ערב טוב על המגרש'],
};

/**
 * Below this score the achievement titles are locked out.
 *
 * They read the STATS, not the result — so a player who stayed on for six
 * mini-games and lost most of them was crowned "רצת בלי לעצור" on a 6.9. The
 * headline is the biggest thing on the card; praising a middling evening in it
 * makes the score underneath look like a typo, and makes the praise worthless
 * on the evenings it IS earned.
 */
const PRAISE_MIN_SCORE = 8;

/** Titles that match the evening the score actually describes. */
const SCORE_BAND_TITLES: Array<{ min: number; emoji: string; variants: string[] }> = [
  { min: 7, emoji: '👍', variants: ['ערב סולידי', 'עשית את שלך', 'נוכחות טובה'] },
  { min: 6, emoji: '😐', variants: ['ערב פושר', 'היה אפשר יותר', 'לא הלך הערב'] },
  { min: 0, emoji: '🌱', variants: ['ערב קשה', 'יש ימים כאלה', 'בשבוע הבא מתקנים'] },
];

export function pickEveningTitle(
  s: NarrativeStats,
  seed = '',
  /** The evening score. Omitted (or 0) keeps the old stats-only behaviour. */
  score = 0,
): { title: string; emoji: string } {
  const rng = seededRng(`title:${seed}`);
  if (score > 0 && score < PRAISE_MIN_SCORE) {
    const band =
      SCORE_BAND_TITLES.find((b) => score >= b.min) ??
      SCORE_BAND_TITLES[SCORE_BAND_TITLES.length - 1];
    return { title: pick(band.variants, rng), emoji: band.emoji };
  }
  const rule = TITLE_RULES.find((r) => r.when(s)) ?? DEFAULT_TITLE;
  return { title: pick(rule.variants, rng), emoji: rule.emoji };
}

/** Which colour band a score falls into. Drives the hero's tint. */
export type ScoreBand = 'low' | 'mid' | 'good' | 'great';

export function scoreBand(score: number): ScoreBand {
  if (score >= 9) return 'great';
  if (score >= 8) return 'good';
  if (score >= 7) return 'mid';
  return 'low';
}

// ── insight strips ───────────────────────────────────────────────────────────
interface InsightRule {
  when: (s: NarrativeStats) => boolean;
  priority: number;
  make: (s: NarrativeStats, rng: () => number) => InsightLine;
}

// The card renders the goals/assists tiles on its own, so those aren't repeated
// here — these strips add the situational colour.
const INSIGHT_RULES: InsightRule[] = [
  { when: (s) => s.gamesPlayed >= 2 && s.wins === s.gamesPlayed, priority: 95,
    make: (s) => ({ icon: '🏆', tone: 'gold',
      text: `מחזור מושלם — ניצחת בכל ${s.gamesPlayed} המשחקים` }) },
  { when: (s) => s.goals >= 3, priority: 90,
    make: (s) => ({ icon: '⚽', tone: 'gold',
      text: `${s.goals} גולים במחזור אחד 🔥` }) },
  { when: (s) => s.pen.saved >= 1, priority: 88,
    make: (s) => ({ icon: '🧤', tone: 'blue',
      text: `עצרת ${s.pen.saved} פנדלים — גיבור הדרמה` }) },
  { when: (s) => s.heldPitch >= 2, priority: 80,
    make: (s) => ({ icon: '🏰', tone: 'gold',
      text: `החזקת את המגרש ${s.heldPitch} משחקים ברצף` }) },
  { when: (s) => s.scoringStreak >= 2, priority: 76,
    make: (s) => ({ icon: '🔥', tone: 'rose',
      text: `הבקעת ב-${s.scoringStreak} משחקים רצופים` }) },
  { when: (s) => s.assists >= 3, priority: 72,
    make: (s) => ({ icon: '🅰️', tone: 'purple',
      text: `${s.assists} בישולים — סיפקת לחברים` }) },
  { when: (s) => s.pen.scored >= 1, priority: 60,
    make: (s) => ({ icon: '🥅', tone: 'blue',
      text: `הכנסת ${s.pen.scored} פנדלים בשובר-שוויון` }) },
  { when: (s) => !!s.bestMiniGame && (s.bestMiniGame.goals + s.bestMiniGame.assists) >= 3,
    priority: 55, make: (s) => ({ icon: '⭐', tone: 'blue',
      text: `המשחק הכי טוב שלך: ${s.bestMiniGame!.goals} גולים ו-${s.bestMiniGame!.assists} בישולים` }) },
  { when: (s) => s.goals >= 2 && winShareOf(s) < 0.5, priority: 50,
    make: (s) => ({ icon: '✊', tone: 'lime',
      text: `${s.goals} גולים גם במחזור לא פשוט` }) },
  { when: (s) => s.gamesPlayed >= 6 && s.goals + s.assists === 0, priority: 40,
    make: (s) => ({ icon: '🏃', tone: 'lime',
      text: `${s.gamesPlayed} משחקים על הרגליים — נוכחות מלאה` }) },
  // Fallback so there's always at least one line for a player who took the field.
  { when: (s) => s.gamesPlayed >= 1, priority: 10,
    make: (s) => ({ icon: '💪', tone: 'lime',
      text: s.totalRounds > s.gamesPlayed
        ? `עבדת קשה — שיחקת ${s.gamesPlayed} מתוך ${s.totalRounds} המשחקים`
        : `עבדת קשה — שיחקת את כל ${s.gamesPlayed} המשחקים` }) },
];

/** Up to `max` situational strips for this player, most impressive first. */
export function pickEveningInsights(
  s: NarrativeStats,
  seed = '',
  max = 3,
): InsightLine[] {
  const rng = seededRng(`insight:${seed}`);
  return INSIGHT_RULES.filter((r) => r.when(s))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, Math.max(0, max))
    .map((r) => r.make(s, rng));
}
