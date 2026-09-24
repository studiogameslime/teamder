// Guard: every "join this match" surface goes through the same gate.
//
// `MatchDetailsScreen` checked `isGuest` and handed the intent to the
// coordinator. `GamesListScreen` had no `isGuest` in the file at all, so a
// guest tapping the CTA on a card called `requestJoinGame` with an anonymous
// uid — the one join surface that knew nothing about the three rounds of
// contextual auth built for exactly this. Same product action, two
// implementations, and the commoner one was wrong: the matches tab is a root,
// and Home's "לכל המחזורים" lands there.
//
// There is no renderer here, so the invariant is read from the sources — the
// same approach as hooksAfterEarlyReturn, and for the same reason.

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** Code only — these files explain their traps at length. */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const FEED = path.join('src', 'screens', 'games', 'GamesListScreen.tsx');
const DETAILS = path.join('src', 'screens', 'games', 'MatchDetailsScreen.tsx');

// ─── who may call the join service directly ───────────────────────────────

describe('a guest tapping Join', () => {
  const feed = code(FEED);

  it('is gated on the feed, which had no gate at all', () => {
    expect(feed).toContain('useIsGuest');
    expect(feed).toMatch(/if\s*\(\s*isGuest\s*&&/);
  });

  // The regression, stated directly: the gate must come BEFORE the service
  // call, not somewhere else in the file.
  it('never reaches requestJoinGame from the card handler', () => {
    const at = feed.indexOf('const handleCardPrimary');
    expect(at).toBeGreaterThan(-1);
    const body = feed.slice(at, feed.indexOf('gameService.requestJoinGame', at));
    expect(body).toMatch(/isGuest/);
    expect(body).toMatch(/authAction\.request\(/);
    // and the gate returns, so nothing below it runs for a guest
    expect(body).toMatch(/authAction\.request\([\s\S]{0,80}?\);\s*return;/);
  });

  it('produces a join_game intent, built by the shared helper', () => {
    expect(feed).toContain('guestJoinGameRequest');
    expect(code(path.join('src', 'services', 'guestJoin.ts'))).toContain("kind: 'join_game'");
  });

  it('sees the sheet, because the screen mounts it', () => {
    expect(feed).toContain('authAction.sheet');
  });
});

// ─── the two surfaces cannot drift again ──────────────────────────────────

describe('both join surfaces', () => {
  it('build the request from one place', () => {
    for (const f of [FEED, DETAILS]) {
      expect(code(f)).toContain('guestJoinGameRequest(');
    }
  });

  // The `execute` that must never run is written once. A screen writing its
  // own would be free to write one that silently succeeds.
  it('do not carry their own executor', () => {
    for (const f of [FEED, DETAILS]) {
      expect(code(f)).not.toMatch(/unreachable: guest actions resume/);
    }
    expect(code(path.join('src', 'services', 'guestJoin.ts'))).toMatch(
      /unreachable: guest actions resume/,
    );
  });
});

// ─── a full account is untouched ──────────────────────────────────────────

describe('a full account', () => {
  // The gate is conditional on `isGuest`, so the direct path below it is the
  // same code it always was — no second join implementation was introduced.
  it('still joins directly from the feed', () => {
    const feed = code(FEED);
    expect(feed).toMatch(/gameService\.requestJoinGame\(/);
  });

  it('still joins directly from the match screen', () => {
    expect(code(DETAILS)).toMatch(/gameService\.requestJoinGame\(/);
  });
});

// ─── the outcome reaches the person ───────────────────────────────────────

describe('a resumed action', () => {
  const hook = code(path.join('src', 'hooks', 'useAuthenticatedAction.tsx'));
  const nav = code(path.join('src', 'navigation', 'RootNavigator.tsx'));

  // Both callers used to discard the result. Only one can win the
  // coordinator's lock for a given action, which is what keeps the message to
  // exactly one.
  it.each([
    ['useAuthenticatedAction', hook],
    ['RootNavigator', nav],
  ])('reports its outcome — %s', (_name, src) => {
    expect(src).toContain('reportResumeOutcome');
    expect(src).toMatch(/status === 'ran'/);
  });

  // The kind has to ride along: "you are on the waitlist" reads differently
  // for a match than for a club, and the outcome alone cannot say which.
  it('knows which kind it was', () => {
    const coord = code(path.join('src', 'services', 'actionCoordinator.ts'));
    expect(coord).toMatch(/status: 'ran', kind: action\.kind/);
  });

  // Feedback is not part of the transaction: it runs after the outcome is
  // terminal and the stash is cleared.
  it('comes after cleanup, not inside it', () => {
    const coord = code(path.join('src', 'services', 'actionCoordinator.ts'));
    const at = coord.indexOf("return { status: 'ran'");
    expect(coord.slice(0, at)).toMatch(/clearAll\(/);
    expect(coord).not.toContain('reportResumeOutcome');
  });
});

// ─── nothing else moved ───────────────────────────────────────────────────

describe('the rest of the chain', () => {
  // The notification offer still fires from the coordinator, after cleanup —
  // this round must not have reordered it.
  it('still announces the notification context after cleanup', () => {
    const coord = code(path.join('src', 'services', 'actionCoordinator.ts'));
    const hits = [...coord.matchAll(/announceOfferFor\(/g)].map((m) => m.index ?? -1);
    expect(hits).toHaveLength(2);
    for (const at of hits) {
      expect(coord.slice(Math.max(0, at - 400), at)).toMatch(/clearAll\(/);
    }
  });

  it('still clears the stash only on a terminal result', () => {
    const coord = code(path.join('src', 'services', 'actionCoordinator.ts'));
    expect(coord).toMatch(/if \(result\.terminal\)/);
  });
});
