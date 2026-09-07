// A team that emptied out mid-evening.
//
// Fifteen players in three teams, five go home, one team is left with nobody —
// and the rotation still has it queued. Finishing the mini-game brings the empty
// team on and the fill logic offers to borrow five players into it, which is
// where the team statistics break.

import {
  emptyWaitingTeams,
  remainingTeams,
  retirePrompt,
  withoutTeam,
  canContinueWithout,
} from '@/utils/emptyTeamRetire';

const T = (index: number, n: number, colorKey?: string) => ({
  index,
  colorKey,
  playerIds: Array.from({ length: n }, (_, i) => `p${index}-${i}`),
});

/** Red(0) playing Blue(1), Green(2) waiting — the reported evening. */
const rot = { playing: [0, 1] as [number, number], waiting: [2] };

describe('spotting the empty team', () => {
  it('finds a waiting team with nobody on it', () => {
    expect(emptyWaitingTeams(rot, [T(0, 5), T(1, 5), T(2, 0)])).toEqual([2]);
  });

  it('says nothing while every waiting team still has players', () => {
    expect(emptyWaitingTeams(rot, [T(0, 5), T(1, 5), T(2, 5)])).toEqual([]);
  });

  it('ignores a team that is EMPTY but currently PLAYING', () => {
    // Dropping a side mid-mini-game would erase a result in progress. The
    // question comes up after the round ends, when it is waiting.
    expect(emptyWaitingTeams(rot, [T(0, 0), T(1, 5), T(2, 5)])).toEqual([]);
  });

  it('handles several empty teams at once', () => {
    const four = { playing: [0, 1] as [number, number], waiting: [2, 3] };
    expect(emptyWaitingTeams(four, [T(0, 5), T(1, 5), T(2, 0), T(3, 0)])).toEqual([2, 3]);
  });

  it('is quiet with no rotation at all', () => {
    expect(emptyWaitingTeams(null, [T(0, 5)])).toEqual([]);
    expect(emptyWaitingTeams(rot, null)).toEqual([]);
  });
});

describe('the question, in the evening\'s real colours', () => {
  it('names the teams by colour, never by letter', () => {
    const teams = [T(0, 0), T(1, 5), T(2, 5)];
    const p = retirePrompt(0, remainingTeams(rot, teams, 0), teams);
    expect(p.title).toBe('האדומים נשארו בלי שחקנים');
    expect(p.body).toBe('כולם הלכו הביתה. להמשיך את הערב רק עם הכחולים והירוקים?');
    expect(p.body).not.toMatch(/[א-ה]׳/);
  });

  it('honours a colour the admin actually chose', () => {
    // Index 2 defaults to green; this evening picked black for it.
    const teams = [T(0, 0), T(1, 5, 'yellow'), T(2, 5, 'black')];
    const p = retirePrompt(0, remainingTeams(rot, teams, 0), teams);
    expect(p.body).toBe('כולם הלכו הביתה. להמשיך את הערב רק עם הצהובים והשחורים?');
  });

  it('joins three remaining teams with commas and a final ו', () => {
    const four = { playing: [0, 1] as [number, number], waiting: [2, 3] };
    const teams = [T(0, 5), T(1, 5), T(2, 5), T(3, 0)];
    const p = retirePrompt(3, remainingTeams(four, teams, 3), teams);
    expect(p.body).toBe('כולם הלכו הביתה. להמשיך את הערב רק עם האדומים, הכחולים והירוקים?');
  });

  it('says so plainly when nothing is left to play with', () => {
    const solo = { playing: [0, 1] as [number, number], waiting: [] as number[] };
    const p = retirePrompt(1, remainingTeams(solo, [T(0, 5), T(1, 0)], 1), [T(0, 5), T(1, 0)]);
    expect(p.body).toContain('לא נשארו מספיק קבוצות');
  });
});

describe('what continuing actually does', () => {
  it('drops the team from the queue and leaves the rest alone', () => {
    expect(withoutTeam(rot, 2)).toEqual({ waiting: [] });
    const four = { playing: [0, 1] as [number, number], waiting: [2, 3] };
    expect(withoutTeam(four, 2)).toEqual({ waiting: [3] });
  });

  it('an empty queue is the whole point — the engine keeps the same two on', () => {
    // recordWinner already keeps `rotation.playing` when nothing is waiting,
    // so dropping the third team IS the fix; nothing new has to be invented.
    expect(withoutTeam(rot, 2).waiting).toHaveLength(0);
  });

  it('two teams left is playable; one is not', () => {
    expect(canContinueWithout(rot, [T(0, 5), T(1, 5), T(2, 0)], 2)).toBe(true);
    // Blue also emptied — only red has players, so there is no game.
    expect(canContinueWithout(rot, [T(0, 5), T(1, 0), T(2, 0)], 2)).toBe(false);
  });

  it('a team with players is never counted as playable after being dropped', () => {
    expect(remainingTeams(rot, [T(0, 5), T(1, 5), T(2, 5)], 1)).toEqual([0, 2]);
  });
});
