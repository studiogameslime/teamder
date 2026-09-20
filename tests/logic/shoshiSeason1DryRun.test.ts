// DRY RUN — what the new rules would make of the one season that has closed.
//
// No production data is written by this file. It reads a frozen snapshot of
// `seasonSummary/HhzIwmjMl1i5HSOGHt3p__s1` (מועדון שכחת שושי, season 1) taken
// on 20.09.2026, runs the REAL award rules over it, and prints the comparison
// the owner asked to see before approving any migration.
//
// It runs the real `computeSeasonAwards` rather than restating the rules, so
// the report cannot drift from the code it is reporting on.
//
// Two separate corrections are on the table, and the report keeps them apart:
//
//   1. THE RULES changed (§14–§17). Titles are no longer gated on attendance
//      except the MVP; the penalty titles count instead of rating.
//   2. THE MVP INPUT was wrong. `eveningScoreSum/Count` counted attendances,
//      not ratings, so the 6.0 sentinel — "this player played no mini-game
//      tonight" — entered the average as though it were a result. The real
//      sums are reconstructed per player per evening from the club's
//      `eveningStandings` joined to each game's `roundHistory`, which records
//      who played each mini-game.

import fs from 'node:fs';
import path from 'node:path';
import {
  computeSeasonAwards,
  eligibilityThreshold,
  SEASON_TITLE_KEYS,
  type SeasonPlayerLine,
  type SeasonPairLine,
  type SeasonAwards,
} from '@/utils/seasonAwards';

const SNAP = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'shoshiSeason1.json'), 'utf8'),
) as {
  archive: {
    completedRounds: number;
    players: Record<string, Record<string, number | string>>;
    pairs: Record<string, Record<string, number | string>>;
    awards: Record<string, { winners: string[]; value: number } | null>;
  };
  realRatings: Record<string, { sum: number; count: number }>;
  sentinelEvenings: Record<string, number>;
};

const A = SNAP.archive;
const ROUNDS = A.completedRounds;
const num = (x: unknown) => (typeof x === 'number' ? x : 0);
const nameOf = (uid: string) =>
  String(A.players[uid]?.displayName ?? uid.slice(0, 8));

/** The archive's own rows, as the close wrote them. */
function rows(useRealRatings: boolean): SeasonPlayerLine[] {
  return Object.entries(A.players).map(([uid, r]) => {
    const stored = num(r.eveningScoreCount) > 0
      ? num(r.eveningScoreSum) / num(r.eveningScoreCount)
      : 0;
    const real = SNAP.realRatings[uid];
    const corrected = real && real.count > 0 ? real.sum / real.count : 0;
    return {
      uid,
      games: num(r.games),
      rounds: num(r.rounds),
      goals: num(r.goals),
      assists: num(r.assists),
      wins: num(r.wins),
      cleanSheets: num(r.cleanSheets),
      mvpAvg: useRealRatings ? corrected : stored,
      penTaken: num(r.penTaken),
      penScored: num(r.penScored),
      penFaced: num(r.penFaced),
      penSaved: num(r.penSaved),
    } as SeasonPlayerLine;
  });
}

const pairRows: SeasonPairLine[] = Object.values(A.pairs).map((p) => ({
  a: String(p.a),
  b: String(p.b),
  score: num(p.assistsAToB) + num(p.assistsBToA),
  together: num(p.sameTeam),
})) as SeasonPairLine[];

const show = (aw: { winners: string[]; value: number } | null | undefined) =>
  !aw ? '— not awarded' : `${aw.winners.map(nameOf).join(' + ')}  (${aw.value})`;

