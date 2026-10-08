import { eveningHighlights, personalEveningRecords } from '@/utils/eveningHighlights';
import type { NarrativeStats } from '@/utils/eveningNarrative';

const s: NarrativeStats = { goals: 2, assists: 3, wins: 4, losses: 3, gamesPlayed: 7, totalRounds: 12,
  heldPitch: 3, scoringStreak: 2, bestMiniGame: { round: 2, goals: 1, assists: 2 },
  pen: { scored: 1, saved: 2, missed: 1, conceded: 2 } };
describe('personal evening records', () => {
  it('distinguishes a new record from matching a positive old record', () => {
    expect(personalEveningRecords(s, [{ goals: 2, assists: 2, wins: 5 }], true)).toEqual([
      { metric: 'goals', value: 2, previous: 2, kind: 'equal' },
      { metric: 'assists', value: 3, previous: 2, kind: 'new' },
    ]);
  });
  it('does not invent records for a first evening, zero or incomplete history', () => {
    expect(personalEveningRecords(s, [], true)).toEqual([]);
    expect(personalEveningRecords({ goals: 0, assists: 0, wins: 0 }, [{ goals: 0, assists: 0, wins: 0 }], true)).toEqual([]);
    expect(personalEveningRecords(s, [{ goals: 1, assists: 1, wins: 1 }], false)).toEqual([]);
  });
  it('recognizes the first positive total after earlier documented zero evenings', () => {
    expect(personalEveningRecords({ goals: 1, assists: 0, wins: 0 },
      [{ goals: 0, assists: 0, wins: 0 }], true)).toEqual([{ metric: 'goals', value: 1, previous: 0, kind: 'new' }]);
  });
  it('uses all prior evenings, not just the previous evening', () => {
    expect(personalEveningRecords(s, [{ goals: 9, assists: 8, wins: 7 }, { goals: 1, assists: 1, wins: 1 }], true)).toEqual([]);
  });
  it('rejects invalid history per metric and invalid current values', () => {
    expect(personalEveningRecords({ goals: NaN, assists: 3, wins: -1 },
      [{ goals: 1, assists: NaN, wins: 1 }], true)).toEqual([]);
  });
});
describe('meaningful highlights', () => {
  it('shows real best-game, streak and penalty facts', () => {
    expect(eveningHighlights(s, true).map((h) => h.id)).toEqual(['best', 'held', 'streak', 'saved', 'penalty']);
  });
  it('suppresses history-derived claims if round history is incomplete', () => {
    expect(eveningHighlights(s, false)).toEqual([]);
  });
  it('has no effort/participation filler and no empty-night achievement', () => {
    expect(eveningHighlights({ ...s, goals: 0, assists: 0, wins: 0, heldPitch: 0, scoringStreak: 0,
      bestMiniGame: null, pen: { scored: 0, saved: 0, missed: 0, conceded: 0 } }, true)).toEqual([]);
  });
  it('recognizes a sweep without repeating the winner-stays highlight', () => {
    expect(eveningHighlights({ ...s, wins: 7 }, true).map((h) => h.id)).toContain('perfect');
    expect(eveningHighlights({ ...s, wins: 7 }, true).map((h) => h.id)).not.toContain('held');
  });
});
