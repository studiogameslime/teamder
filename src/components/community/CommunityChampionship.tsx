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
import { seasonHistoryService } from '@/services/seasonHistoryService';
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
  // A CLOSED season to show instead of the running one. The archive holds
  // every column this table renders, so a past season is exactly as complete
  // as the live one — which is the whole reason it is worth offering.
  seasonId,
  /** Rows the caller has ALREADY assembled — used for the all-time scope,
   *  which is the live table plus every archive and therefore cannot be
   *  fetched as one document. When given, nothing is loaded here. */
  rows,
  /** Evenings (מחזורים) the club HELD in the scope on screen — the running
   *  season, one sealed season, or all time — and the denominator of the
   *  efficiency tab's attendance column.
   *
   *  Only the caller knows it: this component is handed rows, not a scope, and
   *  the evening count comes from a different source for each one (the
   *  finished-games scan for the running season, the sealed card for a past
   *  one, the unscoped scan for all time). Handing over the WRONG scope's
   *  count is worse than handing over none — a season's attendance over a
   *  lifetime of evenings makes every regular look like a drop-in — so when in
   *  doubt it is left out and the column hides itself. */
  clubEvenings,
}: {
  groupId: string;
  memberIds?: string[];
  attendedByUser?: Record<string, number>;
  seasonNo?: number;
  seasonId?: string;
  rows?: {
    totalGoals: number;
    totalRounds: number;
    players: ChampionshipRow[];
    names?: Record<string, string>;
  } | null;
  clubEvenings?: number;
}) {
  // Which view of the same rows. 'מצטבר' is the table exactly as it has
  // always been; 'יעילות' is per-game rates over those same players. Not
  // remembered between visits — the totals are what most people come for.
  const [tab, setTab] = useState<'cumulative' | 'efficiency'>('cumulative');
  const [frozenNames, setFrozenNames] = useState<Record<string, string>>({});
  const [data, setData] = useState<{
    totalGoals: number;
    totalRounds: number;
    players: ChampionshipRow[];
  } | null>(null);

  const memberKey = (memberIds ?? []).join(',');
  useEffect(() => {
    let alive = true;
    setData(null);
    // A past season comes from its archive; the running one from the live
    // rows, which ARE that season.
    // ⚠️ `null` is NOT `undefined` here, and the difference is the whole
    // contract of this prop. `undefined` means "no caller-assembled rows
    // exist — fetch the club's live table". `null` means "the caller owns
    // these rows and has not finished assembling them yet", which is what
    // CommunityStatsScreen passes for the whole round-trip it takes to read
    // every season archive under "כל הזמנים".
    //
    // Treating the two alike (a plain `if (rows)`) fell through to the fetch
    // and painted the RUNNING season's rows under an all-time heading until
    // the merge landed — the same class of mistake the screen's own
    // `scopeLoading` already prevents for every tile above this table, and
    // one this table alone still made. It got worse the moment `clubEvenings`
    // arrived: those season rows were then divided by the club's LIFETIME
    // evening count, which is precisely the cross-scope division the
    // attendance column is documented never to perform.
    //
    // So: hold at null and render nothing for that beat. The effect re-runs
    // the moment the caller hands over real rows, and a slice that will not
    // load moves the scope back to the running season anyway.
    if (rows !== undefined) {
      // Already assembled by the caller; a fetch here would be a second,
      // narrower answer to a question that has one.
      setData(rows);
      setFrozenNames(rows?.names ?? {});
      return () => {
        alive = false;
      };
    }
    setFrozenNames({});
    const load = seasonId
      ? seasonHistoryService.table(groupId, seasonId).then((t) => {
          // The names the season sealed, so a player who has since left is
          // still a name in the table they played in rather than a dash.
          if (t && alive) setFrozenNames(t.names);
          return t;
        })
      : gameService.getCommunityChampionship(groupId, memberIds);
    load
      .then((d) => {
        if (alive) setData(d ?? null);
      })
      .catch(() => {
        /* leave null → render nothing */
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, memberKey, seasonId, rows]);

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
        {/* Icon FIRST in source order → rightmost under forceRTL, which is
            where every other section heading on this screen carries its own
            (see SectionTitle in CommunityStatsScreen). This heading was the
            only one without one and read as a stray line of bold text. */}
        <Ionicons name="podium" size={16} color={colors.primary} />
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
      {/* The "ממוין לפי ניצחונות…" note used to sit here. It said what the
          tooltip beside the title already says, one line lower. */}

      {/* The goals/mini-games pair that used to sit here is gone: the same
          two numbers open this tab in "המועדון במספרים", and a second copy
          four sections later read as a different figure. */}

      <MatchSegmentControl
        value={tab}
        onChange={setTab}
        options={[
          // Totals vs. per-game rates — the pair is about the axis, not the
          // season. Which season is in view is already said by the scope chips
          // above, so naming it here read as if the other tab were all-time.
          { value: 'cumulative', label: he.statsTabCumulative },
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
        attendedByUser={seasonNo || seasonId || rows ? undefined : attendedByUser}
        fallbackNames={seasonId || rows ? frozenNames : undefined}
        // The same club mini-game total shown in the tile above, so the
        // efficiency tab's entry bar is a share of the season on screen — a
        // past season's bar is measured against that season, not against today.
        clubRounds={data.totalRounds}
        // The evenings behind the "הופעות" column, for the same scope. Absent
        // → the attendance column is not shown.
        clubEvenings={clubEvenings}
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
  title: {
    ...typography.body,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
    writingDirection: 'rtl',
  },
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
