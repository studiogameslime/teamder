jest.mock('../../pulse/src/config', () => ({ config: { firebase: { projectId: 'test' } } }));
jest.mock('../../pulse/src/services/auth', () => ({ googleAccessToken: jest.fn().mockResolvedValue('fixture') }));
jest.mock('../../pulse/src/services/adminTransport', () => ({ pulseFetch: jest.fn() }));
jest.mock('../../pulse/src/services/readMeter', () => ({ recordRead: jest.fn() }));
import { pulseFetch } from '../../pulse/src/services/adminTransport';
import { listAll, queryCollectionRecent } from '../../pulse/src/services/firestoreRest';
import { recordRead } from '../../pulse/src/services/readMeter';
const doc = (n: number) => ({ document: { name: `projects/test/databases/(default)/documents/users/${n}`, fields: { name: { stringValue: `user ${n}` } } } });
beforeEach(() => jest.clearAllMocks());
test('pagination uses stable document cursor and exact remaining budget, projects fields, counts each page', async () => {
  (pulseFetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => Array.from({length: 300}, (_, i) => doc(i)) })
    .mockResolvedValueOnce({ ok: true, json: async () => [doc(300)] });
  const result = await listAll('users', 301, ['name']);
  expect(result).toHaveLength(301); expect(result[300]).toEqual({ id: '300', name: 'user 300' });
  const calls = (pulseFetch as jest.Mock).mock.calls;
  expect(calls).toHaveLength(2); expect(calls[0][0]).toContain(':runQuery');
  const second = JSON.parse(calls[1][1].body).structuredQuery;
  expect(second.limit).toBe(1); expect(second.select.fields).toEqual([{ fieldPath: 'name' }]);
  expect(second.startAt).toEqual({ before: false, values: [{referenceValue: doc(299).document.name}] });
  expect(recordRead).toHaveBeenNthCalledWith(1, 'users', 300); expect(recordRead).toHaveBeenNthCalledWith(2, 'users', 1);
});
test('failed later page rejects instead of silently returning incomplete data; prior reads remain counted', async () => {
  (pulseFetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => Array.from({length:300}, (_,i)=>doc(i)) })
    .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'unavailable' });
  await expect(listAll('users', 400)).rejects.toThrow('503');
  expect(recordRead).toHaveBeenCalledWith('users', 300);
});
test('recent notification query orders before limiting and does not include message payload', async () => {
  (pulseFetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => [] });
  await queryCollectionRecent('notifications', 1000, ['stats']);
  const query = JSON.parse((pulseFetch as jest.Mock).mock.calls[0][1].body).structuredQuery;
  expect(query.orderBy).toEqual([{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }]);
  expect(query.limit).toBe(1000); expect(query.select.fields).toEqual([{fieldPath:'stats'}]);
});

test('targeted detail queries project fields before transferring large report and game documents', async () => {
  const {queryEquals,queryArrayContains}=await import('../../pulse/src/services/firestoreRest');
  (pulseFetch as jest.Mock).mockResolvedValue({ok:true,json:async()=>[]});
  await queryEquals('feedback','userId','person',500,['message','status']);
  await queryArrayContains('games','participantIds','person',200,['title']);
  const queries=(pulseFetch as jest.Mock).mock.calls.map(call=>JSON.parse(call[1].body).structuredQuery);
  expect(queries[0]).toMatchObject({select:{fields:[{fieldPath:'message'},{fieldPath:'status'}]},where:{fieldFilter:{value:{stringValue:'person'},op:'EQUAL'}},limit:500});
  expect(queries[1]).toMatchObject({select:{fields:[{fieldPath:'title'}]},where:{fieldFilter:{op:'ARRAY_CONTAINS'}},limit:200});
});
