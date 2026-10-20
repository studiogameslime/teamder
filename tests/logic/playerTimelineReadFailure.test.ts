jest.mock('@/firebase/config', () => ({
  USE_MOCK_DATA: false,
  getFirebase: () => ({
    db: {}
  })
}));
jest.mock('@/services/errorLog', () => ({
  logError: jest.fn()
}));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  doc: jest.fn(),
  getDocs: jest.fn(),
  limit: jest.fn(),
  orderBy: jest.fn(),
  query: jest.fn(),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
  where: jest.fn()
}));
import { getDocs } from 'firebase/firestore';
import { communityEventsService, InvalidTimelineScopeError } from '@/services/communityEventsService';
beforeEach(() => jest.clearAllMocks());
test('a failed timeline read rejects rather than claiming that the player has no events', async () => {
  const failure = new Error('unavailable');
  (getDocs as jest.Mock).mockRejectedValue(failure);
  await expect(communityEventsService.getPlayerTimeline('club', 'player')).rejects.toBe(failure);
});
test('a successful empty query is a real empty timeline', async () => {
  (getDocs as jest.Mock).mockResolvedValue({
    docs: []
  });
  await expect(communityEventsService.getPlayerTimeline('club', 'player')).resolves.toEqual([]);
});
test('an incomplete route is a typed failure and does not query another scope', async () => {
  await expect(communityEventsService.getPlayerTimeline('', 'player')).rejects.toBeInstanceOf(InvalidTimelineScopeError);
  expect(getDocs).not.toHaveBeenCalled();
});
