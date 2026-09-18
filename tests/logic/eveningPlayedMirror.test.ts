/**
 * Five rules exist twice and must stay identical.
 *
 * Cloud Functions cannot import from the app source, so `functions/src/
 * eveningPlayed.ts` is a copy of `src/utils/eveningPlayed.ts`, and the same is
 * true of four more. A copy that drifts is worse than no copy: this is the
 * exact failure those modules were written to end — the server crediting an
 * evening by one rule while the app shows it by another — so letting the two
 * halves diverge would rebuild the bug inside the fix for it.
 *
 * TWO checks, and the second one is the one that matters.
 *
 * The text check below says the copy is a copy. It is cheap and it is exact,
 * and on its own it is not evidence of anything: two byte-identical copies of a
 * WRONG rule pass it, and nothing in this file ever EXECUTED the server copy —
 * so the whole server half of five rules had no test at all, only a diff. The
 * repo already had the better pattern next door in balanceParity.test.ts, which
 * loads both modules and runs them.
 *
 * So each pair is also run, side by side, over inputs that reach every branch
 * it has. Not a re-listing of the spec — the spec is tested once, against the
 * client copy, in its own file — but a differential: same input, same answer,
 * whichever side of the wire you are on.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const MARKER =
  '// ---- everything below this line is a copy of the client file ----';

describe.each([
  ['eveningPlayed', 'src/utils/eveningPlayed.ts', 'functions/src/eveningPlayed.ts'],
  [
    'seasonParticipants',
    'src/utils/seasonParticipants.ts',
    'functions/src/seasonParticipants.ts',
  ],
  ['seasonSeed', 'src/utils/seasonSeed.ts', 'functions/src/seasonSeed.ts'],
  ['seasonDates', 'src/utils/seasonDates.ts', 'functions/src/seasonDates.ts'],
  [
    'seasonActivation',
    'src/utils/seasonActivation.ts',
    'functions/src/seasonActivation.ts',
  ],
])('the two copies of %s', (_name, clientPath, serverPath) => {
  // The paths the table declares, not one file hard-coded five times.
  //
  // This block read `src/utils/eveningPlayed.ts` regardless of which row was
  // running, so four of the five mirrors were never compared at all and the
  // suite reported ten green assertions that were two assertions run five
  // times. seasonSeed decides `roundsAtStart` and `playedRounds` for every
  // season the server opens, seasonActivation decides what "continue" means,
  // seasonParticipants decides the "0 שחקנים" number — all four could drift
  // from the client copy with this test passing.
  const client = fs.readFileSync(path.join(ROOT, clientPath), 'utf8');
  const server = fs.readFileSync(path.join(ROOT, serverPath), 'utf8');

  it('the server copy declares itself a copy', () => {
    expect(server).toContain(MARKER);
  });

  it('and is byte-identical to the client file below the marker', () => {
    const copied = server
      .slice(server.indexOf(MARKER) + MARKER.length)
      .replace(/^\n+/, '')
      // Cloud Functions have no `@/` alias, so that one line is allowed to
      // differ — and ONLY that one.
      .replace(/from '\.\/seasonDates'/g, "from '@/utils/seasonDates'");
    expect(copied).toBe(client);
  });
});

// ── And now run them ───────────────────────────────────────────────────────

describe('eveningPlayed answers the same on both sides', () => {
  const load = async () => [
    await import('@/utils/eveningPlayed'),
    await import('../../functions/src/eveningPlayed'),
  ];

  /**
   * Every field the rule reads, crossed with itself.
   *
   * 4 statuses × 4 endings × 3 verdicts × 10 evidence shapes = 480 evenings,
   * which covers every branch of the decision — the legacy fallthrough, the
   * admin override in both directions, each evidence source on its own, and
   * the empty live state that is the absence of evidence rather than evidence.
   */
  const STATUSES = ['finished', 'cancelled', 'active', 'open'];
  const ENDINGS = [undefined, 'admin', 'auto', 'sweep'];
  const VERDICTS = [undefined, true, false];
  const EVIDENCE: Array<Record<string, unknown>> = [
    {},
    { liveMatch: { startedAt: 1_700_000_000_000 } },
    { liveMatch: { phase: 'roundRunning' } },
    { liveMatch: { activeIntervals: [{ from: 1, to: 2 }] } },
    { liveMatch: { timerEvents: [{ type: 'start', at: 1 }] } },
    { liveMatch: { timerAccumulatedMs: 1 } },
    { liveMatch: { goals: [{ scorerId: 'u1' }] } },
    { committedRoundCount: 3 },
    { rotation: { round: 1 } },
    // The club that opened the live screen, built teams and went home.
    {
      liveMatch: {
        phase: 'organizing',
        activeIntervals: [],
        timerEvents: [],
        timerAccumulatedMs: 0,
        startedAt: null,
        goals: [],
        scoreA: 0,
        scoreB: 0,
      },
      committedRoundCount: 0,
    },
  ];

  const matrix = STATUSES.flatMap((status) =>
    ENDINGS.flatMap((endedBy) =>
      VERDICTS.flatMap((playVerified) =>
        EVIDENCE.map((ev) => ({
          status,
          ...(endedBy ? { endedBy } : {}),
          ...(playVerified === undefined ? {} : { playVerified }),
          ...ev,
        })),
      ),
    ),
  );

  it('over every combination of the fields it reads', async () => {
    const [app, server] = await load();
    // 480 evenings. Compared as one array so a single divergence names the
    // evening it happened on rather than only the count.
    const answers = matrix.map((g) => ({
      app: app.eveningPlayStateWithReason(g as never),
      server: server.eveningPlayStateWithReason(g as never),
    }));
    const drifted = matrix.filter(
      (_g, i) =>
        answers[i].app.state !== answers[i].server.state ||
        answers[i].app.reason !== answers[i].server.reason,
    );
    expect(drifted).toEqual([]);
    // And the matrix really does exercise the rule rather than answering one
    // way 480 times.
    expect(new Set(answers.map((a) => a.app.state)).size).toBe(4);
  });

  it('including the shorthands every caller actually uses', async () => {
    const [app, server] = await load();
    for (const g of matrix) {
      expect(server.didEveningHappen(g as never)).toBe(
        app.didEveningHappen(g as never),
      );
      expect(server.needsPlayVerification(g as never)).toBe(
        app.needsPlayVerification(g as never),
      );
    }
    expect(server.didEveningHappen(null)).toBe(app.didEveningHappen(null));
  });
});

