/**
 * A DRY RUN of backfilling the club's whole history.
 *
 * Not a unit test of a rule — a rehearsal. It replays every finished evening of
 * the real club, in order, through the same core the Cloud Function uses,
 * carrying the record baseline and each player's best evening forward exactly
 * as a real backfill would. What it asserts is that a replay is SAFE and that
 * it produces the thing it is supposed to produce; what it prints is what the
 * club would actually see.
 *
 * The reason to rehearse rather than reason: the history is uneven. One evening
 * has no player rows at all, another has goals and no assists, and the
 * per-mini-game history only starts in July. Whether that unevenness produces a
 * wrong record is not something to settle by argument.
 */
import history from '../fixtures/club-history.json';
import {
  buildRoundSummary,
  nextRecordBaseline,
  type ClubRecordBaseline,
  type PersonalBest,
  type PlayerCareer,
  type PlayerEvening,
  type RoundRec,
  type RoundSummary,
  type StandingRec,
} from '@/utils/roundSummary';

interface Evening {
  gameId: string;
  at: number;
  players: PlayerEvening[];
  rounds: RoundRec[];
  standings: StandingRec[];
}

/** Replay the club's history the way a backfill would have to: strictly in
 *  order, with every evening measured only against the ones before it. */
function replay(evenings: Evening[]) {
  let records: ClubRecordBaseline | null = null;
  const bests: Record<string, PersonalBest> = {};
  const career = new Map<string, PlayerCareer>();
  const club = { goals: 0, assists: 0, rounds: 0, cleanSheets: 0, shootoutRounds: 0, evenings: 0 };
  const out: { evening: Evening; summary: RoundSummary }[] = [];
  let sealed = 0;

  for (const e of evenings) {
    for (const p of e.players) {
      const c = career.get(p.userId) ?? {
        userId: p.userId, goals: 0, assists: 0, rounds: 0, wins: 0, cleanSheets: 0, games: 0,
      };
      c.goals += p.goals;
      c.assists += p.assists;
      c.rounds += p.rounds;
      c.wins += p.wins;
      c.cleanSheets += p.cleanSheets;
      c.games += 1;
      career.set(p.userId, c);
      club.goals += p.goals;
      club.assists += p.assists;
      club.cleanSheets += p.cleanSheets;
    }
    club.rounds += e.rounds.length;
    club.shootoutRounds += e.rounds.filter((r) => r.shootout).length;
    club.evenings += 1;

    const summary = buildRoundSummary({
      gameId: e.gameId,
      groupId: history.groupId,
      at: e.at,
      players: e.players,
      rounds: e.rounds,
      career: Array.from(career.values()),
      club: { ...club },
      records,
      personalBests: JSON.parse(JSON.stringify(bests)),
      standings: e.standings,
      basis: { since: evenings[0].at, eveningsCompared: sealed },
      now: e.at + 1000,
    });
    out.push({ evening: e, summary });

    records = nextRecordBaseline(records, summary, e.players);
    for (const p of e.players) {
      if (p.isGuest) continue;
      const prev = bests[p.userId] ?? {};
      bests[p.userId] = {
        goals: Math.max(prev.goals ?? 0, p.goals),
        assists: Math.max(prev.assists ?? 0, p.assists),
        involvement: Math.max(prev.involvement ?? 0, p.goals + p.assists),
        cleanSheets: Math.max(prev.cleanSheets ?? 0, p.cleanSheets),
        wins: Math.max(prev.wins ?? 0, p.wins),
      };
    }
    sealed += 1;
  }
  return { summaries: out, records };
}

const { summaries, records } = replay(history.evenings as Evening[]);

it('replays every finished evening without falling over on the gaps', () => {
  expect(summaries).toHaveLength(history.evenings.length);
  // The first evening in this club's history has no player rows at all. It must
  // produce an empty-but-valid summary rather than throw or invent one.
  expect(summaries[0].summary.stats).toEqual({ rounds: 0, goals: 0, assists: 0, shootouts: 0 });
  expect(summaries[0].summary.leaders.topScorers).toBeNull();
});

it('claims no record until there is enough history to measure one', () => {
  // Five evenings of basis, so the first five carry numbers and titles only.
  for (const { summary } of summaries.slice(0, 5)) {
    expect(summary.events.filter((e) => e.type === 'club_record')).toHaveLength(0);
    expect(summary.events.filter((e) => e.type === 'personal_record')).toHaveLength(0);
    expect(summary.events.filter((e) => e.type === 'first_ever')).toHaveLength(0);
  }
});

it('never announces the same first-ever twice across the whole history', () => {
  const seen = new Set<string>();
  for (const { summary } of summaries) {
    for (const e of summary.events) {
      if (e.type !== 'first_ever') continue;
      expect(seen.has(e.code)).toBe(false);
      seen.add(e.code);
    }
  }
});

it('ends with a record baseline that matches the best evening ever played', () => {
  // Independently: the highest single-evening figure anywhere in the history.
  const best = { goals: 0, assists: 0, cleanSheets: 0, wins: 0 };
  for (const e of history.evenings as Evening[]) {
    for (const p of e.players) {
      if (p.isGuest) continue;
      best.goals = Math.max(best.goals, p.goals);
      best.assists = Math.max(best.assists, p.assists);
      best.cleanSheets = Math.max(best.cleanSheets, p.cleanSheets);
      best.wins = Math.max(best.wins, p.wins);
    }
  }
  expect(records?.goals?.value).toBe(best.goals);
  expect(records?.assists?.value).toBe(best.assists);
  expect(records?.cleanSheets?.value).toBe(best.cleanSheets);
  expect(records?.wins?.value).toBe(best.wins);
});

it('is deterministic — the same history replays to the same summaries', () => {
  const again = replay(history.evenings as Evening[]);
  expect(JSON.stringify(again.summaries.map((s) => s.summary))).toBe(
    JSON.stringify(summaries.map((s) => s.summary)),
  );
});

it('reports what the club would actually have been told', () => {
  const lines: string[] = [];
  for (const { evening, summary } of summaries) {
    const d = new Date(evening.at).toISOString().slice(0, 10);
    const s = summary.stats;
    lines.push(
      `${d}  ${s.rounds} mini-games · ${s.goals}g · ${s.assists}a · ${s.shootouts} shootouts` +
        `  → ${summary.events.length} event(s): ` +
        summary.events.map((e) => e.type).join(', '),
    );
  }
  // eslint-disable-next-line no-console
  console.log('\n' + lines.join('\n') + '\n');
  expect(lines).toHaveLength(summaries.length);
});
