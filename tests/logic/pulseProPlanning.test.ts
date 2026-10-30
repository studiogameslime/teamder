jest.mock('../../pulse/node_modules/@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(), setItem: jest.fn() } }));
import AsyncStorage from '../../pulse/node_modules/@react-native-async-storage/async-storage';
import { filterPlanningFeatures, loadProPlan, parseProPlan, PRO_PLAN_KEY, saveProPlan } from '../../pulse/src/services/proPlanning';
import { PLANNING_FEATURES } from '../../pulse/src/data/proPlanningFeatures';

test('catalogue has unique stable IDs and real product documentation, without Pulse administration', () => {
  const fs = require('fs');
  expect(new Set(PLANNING_FEATURES.map(item => item.id)).size).toBe(PLANNING_FEATURES.length);
  expect(PLANNING_FEATURES.length).toBeGreaterThan(75);
  for (const item of PLANNING_FEATURES) {
    expect(fs.existsSync(item.source)).toBe(true);
    expect(item.id).not.toContain('pulse');
    expect(item.description.length).toBeGreaterThan(12);
  }
});
test('new plans start without any Pro features; filter counters partition the entire catalogue', () => {
  const plan = { [PLANNING_FEATURES[0].id]: true, [PLANNING_FEATURES[1].id]: false, removed: true };
  expect(parseProPlan(null)).toEqual({});
  expect(filterPlanningFeatures(PLANNING_FEATURES, {}, 'pro', 'all', '')).toHaveLength(0);
  expect(filterPlanningFeatures(PLANNING_FEATURES, plan, 'pro', 'all', '')).toHaveLength(1);
  expect(filterPlanningFeatures(PLANNING_FEATURES, plan, 'free', 'all', '')).toHaveLength(PLANNING_FEATURES.length - 1);
  expect(filterPlanningFeatures(PLANNING_FEATURES, plan, 'all', 'all', '')).toHaveLength(PLANNING_FEATURES.length);
});
test('search and category intersect the Pro filter', () => {
  const feature = PLANNING_FEATURES.find(item => item.id === 'rounds/penalties')!;
  const plan = { [feature.id]: true };
  expect(filterPlanningFeatures(PLANNING_FEATURES, plan, 'pro', feature.category, ' פנדלים ')).toEqual([feature]);
  expect(filterPlanningFeatures(PLANNING_FEATURES, plan, 'free', feature.category, 'פנדלים')).toEqual([]);
  expect(filterPlanningFeatures(PLANNING_FEATURES, plan, 'pro', 'פרופיל וחברים', '')).toEqual([]);
});
test.each(['bad json', '[]', 'null', 'false', '{"x":null}', '{"x":"true"}'])('damaged storage fails without pretending no choices exist: %s', raw => {
  expect(() => parseProPlan(raw)).toThrow();
});
test('save and reload use only the isolated Pulse device key; failed reads and writes remain failures', async () => {
  const plan = { 'rounds/penalties': true, 'clubs/seasons': false };
  (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify(plan));
  await saveProPlan(plan);
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(PRO_PLAN_KEY, JSON.stringify(plan));
  expect(await loadProPlan()).toEqual(plan);
  (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(Error('read failed'));
  await expect(loadProPlan()).rejects.toThrow('read failed');
  (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(Error('disk full'));
  await expect(saveProPlan(plan)).rejects.toThrow('disk full');
});

