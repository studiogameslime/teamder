import React from 'react';
import { Image } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

// Optical sizes and silhouettes follow the approved season-summary sketches.
// Title emblems deliberately remain a separate, shared award system.
const sources = {
  ball: require('../../../assets/season-summary/ball.png'),
  boot: require('../../../assets/season-summary/boot.png'),
  goal: require('../../../assets/season-summary/goal.png'),
  calendar: require('../../../assets/season-summary/calendar.png'),
  trophy: require('../../../assets/season-summary/trophy.png'),
  loss: require('../../../assets/season-summary/loss.png'),
  equal: require('../../../assets/season-summary/equal.png'),
  bars: require('../../../assets/season-summary/bars.png'),
  shield: require('../../../assets/season-summary/shield.png'),
  target: require('../../../assets/season-summary/target.png'),
  ownGoal: require('../../../assets/season-summary/own-goal.png'),
  people: require('../../../assets/season-summary/people.png'),
  contribution: require('../../../assets/season-summary/contribution.png'),
  goldGoal: require('../../../assets/season-summary/gold-goal.png'),
  goldTrophy: require('../../../assets/season-summary/gold-trophy.png'),
  purpleBoot: require('../../../assets/season-summary/purple-boot.png'),
  pairTrophy: require('../../../assets/season-summary/pair-trophy.png'),
  pitch: require('../../../assets/season-summary/pitch.png'),
  pairTarget: require('../../../assets/season-summary/pair-target.png'),
  return: require('../../../assets/season-summary/return.png'),
};
export type SeasonSummaryIconName = keyof typeof sources;
const aliases: Record<string, SeasonSummaryIconName> = {
  football: 'ball', 'football-outline': 'ball', 'footsteps-outline': 'boot',
  'grid-outline': 'boot', 'git-branch-outline': 'boot', 'git-network-outline': 'boot',
  'calendar-outline': 'calendar', 'trophy-outline': 'trophy',
  'close-circle-outline': 'loss', 'skull-outline': 'loss',
  'remove-circle-outline': 'equal', 'stats-chart': 'bars', 'stats-chart-outline': 'bars',
  'bar-chart-outline': 'bars', 'trending-up-outline': 'bars', 'sparkles-outline': 'bars',
  'shield-outline': 'shield', 'shield-checkmark-outline': 'goal',
  'speedometer-outline': 'ball', 'locate-outline': 'target',
  'return-down-back-outline': 'ownGoal', 'people-outline': 'people', people: 'people',
  'people-circle-outline': 'people', 'flash-outline': 'contribution',
  'hand-left-outline': 'return',
};
export function SeasonSummaryIcon({ name, size = 24 }: { name: SeasonSummaryIconName | keyof typeof Ionicons.glyphMap; size?: number }) {
  if (name === 'flame-outline') return <MaterialCommunityIcons name="sword-cross" size={size} color="#627A9E" />;
  const key = (name in sources ? name : aliases[name]) as SeasonSummaryIconName | undefined;
  return key ? <Image source={sources[key]} style={{ width: size, height: size }} resizeMode="contain" accessible={false} />
    : <Ionicons name={name as keyof typeof Ionicons.glyphMap} size={size} color="#627A9E" />;
}
