// GameChampionship — the leaderboard for a SINGLE finished game.
//
// Per-game counters (default ranking: sealed evening rating) plus the
// sealed evening rating in its own sortable column. Rendered only after the
// game is finished. Renders nothing until there's data (e.g. games that
// finished before per-game stats were tracked).

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CommunityStatsTable } from '@/components/community/CommunityStatsTable';
import { gameService } from '@/services';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { ChampionshipRow } from '@/utils/championship';
import { getGameEveningScores } from '@/services/gameEveningScores';

export function GameChampionship({
  gameId,
  groupId,
  /** Bump to force a refetch (e.g. after an admin adds/undoes a retro goal). */
  refreshKey,
  /** Attendees of the evening — listed even with no stats (report [cetR]). */
  attendedUids,
  /** The game's guests — a guest is a full player in the cycle, so their
   *  scorer rows appear here; names resolve from this list (no /users doc). */
  guests,
}: {
  gameId: string;
  groupId?: string;
  refreshKey?: number;
  attendedUids?: string[];
  guests?: import('@/types').GameGuest[];
}) {
  const [players, setPlayers] = useState<ChampionshipRow[] | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [scoresFailed, setScoresFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const attendedKey = (attendedUids ?? []).join(',');

  useEffect(() => {
    let alive = true;
    setPlayers(null);
    setScores({});
    setScoresFailed(false);
    getGameEveningScores(gameId).then(values => {
      if (alive) setScores(values);
    }).catch(() => { if (alive) setScoresFailed(true); });
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
  }, [gameId, refreshKey, attendedKey, retry]);

  if (!players || players.length === 0) return null;

  // Guest name lookup (roster id `guest:<id>` → name) so the table can label
  // guest scorer rows, which have no /users doc to resolve.
  const guestNames: Record<string, string> = {};
  for (const g of guests ?? []) {
    if (g?.id) guestNames[`guest:${g.id}`] = g.name || he.matchRoundsGuest;
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{he.gameChampTitle}</Text>
      {/* Tap any column header to sort by it (default: evening score). Same table as the
          community view, minus the appearances column. The scoring-formula note
          was removed per user feedback — the numbers speak for themselves. */}
      <CommunityStatsTable
        players={players}
        groupId={groupId}
        hideAppearances
        guestNames={guestNames}
        eveningScores={scores}
      />
      {scoresFailed ? <Pressable accessibilityRole="button" onPress={() => setRetry(n => n + 1)}>
        <Text style={styles.note}>לא ניתן לטעון את ציוני המחזור. לחץ לניסיון נוסף.</Text>
      </Pressable> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginTop: spacing.md },
  title: { ...typography.body, color: colors.text, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  note: { ...typography.caption, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
});
