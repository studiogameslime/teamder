import React from 'react';
jest.mock('react-native', () => ({ View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: (v: unknown) => v, absoluteFill: {} } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'Gradient' }));
jest.mock('react-native-svg', () => ({ __esModule: true, default: 'Svg', Circle: 'Circle', Line: 'Line', Path: 'Path', Rect: 'Rect' }));
import { MyActivityDashboard, activityDuration, type MyActivityMetrics } from '../../src/components/activity/MyActivityDashboard';
import { MyActivityRoundCard } from '../../src/components/activity/MyActivityRoundCard';

const data: MyActivityMetrics = { recordingMs: 32 * 60000 + 48000, distanceM: 2310, steps: 3184, calories: 248, avgHeartRateBpm: 138, maxHeartRateBpm: 172 };
const nodes = (n: any): any[] => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(nodes) : [n, ...nodes(n.props?.children)];
const copy = (n: any): string => n == null || n === false ? '' : typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(copy).join(' ') : copy(n.props?.children);
function expand(n: any): any {
  if (!n || typeof n !== 'object') return n;
  if (Array.isArray(n)) return n.map(expand);
  if (typeof n.type === 'function') return expand(n.type(n.props));
  return { ...n, props: { ...n.props, children: expand(n.props?.children) } };
}

test('dashboard uses independent recording duration without a match denominator or invented percentage', () => {
  const tree = expand(MyActivityDashboard({ status: 'available', scope: 'recording', periodLabel: 'ההקלטה האחרונה', sourceLabel: 'השעון שלי', metrics: data }));
  expect(copy(tree)).toContain('32:48'); expect(copy(tree)).toContain('מההתחלה ועד העצירה שלך');
  expect(copy(tree)).not.toContain('63%'); expect(copy(tree)).not.toContain('מתוך 40');
  for (const value of ['2.31', '3,184']) expect(copy(tree)).toContain(value);
  expect(copy(tree)).not.toContain('הדופק שלך'); expect(copy(tree)).not.toContain('קלוריות');
});

test('day scope is explicit and never silently relabeled as a match', () => {
  const tree = expand(MyActivityDashboard({ status: 'available', scope: 'day', periodLabel: 'היום', sourceLabel: null, metrics: data }));
  expect(copy(tree)).toContain('קילומטרים ביום הנבחר'); expect(copy(tree)).toContain('מקור המדידה לא זמין');
  expect(copy(tree)).not.toContain('כיסוי המדידה');
});

test('missing measurements differ from measured zero and invalid values stay absent', () => {
  const tree = expand(MyActivityDashboard({ status: 'available', scope: 'recording', periodLabel: 'הקלטה', sourceLabel: 'שעון',
    metrics: { ...data, recordingMs: 0, distanceM: 0, steps: 0, calories: null, avgHeartRateBpm: NaN, maxHeartRateBpm: -1 } }));
  expect(copy(tree)).toContain('0:00'); expect(copy(tree)).toContain('0.00'); expect(copy(tree)).toContain('לא נמדד');
  expect(copy(tree)).not.toContain('NaN'); expect(copy(tree)).not.toContain('-1');
});

test.each(['empty', 'disconnected', 'loading'] as const)('%s never displays leftover measurements', status => {
  const tree = expand(MyActivityDashboard({ status, scope: 'recording', periodLabel: 'הקלטה', sourceLabel: null, metrics: data }));
  expect(copy(tree)).not.toContain('2.31'); expect(copy(tree)).not.toContain('3,184');
});

test('connection and recording-history controls only exist when callers supply actions', () => {
  const connect = jest.fn(), history = jest.fn();
  const tree = expand(MyActivityDashboard({ status: 'disconnected', scope: 'recording', periodLabel: 'היום', sourceLabel: null, metrics: null, onConnect: connect, onOpenRecordings: history }));
  nodes(tree).filter(n => n.type === 'Pressable').forEach(n => n.props.onPress());
  expect(connect).toHaveBeenCalledTimes(1); expect(history).toHaveBeenCalledTimes(1);
  expect(nodes(expand(MyActivityDashboard({ status: 'empty', scope: 'day', periodLabel: 'היום', sourceLabel: null, metrics: null }))).filter(n => n.type === 'Pressable')).toHaveLength(0);
});

test('compact card displays all six fields and explicitly labels the data private', () => {
  const open = jest.fn();
  const tree = MyActivityRoundCard({ status: 'available', metrics: data, sourceLabel: 'השעון', onPress: open });
  expect(copy(tree)).toContain('פרטי, לא נכלל בתמונת השיתוף');
  for (const label of ['משך ההקלטה', 'קילומטרים', 'צעדים', 'קלוריות', 'דופק ממוצע', 'דופק מרבי']) expect(copy(tree)).toContain(label);
  expect(copy(tree)).not.toContain('כיסוי');
  nodes(tree).find(n => n.type === 'Pressable')!.props.onPress(); expect(open).toHaveBeenCalledTimes(1);
});

test('compact card retains missing metrics and disables refresh during an active refresh', () => {
  const tree = MyActivityRoundCard({ status: 'available', metrics: { ...data, calories: null, avgHeartRateBpm: null, maxHeartRateBpm: null }, sourceLabel: null, refreshing: true, onRefresh: jest.fn() });
  expect(copy(tree)).toContain('לא נמדד');
  expect(nodes(tree).find(n => n.type === 'Pressable')!.props.disabled).toBe(true);
});

test('duration supports hour-long sessions without wrapping back to minute zero', () => {
  expect(activityDuration(3723000)).toBe('1:02:03'); expect(activityDuration(null)).toBe('לא נמדד');
});


test('football movement uses covered time as denominator, includes sprints within running and hides health cards', () => {
  const tree = expand(MyActivityDashboard({ status: 'available', scope: 'day', periodLabel: 'יום קודם', sourceLabel: 'מקור',
    metrics: { ...data, movement: { maxSpeedKmh: 24.3, avgSpeedKmh: 6.2, stationaryMs: 60000, walkingMs: 60000,
      runningMs: 120000, sprintMs: 10000, sprints: 3, sampledMs: 240000 } } }));
  for (const value of ['24.3', '6.2', '25%', '50%', 'ספרינטים', 'ריצה, כולל ספרינטים']) expect(copy(tree)).toContain(value);
  expect(copy(tree)).not.toContain('קלוריות'); expect(copy(tree)).not.toContain('הדופק שלך');
  expect(copy(tree)).toContain('פערים בנתונים אינם מנוחה');
});