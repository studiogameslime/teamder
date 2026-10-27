import { activityMovement } from '../../src/utils/activityMovement';
const samples = (values: number[], times = values.map((_, i) => i * 1000)) => values.map((mps, i) => ({ at: times[i], mps, series: 'one' }));
test('no samples and single samples do not become rest or invented sprint counts', () => {
  expect(activityMovement([]).stationaryMs).toBeNull();
  expect(activityMovement(samples([6]))).toMatchObject({ maxSpeedKmh: 21.6, sampledMs: null, sprints: null });
});
test('time partition includes sprints in running and uses only covered time', () => {
  const result = activityMovement(samples([0, 1, 3, 6, 6, 0]));
  expect(result).toMatchObject({ stationaryMs: 1000, walkingMs: 1000, runningMs: 3000, sprintMs: 2000, sprints: 1, sampledMs: 5000 });
  expect(result.stationaryMs! + result.walkingMs! + result.runningMs!).toBe(result.sampledMs);
});
test('gaps, invalid readings and series boundaries never become long runs or rest', () => {
  expect(activityMovement(samples([0, 0], [0, 60000])).sampledMs).toBeNull();
  expect(activityMovement(samples([6, 80, 6])).sampledMs).toBeNull();
  expect(activityMovement([{ at: 0, mps: 0, series: 'one' }, { at: 1000, mps: 0, series: 'two' }]).sampledMs).toBeNull();
});
test('duplicate samples are idempotent; conflicting and overlapping recordings do not double count', () => {
  const rows = samples([0, 3, 0]);
  expect(activityMovement([...rows, ...rows])).toEqual(activityMovement(rows));
  expect(activityMovement([...rows, { ...rows[0], mps: 5 }]).sampledMs).toBeNull();
  expect(activityMovement([...rows, ...samples([0, 3, 0], [500, 1500, 2500]).map(s => ({ ...s, series: 'two' }))]).sampledMs).toBeNull();
});
test('short peaks and gaps do not create a sustained sprint', () => {
  expect(activityMovement(samples([6, 0, 6, 0])).sprints).toBe(0);
  expect(activityMovement(samples([6, 6, 6], [0, 1000, 60000])).sprints).toBe(0);
});
