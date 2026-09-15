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
import { MatchSegmentControl } from '@/components/match/MatchSegmentControl';
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
  // Authoritative "הופעות" per uid (finished-nights scan) — overrides the
  // drift-prone rollup for the appearances column.
  attendedByUser,
  // The club's season, when it runs them. Only the LABEL changes: the numbers
  // in this table already belong to the running season, because a rollover
  // zeroes the rows it reads. What was wrong was calling them "מצטבר" — a
  // promise of a career, printed over one season, which is the single string
  // most likely to make a member believe their data was deleted.
  seasonNo,
}: {
  groupId: string;
  memberIds?: string[];
  attendedByUser?: Record<string, number>;
  seasonNo?: number;
}) {
  // Which view of the same rows. 'מצטבר' is the table exactly as it has
  // always been; 'יעילות' is per-game rates over those same players. Not
  // remembered between visits — the totals are what most people come for.
  const [tab, setTab] = useState<'cumulative' | 'efficiency'>('cumulative');
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

  // Clean sheets have only been recorded since mid-August, so a long-standing
  // player's percentage is computed over a shorter window than their history.
  // Say so once, under the table, rather than starring individual cells.
  const anyPartial =
    !!data &&
    data.players.some(
      (p) =>
        (p.rounds ?? 0) > 0 &&
        typeof p.csRounds === 'number' &&
        p.csRounds < (p.rounds ?? 0),
    );

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

      <MatchSegmentControl
        value={tab}
        onChange={setTab}
        options={[
          {
            value: 'cumulative',
            label: seasonNo
              ? he.statsTabSeason(seasonNo)
              : he.statsTabCumulative,
          },
          { value: 'efficiency', label: he.statsTabEfficiency },
        ]}
      />

      <CommunityStatsTable
        players={data.players}
        groupId={groupId}
        // Suppressed when the club runs seasons.
        //
        // `attendedByUser` is an authoritative ALL-TIME scan of finished games,
        // and it overrides the rollup's `games`. Under a table headed "עונה 3"
        // that puts one lifetime column among season columns — a player shows
        // 41 appearances beside 6 goals — and it silently breaks every
        // per-game rate in the efficiency tab, which divides by it.
        //
        // The rollup's own `games` counter IS season-scoped, because the close
        // winds it back with everything else. That is the right number here.
        attendedByUser={seasonNo ? undefined : attendedByUser}
        mode={tab}
      />

      {tab === 'efficiency' && anyPartial && (
        <Text style={styles.coverageNote}>{he.effPartialNote}</Text>
      )}
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
  coverageNote: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    marginTop: spacing.xs,
    lineHeight: 18,
  },
  note: { ...typography.caption, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN, marginTop: -2 },
  totals: { flexDirection: 'row', gap: spacing.sm },
  totalCard: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: spacing.md },
  totalValue: { ...typography.h2, color: colors.text, fontWeight: '900' },
  totalLabel: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
});
