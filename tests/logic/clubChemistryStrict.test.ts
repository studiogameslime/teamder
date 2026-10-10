jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => name,
  query: (collection: string) => collection,
  where: jest.fn(), getDocs: jest.fn(),
}));
jest.mock('@/firebase/config', () => ({ USE_MOCK_DATA: false, getFirebase: () => ({ db: {} }) }));
jest.mock('@/services/errorLog', () => ({ logError: jest.fn(), isExpectedDenial: () => false }));
jest.mock('@/data/mockClubChemistry', () => ({ mockClubChemistry: jest.fn() }));
import { getDocs } from 'firebase/firestore';
import { clubChemistryService } from '@/services/clubChemistryService';

test('all-time strict reads propagate errors rather than silently omitting live chemistry', async () => {
  (getDocs as jest.Mock).mockRejectedValue(new Error('offline'));
  await expect(clubChemistryService.get('club', true)).rejects.toThrow('offline');
  expect(await clubChemistryService.get('club')).toEqual({ picks: [], pairs: {}, since: null });
});
test('an actually empty successful query remains empty under strict reads', async () => {
  (getDocs as jest.Mock).mockResolvedValue({ docs: [], forEach: jest.fn() });
  expect(await clubChemistryService.get('club', true)).toEqual({ picks: [], pairs: {}, since: null });
});
