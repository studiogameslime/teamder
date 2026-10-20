// Club eligibility stays live and host-owned; visuals match the personal cabinet.
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AchievementTile, AchievementDetail, type AchievementDisplayItem } from '@/components/profile/AchievementCabinetCards';
import { computeClubBadges, type ClubMetrics } from '@/data/clubAchievements';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

export function ClubAchievementsCard({ metrics }: { metrics: ClubMetrics | null }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const items = useMemo<AchievementDisplayItem[]>(() => metrics ? computeClubBadges(metrics).map(badge => ({
    def: { ...badge.def, ...(badge.def.id === 'organization' ? { nounHe: 'מהמחזורים שהתקיימו' } : {}) },
    value: badge.value,
    currentTier: badge.def.tiers.find(step => step.tier === badge.tier) ?? null,
    next: badge.next,
    unlocked: badge.tier !== null,
    ...(badge.def.id === 'organization' ? { unit: 'percent' as const } : {}),
  })) : [], [metrics]);
  if (!metrics) return null;
  const active = items.find(item => item.def.id === activeId) ?? null;
  return <View>
    <View style={styles.sectionTitle}>
      <Text style={styles.sectionTitleText}>{he.communityStatsSectionAchievements}</Text>
    </View>
    <View style={styles.grid}>
      {items.map(item => <AchievementTile key={item.def.id} item={item} unavailable={false} onPress={() => setActiveId(item.def.id)} />)}
    </View>
    <AchievementDetail item={active} unavailable={false} context="club" onClose={() => setActiveId(null)} />
  </View>;
}
const styles = StyleSheet.create({
  sectionTitle: { marginTop: spacing.md, marginBottom: spacing.sm },
  sectionTitleText: { ...typography.body, color: colors.text, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'space-between' },
});
