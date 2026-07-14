// CommunityStatsTable — the club's cumulative per-player stats table, shown in
// community details. One row per player: גולים · משחקים · ניצחונות · הפסדים ·
// בישולים, accumulated over the player's whole time in the club (never resets).
// Ranked by goals.
//
// There are more columns than fit a phone, so the NAME column is fixed on the
// right and the stat columns scroll horizontally as one unit (header + rows
// together). Avatar + name open the player's card.

import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Card } from '@/components/Card';
import { UserAvatar } from '@/components/UserAvatar';
import { userService } from '@/services';
import { type ChampionshipRow } from '@/utils/championship';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { User } from '@/types';

type Resolved = Pick<User, 'id' | 'name' | 'avatarId' | 'photoUrl'>;
const MEDALS = ['#F4B73E', '#9AA4B2', '#CD7F32']; // gold / silver / bronze
const ROW_H = 56;
const HEADER_H = 34;
const STAT_W = 66;
// Wide enough for a real first name (e.g. "מקסימיליאן", ~10 chars) to show in
// full next to the 30px avatar without clipping to "מקסימילי…". After the
// avatar (30) + horizontal padding/gap (~30) the name gets the remaining ~140,
// enough for the longest real Hebrew first names. The stat grid to the left
// scrolls, so a wider name column costs nothing but viewport width.
const NAME_W = 172;

function firstName(name: string): string {
  const t = (name || '').trim().split(/\s+/)[0];
  return t || name || '';
}

export function CommunityStatsTable({
  players,
  groupId,
  limit = 30,
  /** Drop the "הופעות" (evenings attended) column — the per-game table reuses
   *  this table but appearances are meaningless for a single game. */
  hideAppearances = false,
}: {
  players: ChampionshipRow[];
  groupId?: string;
  limit?: number;
  hideAppearances?: boolean;
}) {
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

  // Goals first (the ranking metric → visible without scrolling), then the
  // rest. Scroll the strip to reveal the others.
  // Mini-games (rounds), NOT evenings, as the "played" count — so it shares a
  // unit with wins/losses (you can't win more rounds than you played). An
  // Column order (RTL, right→left, next to the name column): wins → goals →
  // assists → then the outcomes/counts (losses → appearances → mini-games).
  // Wins lead — it's the headline stat the owner wants read first — followed by
  // the two point sources (goals, assists).
  const allCols: Array<{ key: keyof ChampionshipRow; label: string; primary?: boolean }> = [
    { key: 'wins', label: he.champColWins, primary: true },
    { key: 'goals', label: he.champColGoals },
    { key: 'assists', label: he.champColAssists },
    { key: 'losses', label: he.champColLosses },
    { key: 'games', label: he.champColAppearances }, // evenings attended
    { key: 'rounds', label: he.champColMiniGames }, // mini-games played
  ];
  const cols = allCols.filter((c) => !(hideAppearances && c.key === 'games'));

  return (
    <Card style={styles.table}>
      <View style={styles.split}>
        {/* Fixed name column (lands on the RIGHT under forceRTL). */}
        <View style={styles.nameCol}>
          <View style={styles.headerCell}>
            <Text style={styles.headerWho}>{he.champColPlayer}</Text>
          </View>
          {rows.map((r, i) => {
            const p = people[r.uid];
            return (
              <Pressable
                key={r.uid}
                style={styles.nameCell}
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
                  <UserAvatar user={p ?? { id: r.uid, name: '' }} size={30} />
                </View>
                <Text style={styles.name} numberOfLines={1}>
                  {p ? firstName(p.name) : '—'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Scrollable stat grid (header + rows scroll together). */}
        <ScrollView horizontal showsHorizontalScrollIndicator style={styles.scroll}>
          <View>
            <View style={[styles.gridRow, { height: HEADER_H }]}>
              {cols.map((c) => (
                <Text
                  key={c.key}
                  numberOfLines={1}
                  style={[styles.statHeader, c.primary && styles.primaryHeader]}
                >
                  {c.label}
                </Text>
              ))}
            </View>
            {rows.map((r) => (
              <View key={r.uid} style={[styles.gridRow, styles.dataRow]}>
                {cols.map((c) => (
                  <Text
                    key={c.key}
                    style={[styles.statCell, c.primary && styles.primaryCell]}
                  >
                    {r[c.key]}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  table: { padding: 0, overflow: 'hidden' },
  split: { flexDirection: 'row' },
  nameCol: {
    width: NAME_W,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
    backgroundColor: colors.surface,
    zIndex: 2,
  },
  scroll: { flex: 1 },
  headerCell: {
    height: HEADER_H,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerWho: { ...typography.caption, color: colors.textMuted, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  nameCell: {
    height: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  avatarWrap: { borderRadius: 99, padding: 1.5, borderColor: 'transparent', borderWidth: 2 },
  name: { flex: 1, minWidth: 0, ...typography.body, color: colors.text, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  gridRow: { flexDirection: 'row', alignItems: 'center' },
  dataRow: { height: ROW_H, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  statHeader: {
    width: STAT_W,
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '700',
    textAlign: 'center',
  },
  primaryHeader: { color: colors.primary, fontWeight: '800' },
  statCell: {
    width: STAT_W,
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  primaryCell: { color: colors.primary, fontWeight: '900' },
});
