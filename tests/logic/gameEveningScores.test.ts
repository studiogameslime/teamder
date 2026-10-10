import { readGameEveningScores } from '../../functions/src/gameEveningScores';
import { compareEveningScores, formatEveningScore } from '@/utils/eveningScoreColumn';
import { rankChampionshipRows } from '@/utils/championship';

const privateRows = [{ userId: 'a', score: 8.8, rankDelta: 4, metrics: ['private'], rank: 1 },
  { userId: 'b', score: 0 }, { userId: 'c', score: null }, { userId: 'd', score: Infinity },
  { userId: 'e', score: 99 }];
function setup(game: Record<string, unknown> | undefined, group?: Record<string, unknown>) {
  return { game: jest.fn().mockResolvedValue(game), group: jest.fn().mockResolvedValue(group),
    scores: jest.fn().mockResolvedValue(privateRows) };
}
describe('sealed evening scores permission and projection', () => {
  it.each(['createdBy', 'players', 'participantIds'])('allows the game audience via %s', async key => {
    const reads = setup({ [key]: key === 'createdBy' ? 'viewer' : ['viewer'] });
    expect(await readGameEveningScores('viewer', 'g', reads)).toEqual({ scores: { a: 8.8, b: 0 } });
    expect(reads.scores).toHaveBeenCalledWith('g');
    expect(reads.group).not.toHaveBeenCalled();
  });
  it.each(['playerIds', 'adminIds'])('allows club membership via %s', async key => {
    const reads = setup({ groupId: 'club' }, { [key]: ['viewer'] });
    expect(await readGameEveningScores('viewer', 'g', reads)).toEqual({ scores: { a: 8.8, b: 0 } });
    expect(reads.group).toHaveBeenCalledWith('club');
  });
  it('permits a signed-in viewer of a public game', async () => {
    const reads = setup({ visibility: 'public' });
    await expect(readGameEveningScores('anonymous-uid', 'g', reads)).resolves.toHaveProperty('scores.a', 8.8);
  });
  it('denies a private-game outsider before reading standings', async () => {
    const reads = setup({ groupId: 'club' }, { playerIds: ['other'], adminIds: [] });
    await expect(readGameEveningScores('viewer', 'g', reads)).rejects.toHaveProperty('code', 'permission-denied');
    expect(reads.scores).not.toHaveBeenCalled();
  });
  it('a waitlisted viewer alone has no extra access', async () => {
    const reads = setup({ waitlist: ['viewer'] });
    await expect(readGameEveningScores('viewer', 'g', reads)).rejects.toHaveProperty('code', 'permission-denied');
    expect(reads.scores).not.toHaveBeenCalled();
  });
  it('requires authentication even on a public game', async () => {
    const reads = setup({ visibility: 'public' });
    await expect(readGameEveningScores(undefined, 'g', reads)).rejects.toHaveProperty('code', 'unauthenticated');
    expect(reads.game).not.toHaveBeenCalled();
  });
  it.each(['', 'a/b', null, 14])('rejects invalid game id %s', async id => {
    const reads = setup({});
    await expect(readGameEveningScores('viewer', id, reads)).rejects.toHaveProperty('code', 'invalid-argument');
    expect(reads.game).not.toHaveBeenCalled();
  });
  it('does not turn a deleted game into an empty result', async () => {
    const reads = setup(undefined);
    await expect(readGameEveningScores('viewer', 'g', reads)).rejects.toHaveProperty('code', 'not-found');
    expect(reads.scores).not.toHaveBeenCalled();
  });
  it('propagates a backend read failure rather than claiming no ratings', async () => {
    const reads = setup({ createdBy: 'viewer' }); reads.scores.mockRejectedValue(new Error('offline'));
    await expect(readGameEveningScores('viewer', 'g', reads)).rejects.toThrow('offline');
  });
});
describe('evening score column', () => {
  it('distinguishes zero, missing and a one-decimal score', () => {
    expect(formatEveningScore(0)).toBe('0.0');
    expect(formatEveningScore(undefined)).toBe('—');
    expect(formatEveningScore(NaN)).toBe('—');
    expect(formatEveningScore(8.8)).toBe('8.8');
  });
  it('sorts by the selected evening rating, keeping missing values last, independently of points', () => {
    const rows = rankChampionshipRows([{ userId: 'points', goals: 50 }, { userId: 'best', goals: 1 },
      { userId: 'zero' }], 'points', true);
    expect(rows.sort(compareEveningScores({ best: 8.8, zero: 0 })).map(r => r.uid))
      .toEqual(['best', 'zero', 'points']);
  });
});
