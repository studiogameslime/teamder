// seasonSeed — server-side mirror of `src/utils/seasonSeed.ts`.
//
// ---- everything below this line is a copy of the client file ----

// Where a season starts counting.
//
// A season OWNS the history the club has already played. Turn seasons on in a
// club that has played 19 evenings and asked for 24, and it stands at 19 — five
// evenings from its first title.
//
// That was always the intent; the number was just read from the wrong place.
// It came from `clubRecords.eveningsSealed`, a counter that only began when
// evening-sealing shipped, so the same club was shown "7 מתוך 24" — not its
// history, not a fresh start, but however far a young counter happened to have
// got. The owner's report: "שיחקנו 19 ולא 7". The history is counted from the
// games now, which is where the club screen has always counted it.
//
// `roundsAtStart` is the sealed count at this instant, so that every FUTURE
// seal adds exactly one. `playedRounds` is the number the club is shown and the
// number the rollover closes on — one value, seeded here, incremented from
// here, so the card and the sweep can never disagree.

const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;

export function seasonSeed(
  sealedEvenings: number,
  playedHistory = 0,
): { roundsAtStart: number; playedRounds: number } {
  return {
    roundsAtStart: num(sealedEvenings),
    playedRounds: num(playedHistory),
  };
}
