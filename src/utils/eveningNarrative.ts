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
  contribution: { pct: number; touched: number; teamGoals: number } | null;
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
const TITLE_RULES: TitleRule[] = [
  { when: (s) => s.goals >= 3, emoji: '🔥',
    variants: ['חלוץ בלתי-נעצר', 'מכונת גולים', 'האטרקציה של המחזור'] },
  { when: (s) => s.assists >= 3, emoji: '🅰️',
    variants: ['מלך הבישולים', 'הרגל של הזהב', 'המוח מאחורי הקבוצה'] },
  { when: (s) => (s.goals >= 2 && s.assists >= 1) || (s.goals >= 1 && s.assists >= 2),
    emoji: '🎭', variants: ['המחזור עבר דרכך', 'בלתי-אפשרי לעצירה', 'שחקן המפתח'] },
  { when: (s) => winShareOf(s) >= 0.7 && s.gamesPlayed >= 3, emoji: '🏆',
    variants: ['מכונת ניצחונות', 'לא יודע להפסיד', 'תמיד בצד המנצח'] },
  { when: (s) => s.pen.saved >= 1, emoji: '🧤',
    variants: ['החומה', 'קיר לבנים', 'סיוט הבועטים'] },
  { when: (s) => s.heldPitch >= 3, emoji: '🏰',
    variants: ['מלך הגבעה', 'בעל-הבית על המגרש', 'לא זזים מפה'] },
  { when: (s) => s.goals >= 1, emoji: '⚽',
    variants: ['תורם בהתקפה', 'מסמן נוכחות', 'על לוח התוצאות'] },
  { when: (s) => s.gamesPlayed >= 6, emoji: '💪',
    variants: ['מנוע בלתי-נדלה', 'לא ירד מהמגרש', 'סוס עבודה'] },
  { when: (s) => s.gamesPlayed >= 3 && winShareOf(s) < 0.34 && s.goals + s.assists === 0,
    emoji: '🌱', variants: ['מחזור של למידה', 'יום כזה — חוזרים חזק', 'הכל לפנינו'] },
];
const DEFAULT_TITLE: TitleRule = {
  when: () => true, emoji: '👟',
  variants: ['חייל נאמן', 'נתן את שלו', 'מחזור סולידי'],
};

export function pickEveningTitle(
  s: NarrativeStats,
  seed = '',
): { title: string; emoji: string } {
  const rng = seededRng(`title:${seed}`);
  const rule = TITLE_RULES.find((r) => r.when(s)) ?? DEFAULT_TITLE;
  return { title: pick(rule.variants, rng), emoji: rule.emoji };
}

// ── insight strips ───────────────────────────────────────────────────────────
interface InsightRule {
  when: (s: NarrativeStats) => boolean;
  priority: number;
  make: (s: NarrativeStats, rng: () => number) => InsightLine;
}

// The card renders the contribution % and the goals/assists tiles on its own,
// so those aren't repeated here — these strips add the situational colour.
const INSIGHT_RULES: InsightRule[] = [
  { when: (s) => s.gamesPlayed >= 2 && s.wins === s.gamesPlayed, priority: 95,
    make: (s) => ({ icon: '🏆', tone: 'gold',
      text: `מחזור מושלם — ניצחת בכל ${s.gamesPlayed} המשחקים` }) },
  { when: (s) => !!s.contribution && s.contribution.teamGoals >= 2 &&
      s.contribution.touched >= s.contribution.teamGoals, priority: 92,
    make: () => ({ icon: '🎯', tone: 'gold',
      text: 'כל הגולים של הקבוצה שלך — עליך' }) },
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
