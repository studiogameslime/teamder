// CommunityChampionship — the club's goals leaderboard.
//
// Ranks players by goals scored THROUGH this club's games only
// (gameService.getCommunityChampionship → communityPlayerStats), NOT a
// player's global stats.goals. Shows the club totals (goals + mini-games)
// and a medal-ranked scorer table. Renders nothing until there's data.

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/Card';
import { UserAvatar } from '@/components/UserAvatar';
import { gameService, userService } from '@/services';
import { colors, spacing, typography, radius, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { User } from '@/types';

type Resolved = Pick<User, 'id' | 'name' | 'avatarId' | 'photoUrl'>;
const MEDALS = ['#F4B73E', '#9AA4B2', '#CD7F32']; // gold / silver / bronze

export function CommunityChampionship({ groupId }: { groupId: string }) {
  const [data, setData] = useState<{
    totalGoals: number;
    totalRounds: number;
    scorers: Array<{ uid: string; goals: number }>;
  } | null>(null);
  const [people, setPeople] = useState<Record<string, Resolved>>({});

  useEffect(() => {
    let alive = true;
    gameService
      .getCommunityChampionship(groupId)
      .then(async (d) => {
        if (!alive) return;
        setData(d);
        const top = d.scorers.slice(0, 12);
        const fetched = await Promise.all(
          top.map((s) => userService.getUserById(s.uid).catch(() => null)),
        );
        if (!alive) return;
        const map: Record<string, Resolved> = {};
        fetched.forEach((u) => {
          if (u) map[u.id] = u;
        });
        setPeople(map);
      })
      .catch(() => {
        /* leave null → render nothing */
      });
    return () => {
      alive = false;
    };
  }, [groupId]);

  if (!data || data.scorers.length === 0) return null;

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

      <Card style={styles.table}>
        {data.scorers.slice(0, 12).map((s, i) => {
          const p = people[s.uid];
          return (
            <View key={s.uid} style={[styles.row, i > 0 && styles.rowBorder]}>
              <View
                style={[
                  styles.rank,
                  i < 3 ? { backgroundColor: MEDALS[i] } : styles.rankPlain,
                ]}
              >
                <Text style={[styles.rankText, i < 3 && styles.rankTextMedal]}>
                  {i + 1}
                </Text>
              </View>
              <UserAvatar
                user={p ?? { id: s.uid, name: '' }}
                size={34}
                ring
              />
              <Text style={styles.name} numberOfLines={1}>
                {p?.name ?? '—'}
              </Text>
              <View style={styles.goals}>
                <Text style={styles.goalsNum}>{s.goals}</Text>
                <Ionicons name="football-outline" size={13} color={colors.textMuted} />
              </View>
            </View>
          );
        })}
      </Card>
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
  table: { padding: spacing.sm, gap: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rank: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankPlain: { backgroundColor: colors.surfaceMuted },
  rankText: { ...typography.caption, fontWeight: '900', color: colors.textMuted },
  rankTextMedal: { color: '#FFFFFF' },
  name: { flex: 1, minWidth: 0, ...typography.body, color: colors.text, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  goals: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, minWidth: 44, justifyContent: 'flex-end' },
  goalsNum: { ...typography.body, color: colors.primary, fontWeight: '900', fontVariant: ['tabular-nums'] },
  _r: { borderRadius: radius.md },
});
