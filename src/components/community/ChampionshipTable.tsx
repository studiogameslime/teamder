// ChampionshipTable — the shared scorers/assisters leaderboard used by both
// the community championship (always shown) and the per-game championship
// (shown once a game is finished).
//
// One row per player, ranked by score (goal = 2 pts, assist = 1 pt). RTL
// column order, right → left: avatar · first name · goals · assists · score.
// The avatar + name are tappable and open that player's card.

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Card } from '@/components/Card';
import { UserAvatar } from '@/components/UserAvatar';
import { userService } from '@/services';
import { perGameScore, type ChampionshipRow } from '@/utils/championship';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { User } from '@/types';

type Resolved = Pick<User, 'id' | 'name' | 'avatarId' | 'photoUrl'>;
const MEDALS = ['#F4B73E', '#9AA4B2', '#CD7F32']; // gold / silver / bronze

/** First token only — "מתן לוי" → "מתן". */
function firstName(name: string): string {
  const t = (name || '').trim().split(/\s+/)[0];
  return t || name || '';
}

export function ChampionshipTable({
  players,
  groupId,
  limit = 20,
  variant = 'game',
}: {
  players: ChampionshipRow[];
  /** Passed through to the player card for community-scoped head-to-head. */
  groupId?: string;
  limit?: number;
  /** 'game' → goals · assists · mini-games · score-per-game (after a game).
   *  'community' → games · wins · goals (cumulative, in community details). */
  variant?: 'game' | 'community';
}) {
  const community = variant === 'community';
  const nav = useNavigation<{ navigate: (s: string, p: object) => void }>();
  const [people, setPeople] = useState<Record<string, Resolved>>({});

  const rows = players.slice(0, limit);

  useEffect(() => {
    let alive = true;
    Promise.all(
      rows.map((r) => userService.getUserById(r.uid).catch(() => null)),
    ).then((fetched) => {
      if (!alive) return;
      const map: Record<string, Resolved> = {};
      fetched.forEach((u) => {
        if (u) map[u.id] = u;
      });
      setPeople(map);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, limit]);

  if (rows.length === 0) return null;

  const openCard = (uid: string) =>
    nav.navigate('PlayerCard', groupId ? { userId: uid, groupId } : { userId: uid });

  return (
    <Card style={styles.table}>
      {/* Column headers (RTL: name area on the right, stat columns left). */}
      <View style={[styles.row, styles.headerRow]}>
        <View style={styles.who}>
          <Text style={styles.headerWho}>{he.champColPlayer}</Text>
        </View>
        {community ? (
          <>
            <Text numberOfLines={1} style={[styles.stat, styles.headerStat]}>{he.champColGames}</Text>
            <Text numberOfLines={1} style={[styles.stat, styles.headerStat]}>{he.champColWins}</Text>
            <Text numberOfLines={1} style={[styles.stat, styles.headerScore]}>{he.champColGoals}</Text>
          </>
        ) : (
          <>
            <Text numberOfLines={1} style={[styles.stat, styles.headerStat]}>{he.champColGoals}</Text>
            <Text numberOfLines={1} style={[styles.stat, styles.headerStat]}>{he.champColAssists}</Text>
            <Text numberOfLines={1} style={[styles.stat, styles.headerStat]}>{he.champColGames}</Text>
            <Text numberOfLines={1} style={[styles.stat, styles.headerScore]}>{he.champColScore}</Text>
          </>
        )}
      </View>

      {rows.map((r, i) => {
        const p = people[r.uid];
        // Score per mini-game (1 decimal). Whole numbers show without ".0".
        const avg = perGameScore(r.goals, r.assists, r.rounds);
        const avgText = Number.isInteger(avg) ? String(avg) : avg.toFixed(1);
        return (
          <View key={r.uid} style={[styles.row, styles.dataRow]}>
            {/* Avatar + name → tappable, opens the player card. */}
            <Pressable
              style={styles.who}
              onPress={() => openCard(r.uid)}
              accessibilityRole="button"
              accessibilityLabel={p?.name ?? ''}
            >
              <View
                style={[
                  styles.avatarWrap,
                  i < 3 && { borderColor: MEDALS[i], borderWidth: 2 },
                ]}
              >
                <UserAvatar user={p ?? { id: r.uid, name: '' }} size={32} />
              </View>
              <Text style={styles.name} numberOfLines={1}>
                {p ? firstName(p.name) : '—'}
              </Text>
            </Pressable>
            {community ? (
              <>
                <Text style={styles.stat}>{r.games}</Text>
                <Text style={styles.stat}>{r.wins}</Text>
                <Text style={[styles.stat, styles.score]}>{r.goals}</Text>
              </>
            ) : (
              <>
                <Text style={styles.stat}>{r.goals}</Text>
                <Text style={styles.stat}>{r.assists}</Text>
                <Text style={styles.stat}>{r.rounds}</Text>
                <Text style={[styles.stat, styles.score]}>{avgText}</Text>
              </>
            )}
          </View>
        );
      })}
    </Card>
  );
}

const STAT_W = 52;
const SCORE_W = 52;

const styles = StyleSheet.create({
  table: { padding: spacing.sm, gap: 0 },
  // Plain `row` (not row-reverse): under forceRTL the first child lands on the
  // visual RIGHT, so [who, goals, assists, score] reads right → left exactly
  // as specced.
  row: { flexDirection: 'row', alignItems: 'center' },
  headerRow: {
    paddingBottom: spacing.xs,
    marginBottom: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  dataRow: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  who: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatarWrap: { borderRadius: 99, padding: 1.5, borderColor: 'transparent', borderWidth: 2 },
  name: { flex: 1, minWidth: 0, ...typography.body, color: colors.text, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  headerWho: { ...typography.caption, color: colors.textMuted, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  stat: {
    width: STAT_W,
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  score: { width: SCORE_W, color: colors.primary, fontWeight: '900' },
  headerStat: { width: STAT_W, ...typography.caption, fontSize: 11, color: colors.textMuted, fontWeight: '700', textAlign: 'center' },
  headerScore: { width: SCORE_W, ...typography.caption, fontSize: 11, color: colors.primary, fontWeight: '800', textAlign: 'center' },
});
