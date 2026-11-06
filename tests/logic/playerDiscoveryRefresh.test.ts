import { player, playerSearchFixture } from '../helpers/playerSearchFixture';

test('a page started before an accepted request cannot restore the old relationship', async()=>{
  const f=playerSearchFixture();f.start();
  f.requests[0].resolve({players:[player('peer')],cursor:'next'});await Promise.resolve();
  f.render().more();
  f.render().update('peer',{friend:true,relationship:'friends'});
  f.requests[1].resolve({players:[player('peer')],cursor:null});await Promise.resolve();
  expect(f.render().players[0]).toMatchObject({id:'peer',friend:true,relationship:'friends'});
});

test('a same-query refresh retains confirmed rows through failure and retries from the first page', async () => {
  const f = playerSearchFixture();
  f.start();
  f.requests[0].resolve({ players: [player('visible')], cursor: 'second' });
  await Promise.resolve();
  f.start(false);
  f.start();
  expect(f.render()).toMatchObject({ players: [player('visible')], busy: true });
  f.requests[1].reject(Error('offline'));
  await Promise.resolve();
  expect(f.render()).toMatchObject({ players: [player('visible')], busy: false, failed: true });
  f.render().retry();
  f.start();
  expect(f.search.mock.calls[2][0].cursor).toBeUndefined();
  f.requests[2].resolve({ players: [], cursor: null });
  await Promise.resolve();
  expect(f.render()).toMatchObject({ players: [], failed: false, confirmed: true });
});

test('switching queries hides old rows and ignores the previous pending response', async () => {
  const f = playerSearchFixture();
  f.start();
  f.requests[0].resolve({ players: [player('old')], cursor: 'second' });
  await Promise.resolve();
  f.render().more();
  f.options.text = 'חיפוש חדש';
  f.start();
  expect(f.render().players).toEqual([]);
  f.requests[2].resolve({ players: [player('new')], cursor: null });
  f.requests[1].resolve({ players: [player('obsolete')], cursor: 'next' });
  await Promise.resolve();
  expect(f.render().players).toEqual([player('new')]);
});

test('switching to a guest invalidates in-flight account reads and cannot issue new ones', async () => {
  const f = playerSearchFixture();
  f.start();
  f.session.currentUser = { id: 'other', isGuest: true };
  f.start();
  f.requests[0].resolve({ players: [player('old-private')], cursor: null });
  await Promise.resolve();
  expect(f.render()).toMatchObject({ players: [], busy: false, confirmed: false });
  expect(f.search).toHaveBeenCalledTimes(1);
});
