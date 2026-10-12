import {readApprovedInvites} from '@/firebase/firestore';

test('server approval grants survive the real Firestore reader',()=>{
  const server={player:{inviterId:'manager',expiresAt:1799999999999}};
  expect(readApprovedInvites(server)).toEqual(server);
  expect(readApprovedInvites({...server,bad:{inviterId:'manager'},null:null})).toEqual(server);
  expect(readApprovedInvites(null)).toBeUndefined();
  expect(readApprovedInvites([])).toBeUndefined();
});
