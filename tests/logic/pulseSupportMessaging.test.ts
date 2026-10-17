jest.mock('../../pulse/src/capabilities', () => ({ has: { firebase: () => true } }));
jest.mock('../../pulse/src/services/firestoreRest', () => ({ getDoc: jest.fn(), listAll: jest.fn(), patchDoc: jest.fn(), queryArrayContains: jest.fn(), queryEquals: jest.fn(), queryCollectionRecent: jest.fn(), createDocOnly: jest.fn() }));
jest.mock('../../pulse/src/services/cache', () => ({ cached: (_key: string, fn: () => unknown) => fn(), invalidate: jest.fn() }));
jest.mock('../../functions/src/adminPush', () => ({ pushToAdmins: jest.fn().mockResolvedValue(undefined) }));
import * as rest from '../../pulse/src/services/firestoreRest';
import { convIdFor, sendTeamderMessage, loadThread, listThreads, newTeamderMessageId } from '../../pulse/src/services/teamderChatService';
import { filterSupportThreads, supportNotificationTarget } from '../../pulse/src/services/supportInbox';
import { notifySupportReply, supportReplyUser } from '../../functions/src/supportReply';
import { pushToAdmins } from '../../functions/src/adminPush';
const patch = rest.patchDoc as jest.Mock, create = rest.createDocOnly as jest.Mock, recent = rest.queryCollectionRecent as jest.Mock;
beforeEach(() => { jest.clearAllMocks(); (rest.getDoc as jest.Mock).mockReset().mockResolvedValue(null); patch.mockResolvedValue(true); create.mockResolvedValue('created'); });

test('incoming support photo and source survive the real thread reader', async()=>{
  recent.mockResolvedValue([{id:'photo',senderId:'alice',text:'צילום',createdAt:100,supportImage:'/9j/AAAA',supportContext:{screen:'CommunitiesCreate',screenLabel:'הקמת מועדון',step:2}}]);
  const thread=await loadThread('alice','אליס',true);
  expect(thread.messages[0]).toMatchObject({supportImage:'/9j/AAAA',supportContext:{screen:'CommunitiesCreate',step:2}});
});

