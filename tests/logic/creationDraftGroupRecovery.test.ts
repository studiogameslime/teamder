import { readCreationDraftGroup, creationDraftRecoveryMessage } from '@/services/creationDraftGroup';
import type { Group } from '@/types';

const group: Group = { id: 'saved-club', name: 'מועדון', normalizedName: 'מועדון', adminIds: ['owner'], playerIds: ['owner'],
  pendingPlayerIds: [], inviteCode: 'fixture', createdAt: 1 };
test('an empty initial cache cannot erase the saved target; a delayed fresh club read resolves it', async () => {
  let resolve!: (value: Group) => void;
  const freshRead = jest.fn(() => new Promise<Group>(done => { resolve = done; }));
  const pending = readCreationDraftGroup({ __creationGroupId: 'saved-club' }, 'owner', false, freshRead);
  expect(freshRead).toHaveBeenCalledWith('saved-club');
  resolve(group);
  expect(await pending).toBe(group);
});
test('a failed club read is not replaced with a different cached club or an empty answer', async () => {
  const read = jest.fn(async () => { throw Error('network unavailable'); });
  await expect(readCreationDraftGroup({ __creationGroupId: 'saved-club' }, 'owner', false, read))
    .rejects.toThrow('network unavailable');
});
test('quick route restores the saved standalone context before personal-group provisioning completes', async () => {
  const noPersonalGroupYet = jest.fn(async () => null);
  expect(await readCreationDraftGroup({ __creationGroupId: null }, 'owner', true, noPersonalGroupYet)).toBeUndefined();
  expect(noPersonalGroupYet).not.toHaveBeenCalled();
});
test('a saved club no longer administered by the account fails closed instead of creating in another club', async () => {
  await expect(readCreationDraftGroup({ __creationGroupId: 'saved-club' }, 'owner', false,
    async () => ({ ...group, adminIds: ['another'] }))).rejects.toThrow('לא ניתן לאמת');
});

test('confirmed absence is distinct from a failed transport read and never becomes a fresh draft', async () => {
  await expect(readCreationDraftGroup({ __creationGroupId: 'saved-club' }, 'owner', false, async () => null))
    .rejects.toMatchObject({ code: 'CREATION_GROUP_MISSING' });
});

test.each([
  Object.assign(Error('Failed to get document because the client is offline'), { code: 'unavailable' }),
  Object.assign(Error('Missing or insufficient permissions'), { code: 'permission-denied' }),
  Object.assign(Error('private transport detail'), { code: 'unknown' }),
  Error('raw provider message'), null, 'raw provider string', { message: 'not safe to render' },
])('untrusted transport error %s is rendered as the fixed Hebrew recovery message', error => {
  expect(creationDraftRecoveryMessage(error)).toBe('לא ניתן לשחזר את הטיוטה. נסו שוב.');
});
test.each([
  ['CREATION_GROUP_MISSING', 'המועדון של הטיוטה אינו זמין עוד. אין להמשיך את היצירה במועדון אחר.'],
  ['CREATION_GROUP_ACCESS', 'לא ניתן לאמת גישה למועדון של הטיוטה. נסו שוב לפני המשך היצירה.'],
])('known recovery code %s retains its Hebrew explanation without echoing raw error text', (code, message) => {
  expect(creationDraftRecoveryMessage(Object.assign(Error('provider text should not leak'), { code }))).toBe(message);
});
