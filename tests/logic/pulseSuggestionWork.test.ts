const mockCollections = new Map<string, any[]>();
jest.mock('../../pulse/src/config', () => ({ MOCK_WORK: false }));
jest.mock('../../pulse/src/capabilities', () => ({ has: { firebase: () => true } }));
jest.mock('../../pulse/src/services/cache', () => ({ cached: (_key: string, read: () => unknown) => read(), invalidate: jest.fn() }));
jest.mock('../../pulse/src/services/firestoreRest', () => ({ listAll: async (collection: string) => mockCollections.get(collection) ?? [], getDoc: jest.fn(), patchDoc: jest.fn() }));
jest.mock('../../pulse/src/services/teamderChatService', () => ({ listAwaitingReply: async () => [], resolveSupportThread: jest.fn(), reopenSupportThread: jest.fn() }));
import { listWorkSnapshot, claudeQueue, workItemFromTask } from '../../pulse/src/services/workItems';
import { boardSections } from '../../pulse/src/services/workBoard';
beforeEach(() => mockCollections.clear());
test('suggestions are a separate category in one board, preserving existing execution policy', async () => {
  mockCollections.set('feedback', [{ id: 'proposal', type: 'suggestion', message: 'הצעה', status: 'new', createdAt: 1 }, { id: 'bug', type: 'bug', message: 'תקלה', status: 'new', createdAt: 2 }]);
  const { items } = await listWorkSnapshot(true);
  expect(items.find(i => i.id === 'proposal')).toMatchObject({ kind: 'suggestion', claudeMayAct: true, state: 'open' });
  expect(items.find(i => i.id === 'bug')).toMatchObject({ kind: 'report', claudeMayAct: true });
  expect(boardSections(items).map(g => g.key)).toEqual(['report', 'suggestion']);
  expect(claudeQueue(items).map(i => i.id)).toEqual(['bug', 'proposal']);
});
test('linked source remains visible for context, with only the task actionable', async () => {
  mockCollections.set('feedback', [{ id: 'proposal', type: 'suggestion', message: 'הצעה', status: 'new', createdAt: 1 }]);
  mockCollections.set('tasks', [{ id: 'task-a', source: 'teamder', sourceType: 'feedback', sourcePath: 'feedback/proposal', sourceId: 'proposal', category: 'feature', title: 'משימה', status: 'new', createdAt: 3 }]);
  const { items } = await listWorkSnapshot(true);
  expect(items.find(i => i.id === 'proposal')).toMatchObject({ linkedTaskId: 'task-a', state: 'open', claudeMayAct: false });
  expect(claudeQueue(items).map(i => i.id)).toEqual(['task-a']); expect(items).toHaveLength(2);
});
test('both lean and complete task readers retain support origin without mistaking message id for feedback id', async () => {
  const raw = { id: 'task-a', source: 'pulse', sourceType: 'support_message', sourceId: 'message-a', sourcePath: 'dmConversations/alice__teamder/messages/message-a', sourceConversationId: 'alice__teamder', sourceMessageId: 'message-a', reporterId: 'alice', category: 'bug', title: 'משימה', status: 'new', createdAt: 3 };
  mockCollections.set('tasks', [raw]); const { items } = await listWorkSnapshot(true);
  expect(items[0].sourceReportId).toBeUndefined(); expect(items[0].sourceChat).toEqual({ userId: 'alice', conversationId: 'alice__teamder', messageId: 'message-a' });
  expect(workItemFromTask({ ...raw, images: [], notes: '', priority: 'normal', screen: '', reporterName: '', updatedAt: 3, doneAt: 0, claude: null } as any).sourceChat).toEqual(items[0].sourceChat);
});
