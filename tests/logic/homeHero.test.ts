import { pickHomeHero } from '@/utils/homeHero';

// Stand-ins for games; only the ordering matters here.
const mine = { id: 'mine' };
const open1 = { id: 'open-tomorrow' };
const open2 = { id: 'open-later' };
const soon = { id: 'scheduled-next-week' };

describe('which card the home screen leads with', () => {
  it('a game I am in wins over everything', () => {
    expect(pickHomeHero([mine], [open1], [soon])).toEqual({
      kind: 'mine',
      game: mine,
    });
  });

  it('a game I can still join beats one that has not opened yet', () => {
    // THE BUG, in one line. On 18.08 registration for the next night opened at
    // 10:00; a member who had not yet joined was shown the teaser for a game
    // eight days out, while 11 of 15 places went in nine minutes.
    expect(pickHomeHero([], [open1], [soon])).toEqual({
      kind: 'openToJoin',
      game: open1,
    });
  });

  it('falls back to the coming-soon teaser only when there is nothing to join', () => {
    expect(pickHomeHero([], [], [soon])).toEqual({
      kind: 'scheduled',
      game: soon,
    });
  });

  it('shows nothing when there is nothing at all', () => {
    expect(pickHomeHero([], [], [])).toEqual({ kind: 'none', game: null });
  });

  it('takes the soonest of each list — the caller sorts, we take the head', () => {
    expect(pickHomeHero([], [open1, open2], [soon]).game).toBe(open1);
  });

  it('a registered game wins even when a joinable one is sooner', () => {
    // Deliberate: a commitment outranks an invitation, however close.
    expect(pickHomeHero([mine], [open1], []).kind).toBe('mine');
  });
});
