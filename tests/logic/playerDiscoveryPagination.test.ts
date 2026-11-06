import { player, playerSearchFixture } from '../helpers/playerSearchFixture';

test('a name search advances through empty examined pages until it finds a player', async () => {
  const f = playerSearchFixture();
  f.start();
  f.requests[0].resolve({ players: [], cursor: 'first' });
  await Promise.resolve();
  f.requests[1].resolve({ players: [], cursor: 'second' });
  await Promise.resolve();
  f.requests[2].resolve({ players: [player('found')], cursor: 'third' });
  await Promise.resolve();
  expect(f.search.mock.calls.map(([request]) => request.cursor)).toEqual([undefined, 'first', 'second']);
  expect(f.render()).toMatchObject({ players: [player('found')], cursor: 'third', busy: false });
});

test('exhausting the last empty page prevents further automatic or manual requests', async () => {
  const f = playerSearchFixture();
  f.start();
  f.requests[0].resolve({ players: [], cursor: null });
  await Promise.resolve();
  f.render().more();
  expect(f.search).toHaveBeenCalledTimes(1);
  expect(f.render()).toMatchObject({ confirmed: true, players: [], cursor: null, busy: false });
});

test('manual pagination waits for an active read and retries a failed empty scan at its cursor', async () => {
  const f = playerSearchFixture();
  f.start();
  f.requests[0].resolve({ players: [], cursor: 'second' });
  await Promise.resolve();
  f.render().more();
  expect(f.search).toHaveBeenCalledTimes(2);
  f.requests[1].reject(Error('offline'));
  await Promise.resolve();
  expect(f.render().failed).toBe(true);
  expect(f.search).toHaveBeenCalledTimes(2);
  f.render().retry();
  f.render().more();
  expect(f.search.mock.calls.map(([request]) => request.cursor)).toEqual([undefined, 'second', 'second']);
  f.requests[2].resolve({ players: [player('found')], cursor: null });
  await Promise.resolve();
  expect(f.render()).toMatchObject({ players: [player('found')], failed: false, cursor: null });
});

test.each(['inactive', 'unfocused', 'guest', 'preview'])('%s discovery does not fetch or paginate', mode => {
  const f = playerSearchFixture();
  f.session.focused = mode !== 'unfocused';
  f.session.currentUser.isGuest = mode === 'guest';
  const active = mode !== 'inactive', preview = mode === 'preview' ? [player('demo')] : undefined;
  f.start(active, preview);
  f.render(active, preview).more();
  expect(f.search).not.toHaveBeenCalled();
  if (preview) expect(f.render(active, preview).players).toEqual(preview);
});
