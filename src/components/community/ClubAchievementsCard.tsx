// ClubAchievementsCard — the club's badge grid ("הישגי המועדון").
//
// It used to live, inline, at the very bottom of CommunityStatsScreen. The
// owner (report from Eliran, 1.1.9) asked for it on the club page instead,
// directly under the "נתוני מועדון" block — so the grid moved here, into one
// component both screens can mount, rather than being copied.
//
// Pure presentation: the caller owns the metrics. That matters, because the
// six club metrics come from three different aggregates and each screen
// already holds a different subset of them — a component that fetched its own
// would be re-reading what its host just read.

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Card } from '@/components/Card';
import { AchievementBadge } from '@/components/AchievementBadge';
import { appAlert } from '@/components/AppDialog';
import {
  computeClubBadges,
  type ClubBadge,
  type ClubMetrics,
} from '@/data/clubAchievements';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  /** The club's lifetime metrics. `null` while they are still loading — the
   *  section hides rather than showing six locked badges that then light up. */
  metrics: ClubMetrics | null;
}

export function ClubAchievementsCard({ metrics }: Props) {
  const badges = useMemo(
    () => (metrics ? computeClubBadges(metrics) : []),
    [metrics],
  );

  if (!metrics) return null;

  const onBadgePress = (b: ClubBadge) => {
    const target = b.next?.threshold ?? b.def.tiers[b.def.tiers.length - 1].threshold;
    const progress =
      b.tier && !b.next
        ? he.clubAchievementGold
        : he.clubAchievementProgress(b.value, target);
    appAlert(b.def.titleHe, `${b.def.howHe}\n\n${progress}`);
  };

  return (
    <View>
      {/* Under forceRTL, 'row' packs the first child (the icon) to the RIGHT
          and anchors the whole header right. ('row-reverse' pushes it left.) */}
      <View style={styles.sectionTitle}>
        <Ionicons name="medal" size={16} color={colors.primary} />
        <Text style={styles.sectionTitleText}>
          {he.communityStatsSectionAchievements}
        </Text>
      </View>
      <Card style={styles.badgeCard}>
        <View style={styles.badgeGrid}>
          {badges.map((b) => (
            <AchievementBadge
              key={b.def.id}
              def={b.def}
              tier={b.tier}
              size={64}
              showTierLabel
              onPress={() => onBadgePress(b)}
              style={styles.badgeItem}
            />
          ))}
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  sectionTitleText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
    writingDirection: 'rtl',
  },
  badgeCard: { paddingVertical: spacing.md, paddingHorizontal: spacing.sm },
  badgeGrid: {
    // 'row', like the personal תארים grid — under forceRTL it puts the FIRST
    // badge on the visual RIGHT, where a Hebrew reader's eye starts. The
    // 'row-reverse' this grid was carrying since it lived on the stats screen
    // cancelled that flip and laid the six badges out left-to-right: the
    // reporter's own screenshot shows "מפגשים", the first of the catalogue,
    // pinned to the far LEFT of the card.
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    rowGap: spacing.md,
  },
  badgeItem: { width: '33.3%' },
});