test('cold thread lookups run in at most four parallel workers', async () => {
  const users = ['u1','u2','u3','u4','u5','u6'];
  (rest.queryArrayContains as jest.Mock).mockResolvedValue(users.map(userId => ({id:convIdFor(userId),participants:[userId,'teamder'],supportLastMessageId:'latest',supportLastSenderId:userId,supportLastMessageAt:200,supportLastText:'שלום'})));
  let active=0, peak=0;
  const release:Array<()=>void>=[];
  (rest.getDoc as jest.Mock).mockImplementation(async()=>{
    active++; peak=Math.max(peak,active);
    await new Promise<void>(resolve=>release.push(resolve)); active--; return {name:'שחקן'};
  });
  const pending=listThreads(true);
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(active).toBe(4);
  release.splice(0).forEach(resolve=>resolve());
  await new Promise(resolve=>setTimeout(resolve,0));
  release.splice(0).forEach(resolve=>resolve());
  expect(await pending).toHaveLength(6); expect(peak).toBe(4);
});
test('outgoing brand message and incoming reply remain in the same canonical thread', async () => {
  expect(await sendTeamderMessage('alice', 'שלום', 100, 'tm-100-attempt')).toBe(true);
  expect(patch).toHaveBeenCalledWith('dmConversations/alice__teamder', { participants: ['alice', 'teamder'], updatedAt: 100 });
  expect(create).toHaveBeenCalledWith('dmConversations/alice__teamder/messages/tm-100-attempt', expect.objectContaining({ senderId: 'teamder', text: 'שלום' }));
  recent.mockResolvedValue([{ id: 'reply', senderId: 'alice', text: 'אשמח לעזרה', createdAt: 200 }, { id: 'sent', senderId: 'teamder', text: 'שלום', createdAt: 100 }]);
  const thread = await loadThread('alice', 'אליס', true);
  expect(thread.awaitingReply).toBe(true); expect(thread.messages.map(m => m.fromTeamder)).toEqual([true, false]);
  await notifySupportReply(convIdFor('alice'), 'reply', { senderId: 'alice', senderName: 'אליס', text: 'אשמח לעזרה' });
  const push = (pushToAdmins as jest.Mock).mock.calls[0];
  expect(supportNotificationTarget({ ...push[3], type: push[0] })).toEqual({ userId: 'alice', messageId: 'reply' });
});
test('retries use create-only identity and confirm the same stored message', async () => {
  create.mockResolvedValue('conflict'); (rest.getDoc as jest.Mock).mockResolvedValue({ senderId: 'teamder', text: 'שלום' });
  expect(await sendTeamderMessage('alice', 'שלום', 100, 'tm-100-attempt')).toBe(true);
  (rest.getDoc as jest.Mock).mockResolvedValue({ senderId: 'teamder', text: 'טקסט אחר' });
  expect(await sendTeamderMessage('alice', 'שלום', 100, 'tm-100-attempt')).toBe(false);
});
test('conversation failure never writes an orphan message and text is not silently truncated', async () => {
  patch.mockResolvedValue(false);
  expect(await sendTeamderMessage('alice', 'שלום', 1)).toBe(false); expect(create).not.toHaveBeenCalled();
  patch.mockClear(); expect(await sendTeamderMessage('alice', 'x'.repeat(1001), 1)).toBe(false); expect(patch).not.toHaveBeenCalled();
  expect(await sendTeamderMessage('teamder', 'שלום', 1)).toBe(false);
  expect(await sendTeamderMessage('../alice', 'שלום', 1)).toBe(false);
});
test('same-clock sends get distinct ids and network errors remain errors', async () => {
  expect(newTeamderMessageId(1)).not.toBe(newTeamderMessageId(1));
  recent.mockRejectedValue(new Error('offline'));
  await expect(loadThread('alice', 'אליס', true)).rejects.toThrow('offline');
  (rest.queryArrayContains as jest.Mock).mockRejectedValue(new Error('offline'));
  await expect(listThreads(true)).rejects.toThrow('offline');
});
test('inbox skips malformed pairs, keeps answered threads, and reads only the latest preview', async () => {
  (rest.queryArrayContains as jest.Mock).mockResolvedValue([{ id: 'alice__teamder', participants: ['alice', 'teamder'] }, { id: 'bob__teamder', participants: ['bob', 'teamder'] }, { id: 'wrong', participants: ['carol', 'teamder'] }]);
  recent.mockImplementation(async (path: string) => [{ id: 'last', createdAt: 200, text: 'שלום', senderId: path.includes('alice') ? 'alice' : 'teamder' }]);
  (rest.getDoc as jest.Mock).mockResolvedValue({ name: 'שחקן' });
  const rows = await listThreads(true); expect(rows).toHaveLength(2);
  expect(rows.map(row => row.awaitingReply)).toEqual([true, false]);
  expect(recent).toHaveBeenCalledWith('dmConversations/alice__teamder/messages', 1);
  expect(filterSupportThreads(rows, '', 'waiting')).toHaveLength(1);
  expect(filterSupportThreads(rows, 'שלום', 'sent')).toHaveLength(1);
  expect(filterSupportThreads(rows, 'אין כזה', 'all')).toHaveLength(0);
});
test.each(['alice__teamder-fan', 'teamder__alice', 'alice__teamder__bob', 'alice__bob'])('rejects false official thread %s', async convId => {
  expect(supportReplyUser(convId, 'alice')).toBeNull();
  await notifySupportReply(convId, 'reply', { senderId: 'alice' }); expect(pushToAdmins).not.toHaveBeenCalled();
  expect(supportNotificationTarget({ type: 'teamderReply', parentId: convId })).toBeNull();
});
test('official outgoing messages never alert operators; incoming bodies are bounded', async () => {
  await notifySupportReply('alice__teamder', 'sent', { senderId: 'teamder' }); expect(pushToAdmins).not.toHaveBeenCalled();
  await notifySupportReply('alice__teamder', 'reply', { senderId: 'alice', senderName: '\u202eAlice\nName', text: 'x'.repeat(1000) });
  expect((pushToAdmins as jest.Mock).mock.calls[0][2]).toHaveLength(120);
  expect((pushToAdmins as jest.Mock).mock.calls[0][1]).not.toContain('\u202e');
});
