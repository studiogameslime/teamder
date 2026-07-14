// GameChampionship — the leaderboard for a SINGLE finished game.
//
// Goals + assists each player tallied IN THIS game, ranked by score
// (goal = 2 pts, assist = 1 pt). Rendered on MatchDetails only after the
// game is finished. Renders nothing until there's data (e.g. games that
// finished before per-game stats were tracked).

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CommunityStatsTable } from '@/components/community/CommunityStatsTable';
import { gameService } from '@/services';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { ChampionshipRow } from '@/utils/championship';

export function GameChampionship({
  gameId,
  groupId,
  /** Bump to force a refetch (e.g. after an admin adds/undoes a retro goal). */
  refreshKey,
}: {
  gameId: string;
  groupId?: string;
  refreshKey?: number;
}) {
  const [players, setPlayers] = useState<ChampionshipRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    gameService
      .getGameChampionship(gameId)
      .then((d) => {
        if (alive) setPlayers(d.players);
      })
      .catch(() => {
        if (alive) setPlayers([]);
      });
    return () => {
      alive = false;
    };
  }, [gameId, refreshKey]);

  if (!players || players.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{he.gameChampTitle}</Text>
      <Text style={styles.note}>{he.gameChampNote}</Text>
      {/* Same table + sort as the community table, minus the appearances column. */}
      <CommunityStatsTable players={players} groupId={groupId} hideAppearances />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginTop: spacing.md },
  title: { ...typography.body, color: colors.text, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  note: { ...typography.caption, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN, marginTop: -2 },
});
