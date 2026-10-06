/**
 * The season control, as the two screens that share it see it.
 *
 * Extracted from `CommunityStatsScreen` so the two-player screen could use the
 * same one. These tests pin the behaviour that mattered enough to be written
 * into the original: which options a club is offered, and — the one that
 * decides whether 210 of the app's 211 clubs see a dropdown at all — whether
 * the row appears.
 */
import {
  buildScopeOptions,
  clubHasScopes,
  scopeTitleOf,
  type StatsScope,
} from '@/utils/statsScope';
import { he } from '@/i18n/he';
import type { GroupSeasons } from '@/types';

const running = (no: number, closed = 0): GroupSeasons => ({
  enabled: true,
  currentNo: no,
  currentId: `s${no}`,
  startedAt: 0,
  cadence: { type: 'rounds', targetRounds: 20 },
  count: closed,
});

const CURRENT: StatsScope = { k: 'current' };

describe('which clubs see the control at all', () => {
  it('a club that runs seasons does', () => {
    expect(clubHasScopes(running(2, 1), [])).toBe(true);
  });

  it('a club that has CLOSED one but switched the feature off still does', () => {
    // Its history did not stop existing because the switch did.
    expect(
      clubHasScopes({ ...running(2, 1), enabled: false }, [{ seasonId: 's1', no: 1 }]),
    ).toBe(true);
  });

  it('a club with no seasons at all does NOT', () => {
    // 210 of 211 clubs. A dropdown with one option is a question with no
    // second answer, so the caller hides the whole row.
    expect(clubHasScopes(undefined, [])).toBe(false);
    expect(clubHasScopes({ ...running(1), enabled: false, count: 0 }, [])).toBe(false);
  });
});

describe('the options offered', () => {
  it('a club mid-first-season gets ONE option — no "all", nothing past', () => {
    const o = buildScopeOptions(running(1), [], CURRENT);
    expect(o.map((x) => x.key)).toEqual(['current']);
    expect(o[0].text).toBe(he.communityStatsScopeCurrent(1));
    expect(o[0].active).toBe(true);
  });

  it('once a season has closed, "all" appears — between current and the past', () => {
    const o = buildScopeOptions(running(2, 1), [{ seasonId: 's1', no: 1 }], CURRENT);
    expect(o.map((x) => x.key)).toEqual(['current', 'all', 's1']);
  });

  it('past seasons come through in the order handed over (newest first)', () => {
    const o = buildScopeOptions(
      running(4, 3),
      [
        { seasonId: 's3', no: 3 },
        { seasonId: 's2', no: 2 },
        { seasonId: 's1', no: 1 },
      ],
      CURRENT,
    );
    expect(o.map((x) => x.key)).toEqual(['current', 'all', 's3', 's2', 's1']);
    expect(o[2].text).toBe(he.communityStatsScopePast(3));
  });

  it('a club that switched seasons OFF names the live slice differently', () => {
    // There is no running season — the switch-off closed it — so the line
    // says what the live rows actually are instead of naming a season that
    // never ran.
    const o = buildScopeOptions(
      { ...running(3, 2), enabled: false },
      [{ seasonId: 's2', no: 2 }],
      CURRENT,
    );
    expect(o[0].text).toBe(he.communityStatsScopeSinceOff(2));
  });

  it('exactly one option is active, and it is the chosen one', () => {
    const past = [{ seasonId: 's1', no: 1 }];
    const o = buildScopeOptions(running(2, 1), past, { k: 'season', id: 's1' });
    expect(o.filter((x) => x.active).map((x) => x.key)).toEqual(['s1']);
  });

  it('selecting "all" activates all and nothing else', () => {
    const o = buildScopeOptions(running(2, 1), [{ seasonId: 's1', no: 1 }], { k: 'all' });
    expect(o.filter((x) => x.active).map((x) => x.key)).toEqual(['all']);
  });

  it('a scope pointing at a season the club does not have activates nothing', () => {
    // Not a crash and not a silent fallback to "current": the bar shows the
    // first option's text and the list shows no tick, which is visibly odd —
    // better than quietly relabelling the slice on screen.
    const o = buildScopeOptions(running(2, 1), [{ seasonId: 's1', no: 1 }], {
      k: 'season',
      id: 'nope',
    });
    expect(o.some((x) => x.active)).toBe(false);
  });
});

describe('the closed bar label', () => {
  it('is the active option own text', () => {
    const o = buildScopeOptions(running(2, 1), [{ seasonId: 's1', no: 1 }], { k: 'all' });
    expect(scopeTitleOf(o)).toBe(he.communityStatsScopeAllTime);
  });

  it('falls back to the first option when nothing is active', () => {
    const o = buildScopeOptions(running(2, 1), [], { k: 'season', id: 'gone' });
    expect(scopeTitleOf(o)).toBe(he.communityStatsScopeCurrent(2));
  });

  it('is empty for a club with no options rather than throwing', () => {
    expect(scopeTitleOf([])).toBe('');
  });
});
