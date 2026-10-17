let mockLatch = '', mockPrior: Record<string, number> = {};
const mockSend = jest.fn().mockResolvedValue({ responses: [{ success: true }] });
const mockDb: any = {
  collection: (collection: string) => ({ doc: (id: string) => {
    if (collection === 'adminPushLatches') mockLatch = id;
    return { id, get: async () => ({ data: () => collection === 'adminConfig' && id === 'push' ? { tokens: ['test-device'] } : {} }) };
  } }),
  runTransaction: async (fn: any) => fn({ get: async (ref: any) => ({ data: () => ({ lastSentAt: mockPrior[ref.id] ?? 0 }) }), set: (ref: any, fields: any) => { mockPrior[ref.id] = fields.lastSentAt; } }),
};
jest.mock('../../functions/node_modules/firebase-admin', () => ({ firestore: () => mockDb, messaging: () => ({ sendEachForMulticast: mockSend }) }));
import { pushToAdmins } from '../../functions/src/adminPush';
beforeEach(() => { mockPrior = {}; mockSend.mockClear(); });
test('a support burst does not silence a different user; duplicate same-thread events are throttled', async () => {
  await pushToAdmins('teamderReply', 'כותרת', 'תוכן', { parentId: 'alice__teamder' });
  expect(mockLatch).toBe('teamderReply__alice__teamder');
  await pushToAdmins('teamderReply', 'כותרת', 'תוכן', { parentId: 'alice__teamder' });
  await pushToAdmins('teamderReply', 'כותרת', 'תוכן', { parentId: 'bob__teamder' });
  expect(mockSend).toHaveBeenCalledTimes(2);
  expect(mockSend.mock.calls[0][0].data.type).toBe('teamderReply');
});
