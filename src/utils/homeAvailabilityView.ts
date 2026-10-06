// What the home screen's availability panel shows — decided once, purely.
//
// This module does NOT compute availability. The counts arrive already made
// from `availabilityFeedService`; all that happens here is choosing which of
// those days to put on screen, which one to call the recommendation, and in
// what order they are drawn.
//
// It was lifted out of `ProfileScreen` unchanged. Every line below is the
// arithmetic that screen was already doing inline — the near-window slice, the
// ranking by headcount, the "is there anyone at all" check, the top-three cut
// and the chronological re-sort. Nothing was re-decided in the move; the point
// of the move is that the ORDERING RULE is now a thing a test can hold.
//
// ── The ordering rule ──────────────────────────────────────────────────────
// Days are RANKED by headcount to pick the three worth showing, and then
// DRAWN in date order. Those are two different questions and conflating them
// is the bug this guards against: the recommended day must keep its place in
// the week, not jump to one end because it happens to be the busiest. Under
// `I18nManager.forceRTL` the first card in the row lands on the visual RIGHT,
// so "nearest first" reads right-to-left exactly as a Hebrew reader expects.

/** One evening's headcount, as the availability feed reports it. */
export interface EveningDay {
  dateMs: number;
  count: number;
  /** Hebrew weekday letter ("ב", "ג", …) — the feed's own label. */
  letter: string;
}

/** A day as the panel draws it. */
export interface WindowDay {
  letter: string;
  count: number;
  dateMs: number;
  /** The recommendation. Styling only — it never changes the card's place. */
  best: boolean;
}

export interface AvailabilityView {
  /**
   * The day to recommend opening a round on, or null when nobody is free.
   * Null is a real answer: the panel then shows the availability alone rather
   * than inventing a recommendation.
   */
  recommended: EveningDay | null;
  /** The cards, in DATE order (nearest first → visual right under RTL). */
  days: WindowDay[];
  /** Denominator for the little progress bars; 0 when there is nothing. */
  maxCount: number;
}

/**
 * "Closest strong days": rank only the NEAREST few days, not the whole week,
 * so the panel surfaces a day that is both soon and busy rather than a packed
 * evening eight days out.
 */
const NEAR_WINDOW_DAYS = 5;

/** How many cards the panel has room for. */
const CARD_COUNT = 3;

export function buildAvailabilityView(eveningDays: EveningDay[]): AvailabilityView {
  const near = eveningDays.slice(0, NEAR_WINDOW_DAYS);
  const ranked = [...near].sort((a, b) => b.count - a.count);

  // "Anyone at all": a week of zeroes has a busiest day on paper, and calling
  // it a recommendation would be a claim that someone is free when nobody is.
  const anyone = ranked.length > 0 && ranked[0].count > 0;
  if (!anyone) return { recommended: null, days: [], maxCount: 0 };

  const recommended = ranked[0];
  const top = ranked.slice(0, CARD_COUNT);

  // Match on the DATE, not on the object: two days can tie on headcount, and
  // the recommendation is the one `ranked[0]` actually picked.
  const days: WindowDay[] = top
    .map((d) => ({
      letter: d.letter,
      count: d.count,
      dateMs: d.dateMs,
      best: d.dateMs === recommended.dateMs,
    }))
    .sort((a, b) => a.dateMs - b.dateMs);

  return {
    recommended,
    days,
    maxCount: days.reduce((m, d) => Math.max(m, d.count), 0),
  };
}
