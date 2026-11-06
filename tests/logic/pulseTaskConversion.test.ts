const mockDocs = new Map<string, any>();
const mockGet = jest.fn(async (path: string, _fields?: readonly string[]) => mockDocs.get(path) ?? null);
const mockQuery = jest.fn(async (_collection: string, field: string, value: string, limit: number) => [...mockDocs.entries()].filter(([p, d]) => p.startsWith('tasks/') && d[field] === value).map(([, d]) => d).slice(0, limit));
const mockCreate = jest.fn(async (path: string, fields: any) => {
  if (mockDocs.has(path)) return 'conflict';
  mockDocs.set(path, { id: path.split('/').pop(), ...fields }); return 'created';
});
jest.mock('../../pulse/src/services/firestoreRest', () => ({ getDoc: (...args: any[]) => mockGet(...args as [string]), queryEquals: (...args: any[]) => mockQuery(...args as [string, string, string, number]), createDocOnly: (...args: any[]) => mockCreate(...args as [string, any]) }));
jest.mock('../../pulse/src/services/cache', () => ({ invalidate: jest.fn() }));
jest.mock('../../pulse/src/services/teamderChatService', () => ({ TEAMDER_UID: 'teamder', convIdFor: (uid: string) => [uid, 'teamder'].sort().join('__') }));
import { ensureTaskFromOrigin, taskIdForOrigin, taskOriginPath, type TaskOrigin } from '../../pulse/src/services/taskConversion';
import { convIdFor } from '../../pulse/src/services/teamderChatService';
const proposal: TaskOrigin = { kind: 'feedback', id: 'proposal-a' };
const message: TaskOrigin = { kind: 'support_message', userId: 'alice', messageId: 'message-a' };
const task = (origin: TaskOrigin) => mockDocs.get(`tasks/${taskIdForOrigin(origin)}`);
function seed(origin: TaskOrigin, value: any) { mockDocs.set(taskOriginPath(origin), { id: origin.kind === 'feedback' ? origin.id : origin.messageId, ...value }); }
beforeEach(() => { mockDocs.clear(); mockGet.mockClear(); mockQuery.mockClear(); mockCreate.mockClear(); });

