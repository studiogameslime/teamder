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
  /** Attendees of the evening — listed even with no stats (report [cetR]). */
  attendedUids,
}: {
  gameId: string;
  groupId?: string;
  refreshKey?: number;
  attendedUids?: string[];
}) {
  const [players, setPlayers] = useState<ChampionshipRow[] | null>(null);
  const attendedKey = (attendedUids ?? []).join(',');

  useEffect(() => {
    let alive = true;
    gameService
      .getGameChampionship(gameId, attendedUids)
      .then((d) => {
        if (alive) setPlayers(d.players);
      })
      .catch(() => {
        if (alive) setPlayers([]);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, refreshKey, attendedKey]);

  if (!players || players.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{he.gameChampTitle}</Text>
      {/* Tap any column header to sort by it (default: wins). Same table as the
          community view, minus the appearances column. The scoring-formula note
          was removed per user feedback — the numbers speak for themselves. */}
      <CommunityStatsTable players={players} groupId={groupId} hideAppearances />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginTop: spacing.md },
  title: { ...typography.body, color: colors.text, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
});
