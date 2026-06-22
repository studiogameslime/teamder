// CommunityChampionship — the club's scorers + assisters leaderboard.
//
// Ranks players by score (goal = 2 pts, assist = 1 pt) THROUGH this club's
// games only (gameService.getCommunityChampionship → communityPlayerStats),
// NOT a player's global stats. Shows the club totals (goals + mini-games)
// and the shared ChampionshipTable. Renders nothing until there's data.

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/Card';
import { ChampionshipTable } from '@/components/community/ChampionshipTable';
import { gameService } from '@/services';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { ChampionshipRow } from '@/utils/championship';

export function CommunityChampionship({ groupId }: { groupId: string }) {
  const [data, setData] = useState<{
    totalGoals: number;
    totalRounds: number;
    players: ChampionshipRow[];
  } | null>(null);

  useEffect(() => {
    let alive = true;
    gameService
      .getCommunityChampionship(groupId)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        /* leave null → render nothing */
      });
    return () => {
      alive = false;
    };
  }, [groupId]);

  if (!data || data.players.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{he.communityChampTitle}</Text>
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

      <ChampionshipTable players={data.players} groupId={groupId} variant="community" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginTop: spacing.md },
  title: { ...typography.body, color: colors.text, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  note: { ...typography.caption, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN, marginTop: -2 },
  totals: { flexDirection: 'row', gap: spacing.sm },
  totalCard: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: spacing.md },
  totalValue: { ...typography.h2, color: colors.text, fontWeight: '900' },
  totalLabel: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
});