describe('DRY RUN · שכחת שושי, season 1 — nothing is written', () => {
  const fresh: SeasonAwards = computeSeasonAwards(rows(true), pairRows, ROUNDS);

  it('prints the comparison', () => {
    const L: string[] = [];
    L.push('');
    L.push('═'.repeat(78));
    L.push(`  מועדון שכחת שושי · season 1 · ${ROUNDS} evenings · ${Object.keys(A.players).length} players`);
    L.push(`  attendance gate for שחקן העונה: ${eligibilityThreshold(ROUNDS)} of ${ROUNDS}`);
    L.push('═'.repeat(78));
    L.push('');
    L.push('  TITLE              STORED IN THE ARCHIVE            →  UNDER THE NEW RULES');
    L.push('  ' + '─'.repeat(74));
    for (const key of SEASON_TITLE_KEYS) {
      const was = show(A.awards[key]);
      const now = show(fresh[key]);
      const mark = was === now ? '   ' : ' ≠ ';
      L.push(`  ${key.padEnd(16)} ${was.padEnd(32).slice(0, 32)}${mark}${now}`);
    }
    L.push('');
    L.push('  שחקן העונה — why it moves');
    L.push('  ' + '─'.repeat(74));
    L.push('  player            attended  gate?   stored avg   real avg   sentinel nights');
    for (const [uid, r] of Object.entries(A.players)) {
      const games = num(r.games);
      const stored = num(r.eveningScoreCount) > 0
        ? num(r.eveningScoreSum) / num(r.eveningScoreCount) : 0;
      const real = SNAP.realRatings[uid];
      const corrected = real && real.count > 0 ? real.sum / real.count : 0;
      const gate = games >= eligibilityThreshold(ROUNDS) ? 'yes' : 'NO ';
      L.push(
        `  ${nameOf(uid).padEnd(17)} ${String(games).padStart(5)}     ${gate}` +
          `   ${stored.toFixed(3).padStart(9)}  ${corrected.toFixed(3).padStart(9)}` +
          `   ${String(SNAP.sentinelEvenings[uid] ?? 0).padStart(6)}` +
          `   (${real?.count ?? 0} rated of ${num(r.eveningScoreCount)} counted)`,
      );
    }
    L.push('');
    L.push('  Why "rated" exceeds "counted" — the accumulator shipped late');
    L.push('  ' + '─'.repeat(74));
    L.push('  The archive counted 2-3 evenings per player; the club has 16 with a');
    L.push('  stored rating, and every one of them belongs to season 1 (13 carry no');
    L.push('  seasonId at all, which means season 1, and 3 are stamped s1 — checked');
    L.push('  game by game).');
    L.push('');
    L.push('  `eveningScoreSum/Count` began writing on 16.09.2026, the last two days');
    L.push('  of a season that started on 27.07. Everything before that has an');
    L.push('  eveningStandings row — written by an older path — and never reached the');
    L.push('  season accumulator at all. So the stored average is not a wrong average');
    L.push('  of the season; it is an average of its final 48 hours.');
    L.push('');
    L.push('  And those final 48 hours are exactly the evenings that ran with no');
    L.push('  rotation: 16.09 and both of 17.09 recorded ZERO mini-games. Every score');
    L.push('  in the counted window is therefore the 6.0 sentinel, which is why all');
    L.push('  seven averages are exactly 6.000 and all seven share the title.');
    L.push('');
    L.push('  The reconstruction uses the 16 stored ratings and keeps only those a');
    L.push('  player actually earned — present in a roundHistory teamA/teamB for that');
    L.push('  evening. It invents nothing: an evening with no stored rating stays');
    L.push('  absent rather than becoming a zero.');
    L.push('');
    L.push('  Documents this migration would touch, if approved:');
    L.push(`    seasonSummary/HhzIwmjMl1i5HSOGHt3p__s1   → awards (9 keys)`);
    L.push(`    seasonCards/HhzIwmjMl1i5HSOGHt3p__s1     → winners`);
    L.push(`    users/{uid}/seasonTitles/*               → add/remove per title moved`);
    L.push(`    communityPlayerStats/{gid}__{uid}        → eveningScoreSum/Count (7 rows)`);
    L.push('  Nothing else. No game, no roster, no lifetime counter.');
    L.push('═'.repeat(78));
    // eslint-disable-next-line no-console
    console.log(L.join('\n'));
    expect(true).toBe(true);
  });

  // ── The findings, pinned so the report cannot quietly change ──────────
  it('the stored שחקן העונה is the whole club on the sentinel value', () => {
    expect(A.awards.mvp?.winners).toHaveLength(7);
    expect(A.awards.mvp?.value).toBe(6);
  });

  it('and every one of those players has sentinel evenings in their average', () => {
    for (const uid of Object.keys(A.players)) {
      expect(SNAP.sentinelEvenings[uid]).toBeGreaterThan(0);
    }
  });

  it('with real ratings only, the title has ONE holder', () => {
    expect(fresh.mvp).not.toBeNull();
    expect(fresh.mvp!.winners).toHaveLength(1);
    expect(fresh.mvp!.value).toBeGreaterThan(6);
  });

  it('the penalty titles are decided on counts now', () => {
    // Both were rate-based and both were 1.0 — a perfect record. The count
    // form asks how many, which is a different question with a possibly
    // different answer.
    expect(A.awards.penaltyKing?.value).toBe(1);
    const best = Math.max(...Object.values(A.players).map((r) => num(r.penScored)));
    if (best > 0) expect(fresh.penaltyKing?.value).toBe(best);
    else expect(fresh.penaltyKing).toBeNull();
  });

  it('the counted window is the season\'s last 48 hours, not the season', () => {
    // The archive's own counter is far below the ratings that exist, and the
    // gap is the explanation for the whole finding. Pinned so a future reader
    // does not re-derive it: 2-3 counted against 7-10 rated, per player.
    for (const [uid, r] of Object.entries(A.players)) {
      const counted = num(r.eveningScoreCount);
      const rated = SNAP.realRatings[uid]?.count ?? 0;
      expect(counted).toBeGreaterThan(0);
      expect(rated).toBeGreaterThan(counted);
    }
  });

  it('and everything it counted was the sentinel', () => {
    // Which is why every stored average is exactly 6.000 — not approximately.
    for (const r of Object.values(A.players)) {
      const stored = num(r.eveningScoreSum) / num(r.eveningScoreCount);
      expect(stored).toBe(6);
    }
  });

  it('the counting titles are unchanged — nobody was gated out of them here', () => {
    // Worth stating: on THIS club every member cleared the old attendance
    // gate, so dropping it changes nothing. The §14 fix matters for clubs with
    // a fringe scorer, not for this one.
    for (const key of ['topScorer', 'topAssister', 'topWinner', 'cleanSheetKing', 'mostLoyal'] as const) {
      expect(fresh[key]?.winners?.sort()).toEqual(A.awards[key]?.winners?.sort());
    }
  });
});
