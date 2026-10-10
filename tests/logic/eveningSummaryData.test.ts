jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => `${collection}/${id}`,
  collection: (_db: unknown, ...path: string[]) => path.join('/'),
  getDoc: jest.fn(), getDocs: jest.fn(),
}));
jest.mock('@/firebase/config', () => ({ USE_MOCK_DATA: false, getFirebase: () => ({ db: {} }) }));
jest.mock('@/services/gameService', () => ({ gameService: { getGameById: jest.fn() } }));
jest.mock('@/services/userService', () => ({ userService: { getUserById: async () => ({ name: 'אורי' }) } }));
jest.mock('@/services/errorLog', () => ({ logError: jest.fn() }));
jest.mock('@/services/eveningRecordService', () => ({ readPersonalEveningRecords: jest.fn() }));
import { getDoc, getDocs } from 'firebase/firestore';
import { gameService } from '@/services/gameService';
import { eveningSummaryService } from '@/services/eveningSummaryService';
import { readPersonalEveningRecords } from '@/services/eveningRecordService';
const stat = { goals: 0, assists: 1, wins: 1, losses: 1, rounds: 2 };
const round = (teamA: string[], teamB: string[], scoreA: number, scoreB: number, at: number) => ({
  roundId: String(at), teamA, teamB, scoreA, scoreB, winnerSide: 'A', at,
  goals: [{ scorerId: null, assisterId: null, ownGoal: true, team: 'A' }],
});
const rounds = [round(['u'], ['v'], 2, 1, 1), round(['v'], ['u'], 1, 0, 2)];
const snap = (data?: unknown) => ({ exists: () => data != null, data: () => data, metadata: { fromCache: false } });
function setup(row: unknown = stat, history: unknown[] = rounds, stand: unknown = { score: 8.9, scoreRank: 2, scoreTotal: 4 }) {
  (getDoc as jest.Mock).mockImplementation(async (path: string) => path.startsWith('gamePlayerStats/')
    ? snap(row) : path.startsWith('eveningStandings/') ? snap(stand) : snap());
  (getDocs as jest.Mock).mockResolvedValue({ docs: history.map((data) => ({ data: () => data })) });
  (gameService.getGameById as jest.Mock).mockResolvedValue({ id: 'g', groupId: 'club', status: 'finished', startsAt: 10, title: 'מועדון' });
}
describe('summary data authority', () => {
  beforeEach(() => { jest.clearAllMocks(); setup(); });
  it('keeps the server score and uses exact final scores including own goals', async () => {
    const m = await eveningSummaryService.getEveningSummary('g', 'u');
    expect(m?.score).toBe(8.9);
    expect(m?.outcomes).toEqual(['win', 'loss']);
    expect(m?.teamGoalsFor).toBe(2);
    expect(m?.teamGoalsAgainst).toBe(2);
    expect(m?.teamGoalsKnown).toBe(true);
    expect(m?.personalRecords).toEqual([]);
    expect(readPersonalEveningRecords).not.toHaveBeenCalled();
  });
  it('suppresses chronological and team-score claims on incomplete event history', async () => {
    setup(stat, rounds.slice(0, 1));
    const m = await eveningSummaryService.getEveningSummary('g', 'u');
    expect(m?.outcomes).toBeUndefined();
    expect(m?.totalKnown).toBe(false);
    expect(m?.teamGoalsKnown).toBe(false);
  });
  it('uses authoritative penalty and team totals even when event history is incomplete', async () => {
    setup({ ...stat, penSaved: 2, penConceded: 1, teamGoalsFor: 5, teamGoalsAgainst: 4 }, []);
    const m = await eveningSummaryService.getEveningSummary('g', 'u');
    expect(m?.penalties).toEqual({ saved: 2, conceded: 1, scored: 0, missed: 0 });
    expect(m?.highlights?.map((h) => h.id)).toEqual(['saved']);
    expect(m?.teamGoalsFor).toBe(5);
    expect(m?.teamGoalsKnown).toBe(true);
  });
  it('does not create a chronological sequence when aggregate and event results disagree', async () => {
    setup({ ...stat, wins: 2, losses: 0 });
    expect((await eveningSummaryService.getEveningSummary('g', 'u'))?.outcomes).toBeUndefined();
  });
  it('does not offer club records or a club table for a quick game', async () => {
    (gameService.getGameById as jest.Mock).mockResolvedValue({ id: 'g', groupId: 'hidden', startsAt: 10, status: 'finished', isOrphanContext: true });
    const m = await eveningSummaryService.getEveningSummary('g', 'u');
    expect(m?.recordScope).toBeUndefined();
    expect(m?.rank).toBeNull();
  });
  it('optional record failure does not remove the loaded summary', async () => {
    const m = await eveningSummaryService.getEveningSummary('g', 'u');
    (readPersonalEveningRecords as jest.Mock).mockRejectedValue(new Error('offline'));
    expect(await eveningSummaryService.getPersonalRecords(m!)).toEqual([]);
    expect(m?.score).toBe(8.9);
  });
  it('propagates a failed authoritative stat read instead of claiming the player did not play', async () => {
    (getDoc as jest.Mock).mockImplementation(async (path: string) => {
      if (path.startsWith('gamePlayerStats/')) throw new Error('offline');
      return snap();
    });
    await expect(eveningSummaryService.getEveningSummary('g', 'u')).rejects.toThrow('offline');
  });
  it('propagates a failed game read, but treats a missing stat document as unavailable', async () => {
    (gameService.getGameById as jest.Mock).mockRejectedValue(new Error('denied'));
    await expect(eveningSummaryService.getEveningSummary('g', 'u')).rejects.toThrow('denied');
    setup(undefined);
    (getDoc as jest.Mock).mockResolvedValue(snap());
    expect(await eveningSummaryService.getEveningSummary('g', 'u')).toBeNull();
  });
  it('labels a local score estimate when the committed standings are absent or fail to load', async () => {
    setup(stat, rounds, null);
    const estimated = await eveningSummaryService.getEveningSummary('g', 'u');
    expect(estimated?.scoreEstimated).toBe(true);
    setup();
    const committed = await eveningSummaryService.getEveningSummary('g', 'u');
    expect(committed?.scoreEstimated).toBe(false);
    expect(committed?.score).toBe(8.9);
  });
});