describe('seasonParticipants answers the same on both sides', () => {
  it('including the timer-only rows that made it report 0 שחקנים', async () => {
    const app = await import('@/utils/seasonParticipants');
    const server = await import('../../functions/src/seasonParticipants');
    const cases: Array<
      Record<string, { games?: unknown; rounds?: unknown }> | undefined
    > = [
      undefined,
      {},
      // The common club: evenings attended, never a mini-game.
      { a: { games: 18 }, b: { games: 7 }, c: { games: 0 } },
      // Advanced mode.
      { a: { rounds: 37 }, b: { rounds: 0 } },
      // A row credited a mini-game with no evening — the safety net.
      { a: { rounds: 2, games: 0 } },
      // Departed members, wound back to zeros and never deleted.
      { a: { games: 0, rounds: 0 }, b: { games: 0, rounds: 0 } },
      { a: { games: '18' }, b: { games: NaN } },
    ];
    for (const c of cases) {
      expect(server.countSeasonParticipants(c)).toBe(
        app.countSeasonParticipants(c),
      );
    }
  });
});

describe('seasonSeed answers the same on both sides', () => {
  it('for every shape a club document has arrived in', async () => {
    const app = await import('@/utils/seasonSeed');
    const server = await import('../../functions/src/seasonSeed');
    const nums = [0, 7, 10, 22, 200, -3, 2.7, NaN, Infinity];
    for (const sealed of nums) {
      for (const history of nums) {
        expect(server.seasonSeed(sealed, history)).toEqual(
          app.seasonSeed(sealed, history),
        );
      }
      expect(server.seasonSeed(sealed)).toEqual(app.seasonSeed(sealed));
    }
  });
});

