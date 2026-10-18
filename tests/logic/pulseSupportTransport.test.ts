jest.mock('../../pulse/src/services/adminTransport', () => ({ pulseFetch: jest.fn() }));
jest.mock('../../pulse/src/services/auth', () => ({ googleAccessToken: async () => 'local-test-token' }));
jest.mock('../../pulse/src/services/readMeter', () => ({ recordRead: jest.fn() }));
import { pulseFetch } from '../../pulse/src/services/adminTransport';
import { queryCollectionRecent } from '../../pulse/src/services/firestoreRest';
import { pulseProxyTarget } from '../../functions/src/pulseProxyPolicy';
test('bounded child query passes the approved support proxy scope and deserializes the newest response', async () => {
  (pulseFetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => [{ document: { name: 'projects/demo/databases/(default)/documents/dmConversations/alice__teamder/messages/reply', fields: { createdAt: { integerValue: '200' }, text: { stringValue: 'עובד!' } } } }] });
  expect(await queryCollectionRecent('dmConversations/alice__teamder/messages', 1)).toEqual([{ id: 'reply', createdAt: 200, text: 'עובד!' }]);
  const [url, options] = (pulseFetch as jest.Mock).mock.calls[0];
  expect(pulseProxyTarget(url, options.method).scope).toBe('datastore');
  expect(JSON.parse(options.body).structuredQuery).toEqual({ from: [{ collectionId: 'messages' }], orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }], limit: 1 });
});
test('a denied read never becomes an empty conversation', async () => {
  (pulseFetch as jest.Mock).mockResolvedValue({ ok: false, status: 403 });
  await expect(queryCollectionRecent('dmConversations/alice__teamder/messages')).rejects.toThrow('403');
});

test('real REST deserializer retains nested support source and JPEG payload',async()=>{
  (pulseFetch as jest.Mock).mockResolvedValue({ok:true,json:async()=>[{document:{name:'projects/demo/databases/(default)/documents/dmConversations/alice__teamder/messages/shot',fields:{text:{stringValue:'צילום'},supportImage:{stringValue:'/9j/AAAA'},supportContext:{mapValue:{fields:{screen:{stringValue:'CommunitiesCreate'},step:{integerValue:'2'},groupId:{stringValue:'clubA'}}}}}}}]});
  expect(await queryCollectionRecent('dmConversations/alice__teamder/messages',100)).toEqual([{id:'shot',text:'צילום',supportImage:'/9j/AAAA',supportContext:{screen:'CommunitiesCreate',step:2,groupId:'clubA'}}]);
});
