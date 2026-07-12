// CommunityChampionship — the club's scorers + assisters leaderboard.
//
// Ranks players by score (goal = 2 pts, assist = 1 pt) THROUGH this club's
// games only (gameService.getCommunityChampionship → communityPlayerStats),
// NOT a player's global stats. Shows the club totals (goals + mini-games)
// and the shared ChampionshipTable. Renders nothing until there's data.

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/Card';
import { CommunityStatsTable } from '@/components/community/CommunityStatsTable';
import { gameService } from '@/services';
import { appAlert } from '@/components/AppDialog';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { ChampionshipRow } from '@/utils/championship';

export function CommunityChampionship({
  groupId,
  // The club's registered members — passed so the table lists EVERYONE, not
  // only players who already have stats (members with no games show as zero).
  memberIds,
}: {
  groupId: string;
  memberIds?: string[];
}) {
  const [data, setData] = useState<{
    totalGoals: number;
    totalRounds: number;
    players: ChampionshipRow[];
  } | null>(null);

  const memberKey = (memberIds ?? []).join(',');
  useEffect(() => {
    let alive = true;
    gameService
      .getCommunityChampionship(groupId, memberIds)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        /* leave null → render nothing */
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, memberKey]);

  if (!data || data.players.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{he.communityChampTitle}</Text>
        <Pressable
          onPress={() =>
            appAlert(he.communityChampInfoTitle, he.communityChampInfoBody)
          }
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={he.communityChampInfoTitle}
        >
          <Ionicons
            name="information-circle-outline"
            size={18}
            color={colors.textMuted}
          />
        </Pressable>
      </View>
      <Text style={styles.note}>{he.communityChampNote}</Text>

      <View style={styles.totals}>
        <Card style={styles.totalCard}>
          <Ionicons name="football" size={18} color={colors.primary} />
          <Text style={styles.totalValue}>{data.totalGoals}</Text>
          <Text style={styles.totalLabel}>{he.communityChampTotalGoals}</Text>
        </Card>
        <Card style={styles.totalCard}>
          <Ionicons name="repeat" size={18} color={colors.primary} />
          <Text style={styles.totalValue}>{data.totalRounds}</Text>
          <Text style={styles.totalLabel}>{he.communityChampTotalRounds}</Text>
        </Card>
      </View>

      <CommunityStatsTable players={data.players} groupId={groupId} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginTop: spacing.md },
  titleRow: {
    // Under forceRTL, 'row' makes the main-axis start the visual RIGHT, so
    // flex-start packs the title flush-right (was 'row-reverse' → left).
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
  },
  title: { ...typography.body, color: colors.text, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  note: { ...typography.caption, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN, marginTop: -2 },
  totals: { flexDirection: 'row', gap: spacing.sm },
  totalCard: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: spacing.md },
  totalValue: { ...typography.h2, color: colors.text, fontWeight: '900' },
  totalLabel: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
});