describe('seasonDates answers the same on both sides', () => {
  it('over three years of month ends, leap day included', async () => {
    const app = await import('@/utils/seasonDates');
    const server = await import('../../functions/src/seasonDates');
    const starts = [
      '2026-01-31',
      '2026-02-28',
      '2028-02-29', // the leap day, which is where month arithmetic breaks
      '2026-03-31',
      '2026-08-17',
      '2026-12-31',
    ];
    for (const d of starts) {
      for (const months of [1, 2, 3, 6, 12, 24]) {
        expect(server.seasonEndDate(d, months)).toBe(
          app.seasonEndDate(d, months),
        );
        expect(server.addMonths(d, months)).toBe(app.addMonths(d, months));
      }
      expect(server.nextSeasonStart(d)).toBe(app.nextSeasonStart(d));
      expect(server.previousDay(d)).toBe(app.previousDay(d));
      expect(server.nextDay(d)).toBe(app.nextDay(d));
      expect(server.formatCalendarDate(d)).toBe(app.formatCalendarDate(d));
      for (const other of starts) {
        expect(server.isSeasonOver(d, other)).toBe(app.isSeasonOver(d, other));
        expect(server.compareDates(d, other)).toBe(app.compareDates(d, other));
        expect(server.monthsBetween(d, other)).toBe(app.monthsBetween(d, other));
      }
    }
    for (const v of [null, undefined, '', '2026-13-01', '2026-2-1', 3, '2026-02-30']) {
      expect(server.isCalendarDate(v)).toBe(app.isCalendarDate(v));
    }
    for (const n of [0, 1, 12, 24, 25, -1, 1.5, '6', null]) {
      expect(server.isValidSeasonMonths(n)).toBe(app.isValidSeasonMonths(n));
    }
  });

  it('and agree on what today is, in the club’s timezone', async () => {
    const app = await import('@/utils/seasonDates');
    const server = await import('../../functions/src/seasonDates');
    // Around a UTC midnight, which is where a server running in UTC and a
    // phone in the club's timezone disagree about the date.
    for (const at of [1_789_500_000_000, 1_789_527_600_000, 1_789_531_199_000]) {
      expect(server.todayIn(undefined, at)).toBe(app.todayIn(undefined, at));
    }
  });
});

describe('seasonActivation answers the same on both sides', () => {
  it('for every plan the settings screen can submit', async () => {
    const app = await import('@/utils/seasonActivation');
    const server = await import('../../functions/src/seasonActivation');
    const inputs = [] as Array<Parameters<typeof app.planActivation>[0]>;
    for (const cadence of ['rounds', 'date'] as const) {
      for (const choice of ['continue', 'sealNow'] as const) {
        for (const playedHistory of [0, 19, 22, 24, 30]) {
          for (const hasHistory of [false, true]) {
            inputs.push({
              cadence,
              choice,
              playedHistory,
              hasHistory,
              months: 6,
              targetRounds: 24,
              today: '2026-09-18',
              ...(cadence === 'date' && !hasHistory
                ? { season1EndsOn: '2026-12-31' }
                : {}),
            });
          }
        }
      }
    }
    // The refusals too: an invalid length and a one-evening season are the two
    // the server is the last line of defence for.
    inputs.push(
      { cadence: 'rounds', choice: 'continue', playedHistory: 0, targetRounds: 1, today: '2026-09-18' },
      { cadence: 'date', choice: 'continue', playedHistory: 0, months: 0, today: '2026-09-18' },
      { cadence: 'date', choice: 'continue', playedHistory: 0, months: 6, today: '2026-09-18', season1EndsOn: '2026-09-18' },
    );
    for (const input of inputs) {
      expect(server.planActivation(input)).toEqual(app.planActivation(input));
    }
    expect(server.MIN_SEASON_ROUNDS).toBe(app.MIN_SEASON_ROUNDS);
    for (const n of [1, 2, 24, 2.5, -1, null]) {
      expect(server.isValidSeasonRounds(n)).toBe(app.isValidSeasonRounds(n));
    }
  });
});
