// seasonParticipants — server-side mirror of `src/utils/seasonParticipants.ts`.
//
// Cloud Functions cannot import the app source, so the two files are kept
// byte-identical below this header and tests/logic/eveningPlayedMirror.test.ts
// has a sibling that pins this pair the same way.
//
// ---- everything below this line is a copy of the client file ----

// How many people took part in a season.
//
// Pulled out of the close so it can be tested: it shipped counting `rounds`
// (mini-games), which made every season of a timer-only club report "0
// שחקנים" — the plain live screen is a clock and records no mini-games at all.
// Found by closing a real season on the QA club against the deployed backend.
//
// `games` is evenings attended, and after the evening-played work it only
// counts evenings that actually happened. `rounds` stays as a safety net for a
// row credited a mini-game without an evening.

const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

export function countSeasonParticipants(
  players: Record<string, { games?: unknown; rounds?: unknown }> | undefined,
): number {
  if (!players) return 0;
  return Object.values(players).filter(
    (p) => num(p?.games) > 0 || num(p?.rounds) > 0,
  ).length;
}