test('proposal conversion preserves the source, author, image and original text, and confirms the saved task', async () => {
  const source = { type: 'suggestion', message: 'אפשר לשפר את חיפוש המועדונים\nפרטים נוספים', userId: 'alice', userName: 'שחקן', screen: 'CommunitiesFeed', appVersion: '1.2.3', image: 'original-shot', createdAt: 10, status: 'new', claudeNote: 'not task completion' };
  seed(proposal, source); const before = { ...mockDocs.get(taskOriginPath(proposal)) };
  const result = await ensureTaskFromOrigin(proposal);
  expect(result).toEqual({ taskId: taskIdForOrigin(proposal), created: true });
  expect(task(proposal)).toMatchObject({ category: 'feature', status: 'new', source: 'teamder', sourceType: 'feedback', sourcePath: 'feedback/proposal-a', reporterId: 'alice', reporterName: 'שחקן', images: ['original-shot'], sourceText: source.message, sourceCreatedAt: 10, sourceContext: { screen: 'CommunitiesFeed', appVersion: '1.2.3' } });
  expect(task(proposal)).not.toHaveProperty('claudeNote'); expect(mockDocs.get(taskOriginPath(proposal))).toEqual(before);
  expect(mockGet.mock.calls.at(-1)?.[0]).toBe(`tasks/${result.taskId}`);
});
test('a support task is based on an incoming message with its exact conversation/message identity', async () => {
  seed(message, { text: 'ההרשמה נשארת בהמתנה', senderId: 'alice', senderName: 'שחקן', supportImage: 'message-shot', createdAt: 15, supportContext: { screen: 'MatchDetails', gameId: 'game-a', password: 'must not copy', step: 2 } });
  const before = JSON.stringify([...mockDocs]); await ensureTaskFromOrigin(message);
  expect(task(message)).toMatchObject({ source: 'pulse', sourceType: 'support_message', sourceId: 'message-a', sourceConversationId: convIdFor('alice'), sourceMessageId: 'message-a', reporterId: 'alice', notes: 'ההרשמה נשארת בהמתנה', images: ['message-shot'], screen: 'MatchDetails', sourceContext: { screen: 'MatchDetails', gameId: 'game-a', step: 2 } });
  expect(task(message).sourceContext).not.toHaveProperty('password');
  expect(JSON.stringify([...mockDocs].filter(([p]) => !p.startsWith('tasks/')))).toBe(before);
  expect(mockCreate.mock.calls.every(([path]) => path.startsWith('tasks/'))).toBe(true);
});
test.each(['teamder', 'someone-else'])('outgoing or mismatched sender %s cannot be promoted as this user message', async senderId => {
  seed(message, { senderId, text: 'text' }); await expect(ensureTaskFromOrigin(message)).rejects.toThrow('TASK_SOURCE_NOT_INCOMING'); expect(mockCreate).not.toHaveBeenCalled();
});
test('repeated conversion opens the same task and preserves owner edits and completion', async () => {
  seed(proposal, { type: 'suggestion', message: 'proposal' }); await ensureTaskFromOrigin(proposal);
  const saved = task(proposal); saved.title = 'כותרת שערך הבעלים'; saved.status = 'done'; saved.priority = 'high';
  await ensureTaskFromOrigin(proposal); expect(mockCreate).toHaveBeenCalledTimes(1); expect(task(proposal)).toMatchObject({ title: saved.title, status: 'done', priority: 'high' });
});
test('two concurrent presses share one request and one created document', async () => {
  seed(proposal, { message: 'proposal' }); const a = ensureTaskFromOrigin(proposal), b = ensureTaskFromOrigin(proposal);
  expect(a).toBe(b); await Promise.all([a, b]); expect(mockCreate).toHaveBeenCalledTimes(1);
});
test('uncertain network response after commit is recovered by finding the existing source task', async () => {
  seed(proposal, { message: 'proposal' });
  mockCreate.mockImplementationOnce(async (path, fields) => { mockDocs.set(path, { id: path.split('/').pop(), ...fields }); throw new Error('connection lost after commit'); });
  await expect(ensureTaskFromOrigin(proposal)).rejects.toThrow('connection lost');
  expect(await ensureTaskFromOrigin(proposal)).toEqual({ taskId: taskIdForOrigin(proposal), created: false }); expect(mockCreate).toHaveBeenCalledTimes(1);
});
test('a create race from another device is accepted only after the origin is read back', async () => {
  seed(proposal, { message: 'proposal' });
  mockCreate.mockImplementationOnce(async (path, fields) => { mockDocs.set(path, { id: path.split('/').pop(), ...fields }); return 'conflict'; });
  expect(await ensureTaskFromOrigin(proposal)).toMatchObject({ created: false }); expect(task(proposal).sourceId).toBe('proposal-a');
});
test('legacy imported feedback task is reused instead of copied again', async () => {
  mockDocs.set('tasks/legacy', { id: 'legacy', source: 'teamder', sourceId: 'proposal-a', createdAt: 1 });
  expect(await ensureTaskFromOrigin(proposal)).toEqual({ taskId: 'legacy', created: false }); expect(mockCreate).not.toHaveBeenCalled();
});
test('a conflicting deterministic id does not overwrite an unrelated task', async () => {
  mockDocs.set(`tasks/${taskIdForOrigin(proposal)}`, { id: taskIdForOrigin(proposal), sourcePath: 'feedback/other', sourceType: 'feedback' });
  await expect(ensureTaskFromOrigin(proposal)).rejects.toThrow('TASK_SOURCE_CONFLICT'); expect(mockCreate).not.toHaveBeenCalled();
});
test('missing or failed source reads never create a task from a stale UI copy', async () => {
  await expect(ensureTaskFromOrigin(proposal)).rejects.toThrow('TASK_SOURCE_UNAVAILABLE');
  mockGet.mockRejectedValueOnce(new Error('offline')); await expect(ensureTaskFromOrigin(proposal)).rejects.toThrow('offline'); expect(mockCreate).not.toHaveBeenCalled();
});
test('same text in distinct messages/users has distinct task ids, while source identity is stable', () => {
  const other: TaskOrigin = { ...message, userId: 'bob' } as TaskOrigin;
  expect(new Set([taskIdForOrigin(proposal), taskIdForOrigin(message), taskIdForOrigin(other), taskIdForOrigin({ ...message, messageId: 'message-b' } as TaskOrigin)]).size).toBe(4);
  expect(taskIdForOrigin({ ...message })).toBe(taskIdForOrigin(message));
});
test('photo-only message keeps its attachment and uses a nonempty task title', async () => {
  seed(message, { senderId: 'alice', supportImage: 'photo-only', createdAt: 20 }); await ensureTaskFromOrigin(message);
  expect(task(message)).toMatchObject({ title: 'משימה מהודעת תמיכה', images: ['photo-only'], sourceText: '', sourceCreatedAt: 20 });
});
test('a failed confirmation does not claim a created task; retry can verify the same document', async () => {
  seed(proposal, { message: 'proposal' });
  mockCreate.mockImplementationOnce(async (path, fields) => { mockDocs.set(path, { id: path.split('/').pop(), ...fields }); mockGet.mockResolvedValueOnce(null); return 'created'; });
  await expect(ensureTaskFromOrigin(proposal)).rejects.toThrow('TASK_CREATE_NOT_CONFIRMED');
  expect(await ensureTaskFromOrigin(proposal)).toMatchObject({ created: false }); expect(mockCreate).toHaveBeenCalledTimes(1);
});
test('untrusted source path segments are rejected before any write', () => {
  expect(() => taskOriginPath({ kind: 'feedback', id: '../tasks/other' })).toThrow('TASK_SOURCE_INVALID');
  expect(() => taskOriginPath({ kind: 'support_message', userId: 'teamder', messageId: 'a' })).toThrow('TASK_SOURCE_INVALID');
});
