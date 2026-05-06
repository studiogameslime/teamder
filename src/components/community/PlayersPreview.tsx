// PlayersPreview — horizontal jersey rail for the redesigned
// CommunityDetailsScreen. Replaces the old wrap-grid of avatar
// circles. Each cell shows the player's actual jersey (number printed
// on the shirt) with their name underneath; the last cell is a "+N"
// chip when more players exist than fit.
//
// Layout:
//   header → "שחקנים פעילים (N)"  ………………… "לצפייה בכל השחקנים →"
//   rail   → [shirt][shirt][shirt] … [+N]   (FlatList horizontal)
//
// Under forceRTL the FlatList still scrolls horizontally, but the
// natural reading order is right→left, so the first item in `members`
// renders visually rightmost. We keep it that way intentionally —
// there's no `inverted` flag needed.

import React, { useCallback } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Jersey } from '@/components/Jersey';
import type { User } from '@/types';
import { spacing, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  /** Total active players (used in the title and the +N chip). */
  total: number;
  /** Hydrated subset to render in the rail; first MAX_VISIBLE used. */
  members: Array<Pick<User, 'id' | 'name' | 'jersey'>>;
  onSeeAll: () => void;
  onPressMember?: (uid: string) => void;
}

const MAX_VISIBLE = 8;
const SHIRT_SIZE = 64;
const ACCENT = '#3B82F6';

type Cell =
  | { kind: 'player'; user: Pick<User, 'id' | 'name' | 'jersey'> }
  | { kind: 'overflow'; count: number };

export function PlayersPreview({
  total,
  members,
  onSeeAll,
  onPressMember,
}: Props) {
  const visible = members.slice(0, MAX_VISIBLE);
  const overflow = Math.max(0, total - visible.length);

  const data: Cell[] = [
    ...visible.map((u) => ({ kind: 'player' as const, user: u })),
    ...(overflow > 0 ? [{ kind: 'overflow' as const, count: overflow }] : []),
  ];

  const renderItem = useCallback<ListRenderItem<Cell>>(
    ({ item }) => {
      if (item.kind === 'overflow') {
        return (
          <Pressable
            onPress={onSeeAll}
            style={({ pressed }) => [
              styles.cell,
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={he.communityPlayersSeeAll}
          >
            <View style={styles.overflowDisc}>
              <Text style={styles.overflowText}>+{item.count}</Text>
            </View>
            <Text style={styles.overflowLabel} numberOfLines={1}>
              {he.communityPlayersSeeAll}
            </Text>
          </Pressable>
        );
      }
      const u = item.user;
      return (
        <Pressable
          onPress={() => onPressMember?.(u.id)}
          style={({ pressed }) => [
            styles.cell,
            pressed && { opacity: 0.7 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={u.name}
        >
          <Jersey jersey={u.jersey} user={u} size={SHIRT_SIZE} />
          <Text style={styles.name} numberOfLines={1}>
            {u.name}
          </Text>
        </Pressable>
      );
    },
    [onPressMember, onSeeAll],
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>
          {he.communityPlayersActiveTitle}{' '}
          <Text style={styles.count}>({total})</Text>
        </Text>
        <Pressable onPress={onSeeAll} hitSlop={8} style={styles.seeAllBtn}>
          <Text style={styles.seeAllText}>{he.communityPlayersSeeAll}</Text>
          <Ionicons name="chevron-back" size={14} color={ACCENT} />
        </Pressable>
      </View>

      {data.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.empty}>{he.communityPlayersEmpty}</Text>
        </View>
      ) : (
        <FlatList
          data={data}
          horizontal
          keyExtractor={(it, i) =>
            it.kind === 'overflow' ? `overflow-${i}` : it.user.id
          }
          renderItem={renderItem}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.rail}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  title: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  count: {
    color: '#64748B',
    fontWeight: '500',
  },
  seeAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  seeAllText: {
    color: ACCENT,
    fontSize: 13,
    fontWeight: '700',
  },
  rail: {
    paddingHorizontal: spacing.xs,
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  cell: {
    width: SHIRT_SIZE + 12,
    alignItems: 'center',
    gap: 6,
  },
  name: {
    color: '#0F172A',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    maxWidth: SHIRT_SIZE + 8,
  },
  // Overflow chip — same footprint as a jersey cell so the rail
  // rhythm stays even.
  overflowDisc: {
    width: SHIRT_SIZE,
    height: SHIRT_SIZE,
    borderRadius: SHIRT_SIZE / 2,
    backgroundColor: 'rgba(59,130,246,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overflowText: {
    color: ACCENT,
    fontSize: 18,
    fontWeight: '900',
  },
  overflowLabel: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  empty: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
});
