jest.mock('../../pulse/src/capabilities',()=>({has:{firebase:()=>true}}));
jest.mock('../../pulse/src/services/firestoreRest',()=>({getDoc:jest.fn(),patchDoc:jest.fn(),queryArrayContains:jest.fn(),queryCollectionRecent:jest.fn(),queryEquals:jest.fn(),createDocOnly:jest.fn()}));
jest.mock('../../pulse/src/services/cache',()=>({cached:(_k:string,f:()=>unknown)=>f(),invalidate:jest.fn()}));
import * as rest from '../../pulse/src/services/firestoreRest';
import {resolveSupportThread,reopenSupportThread,loadThread,listThreads,listAwaitingReply,convIdFor} from '../../pulse/src/services/teamderChatService';
import {filterSupportThreads} from '../../pulse/src/services/supportInbox';
let conversation:any;
beforeEach(()=>{
 jest.clearAllMocks(); conversation={id:convIdFor('alice'),participants:['alice','teamder'],supportLastMessageId:'reply-1',supportLastSenderId:'alice',supportLastMessageAt:200,supportLastText:'תודה'};
 (rest.getDoc as jest.Mock).mockImplementation(async path=>path.startsWith('users/')?{name:'אליס'}:conversation);
 (rest.queryArrayContains as jest.Mock).mockImplementation(async()=>[conversation]);
 (rest.queryCollectionRecent as jest.Mock).mockResolvedValue([{id:'reply-1',senderId:'alice',text:'תודה',createdAt:200}]);
 (rest.patchDoc as jest.Mock).mockImplementation(async(_path,fields)=>{Object.assign(conversation,fields);return true;});
});
test('resolution writes only metadata, removes waiting work and preserves user text',async()=>{
 expect(await listAwaitingReply(true)).toHaveLength(1);
 expect(await resolveSupportThread('alice','reply-1',200)).toBe(true);
 expect(rest.patchDoc).toHaveBeenCalledWith('dmConversations/alice__teamder',expect.objectContaining({supportResolvedMessageId:'reply-1',supportResolvedMessageAt:200}),{mustExist:true});
 expect(Object.keys((rest.patchDoc as jest.Mock).mock.calls[0][1]).sort()).toEqual(['supportResolvedAt','supportResolvedMessageAt','supportResolvedMessageId']);
 expect(rest.createDocOnly).not.toHaveBeenCalled();
 expect(await listAwaitingReply(true)).toEqual([]);
 expect(await loadThread('alice','אליס',true)).toMatchObject({resolved:true,awaitingReply:false,messages:[{id:'reply-1',senderId:'alice',text:'תודה',createdAt:200,fromTeamder:false}]});
 const threads=await listThreads(true);expect(filterSupportThreads(threads,'','resolved')).toHaveLength(1);expect(filterSupportThreads(threads,'','sent')).toHaveLength(0);
});
test('a new user reply during resolution reopens even at the same clock time',async()=>{
 conversation.supportLastMessageId='reply-2';
 await resolveSupportThread('alice','reply-1',200);
 expect(await listAwaitingReply(true)).toHaveLength(1);
});
test('reopen restores waiting and fallback message queries obey the same boundary',async()=>{
 delete conversation.supportLastMessageId;
 await resolveSupportThread('alice','reply-1',200);expect(await listAwaitingReply(true)).toHaveLength(0);
 await reopenSupportThread('alice');expect(await listAwaitingReply(true)).toHaveLength(1);
});
test('a failed save stays waiting; invalid targets never write',async()=>{
 (rest.patchDoc as jest.Mock).mockResolvedValue(false);
 expect(await resolveSupportThread('alice','reply-1',200)).toBe(false);
 expect(await listAwaitingReply(true)).toHaveLength(1);
 (rest.patchDoc as jest.Mock).mockClear();
 for(const id of ['teamder','../alice','alice__bob',''])expect(await resolveSupportThread(id,'reply-1',200)).toBe(false);
 expect(await resolveSupportThread('alice','',200)).toBe(false);expect(await resolveSupportThread('alice','reply-1',NaN)).toBe(false);
 expect(rest.patchDoc).not.toHaveBeenCalled();
});
