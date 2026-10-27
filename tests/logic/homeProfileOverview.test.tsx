import React from 'react';
jest.mock('react-native', () => ({ Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: (v: any) => v } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('@/components/stats/StatisticsIllustration', () => ({ StatisticsIllustration: 'Art' }));
jest.mock('@/theme', () => ({ RTL_LABEL_ALIGN: 'left' }));
import { HomeProfileOverview } from '@/components/home/HomeProfileOverview';
import type { PlayerStatsSummary } from '@/services/playerStatsService';
const stats: PlayerStatsSummary = { attendedGames: 54, goals: 31, assists: 24, totalRegistered: 56, attendanceRate: 96,
  goalsPerEvening: 0.6, distinctPlayers: 18, mostPlayedWith: null, mostWinsWith: null, biggestVictim: null,
  nemesis: null, mostAssistedTo: null, mostAssistedBy: null, attendanceStreak: { current: 4, best: 5 } };
function nodes(value: any): any[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  return React.isValidElement(value) ? [value, ...nodes((value.props as any).children)] : [];
}
test('profile and statistics actions are distinct, without a statistics press wrapper', () => {
  const onProfile = jest.fn(), onStatistics = jest.fn();
  const tree = HomeProfileOverview({ stats, onProfile, onStatistics });
  expect(tree.type).toBe('View');
  const buttons = nodes(tree).filter(n => n.type === 'Pressable');
  expect(buttons).toHaveLength(2);
  buttons.find(b => b.props.accessibilityLabel === 'כרטיס השחקן שלי').props.onPress();
  expect(onProfile).toHaveBeenCalledTimes(1); expect(onStatistics).not.toHaveBeenCalled();
  buttons.find(b => b.props.accessibilityLabel === 'הסטטיסטיקה שלי').props.onPress();
  expect(onStatistics).toHaveBeenCalledTimes(1);
});
test('overview shows one set of totals, a real streak and correctly bounded record progress', () => {
  const all = nodes(HomeProfileOverview({ stats, onProfile() {}, onStatistics() {} }));
  const texts = all.filter(n => n.type === 'Text').map(n => n.props.children);
  expect(texts.filter(t => t === 54)).toHaveLength(1);
  expect(texts.filter(t => t === 31)).toHaveLength(1);
  expect(texts.filter(t => t === 24)).toHaveLength(1);
  expect(texts.filter(t => ['מחזורים', 'שערים', 'בישולים'].includes(t))).toEqual(['מחזורים', 'שערים', 'בישולים']);
  expect(texts).toContain('4 הגעות ברצף!');
  expect(all.find(n => n.props.accessibilityRole === 'progressbar').props.accessibilityValue).toEqual({ min: 0, max: 5, now: 4 });
});
