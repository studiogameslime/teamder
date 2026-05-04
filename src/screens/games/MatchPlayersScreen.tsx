// MatchPlayersScreen — full roster for a single game.
//
// Sections:
//   • שחקנים רשומים    (in `players[]`)
//   • רשימת המתנה      (in `waitlist[]`)
//   • ממתינים לאישור   (in `pending[]`)   — admin sees count; users
//                                            who are in pending see
//                                            themselves too
//   • אורחים            (g.guests)
//
// Each player row shows: jersey, name, optional admin badge, optional
// late/no-show indicator pulled from `arrivals` map.
//
// Tap → PlayerCard.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  RouteProp,
  useFocusEffect,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { PlayerIdentity } from '@/components/PlayerIdentity';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { gameService } from '@/services/gameService';
import { useGameStore } from '@/store/gameStore';
import { useGroupStore } from '@/store/groupStore';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { ArrivalStatus, Game, GameGuest, User, UserId } from '@/types';
import type { GameStackParamList } from '@/navigation/GameStack';

type Nav = NativeStackNavigationProp<GameStackParamList, 'MatchPlayers'>;
type Params = RouteProp<GameStackParamList, 'MatchPlayers'>;

interface RosterEntry {
  user: Pick<User, 'id' | 'name' | 'jersey'>;
  isAdmin: boolean;
  arrival?: ArrivalStatus;
}

export function MatchPlayersScreen() {
  const nav = useNavigation<Nav>();
  const { gameId } = useRoute<Params>().params;

  const playersMap = useGameStore((s) => s.players);
  const hydratePlayers = useGameStore((s) => s.hydratePlayers);
  const groups = useGroupStore((s) => s.groups);

  const [game, setGame] = useState<Game | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!gameId) {
      setGame(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const g = await gameService.getGameById(gameId);
      setGame(g);
      if (g) {
        const uids = Array.from(
          new Set([...g.players, ...g.waitlist, ...(g.pending ?? [])]),
        );
        if (uids.length > 0) hydratePlayers(uids);
      }
    } catch {
      setGame(null);
    } finally {
      setLoading(false);
    }
  }, [gameId, hydratePlayers]);

  useEffect(() => {
    reload();
  }, [reload]);
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  // Resolve admin set for this game's group so we can flag the
  // organizer/coaches in the roster.
  const adminIds = useMemo(() => {
    if (!game) return new Set<string>();
    const g = groups.find((x) => x.id === game.groupId);
    return new Set<string>(g?.adminIds ?? []);
  }, [game, groups]);

  const buildEntries = useCallback(
    (uids: string[]): RosterEntry[] => {
      return uids.map((uid) => {
        const p = playersMap[uid];
        return {
          user: { id: uid, name: p?.displayName ?? '...', jersey: p?.jersey },
          isAdmin: adminIds.has(uid),
          arrival: game?.arrivals?.[uid],
        };
      });
    },
    [playersMap, adminIds, game?.arrivals],
  );

  if (loading && !game) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.matchPlayersScreenTitle} />
        <View style={styles.center}>
          <SoccerBallLoader size={40} />
        </View>
      </SafeAreaView>
    );
  }
  if (!game) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.matchPlayersScreenTitle} />
        <View style={styles.center}>
          <Text style={styles.emptyText}>{he.matchDetailsNotFound}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const playerEntries = buildEntries(game.players ?? []);
  const waitlistEntries = buildEntries(game.waitlist ?? []);
  const pendingEntries = buildEntries(game.pending ?? []);
  const guests = game.guests ?? [];

  const goToCard = (uid: string) =>
    (nav as { navigate: (s: string, p: unknown) => void }).navigate(
      'PlayerCard',
      { userId: uid, groupId: game.groupId },
    );

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.matchPlayersScreenTitle} />
      <ScrollView contentContainerStyle={styles.content}>
        <Section
          title={he.matchPlayersSectionRegistered}
          count={`${playerEntries.length}/${game.maxPlayers}`}
        >
          {playerEntries.length === 0 ? (
            <Empty />
          ) : (
            <Card style={styles.listCard}>
              {playerEntries.map((e, i) => (
                <PlayerRow
                  key={e.user.id}
                  entry={e}
                  showDivider={i > 0}
                  onPress={() => goToCard(e.user.id)}
                />
              ))}
            </Card>
          )}
        </Section>

        {waitlistEntries.length > 0 ? (
          <Section
            title={he.matchPlayersSectionWaitlist}
            count={String(waitlistEntries.length)}
          >
            <Card style={styles.listCard}>
              {waitlistEntries.map((e, i) => (
                <PlayerRow
                  key={e.user.id}
                  entry={e}
                  showDivider={i > 0}
                  onPress={() => goToCard(e.user.id)}
                  toneRight={he.matchPlayersWaitlistTag}
                />
              ))}
            </Card>
          </Section>
        ) : null}

        {pendingEntries.length > 0 ? (
          <Section
            title={he.matchPlayersSectionPending}
            count={String(pendingEntries.length)}
          >
            <Card style={styles.listCard}>
              {pendingEntries.map((e, i) => (
                <PlayerRow
                  key={e.user.id}
                  entry={e}
                  showDivider={i > 0}
                  onPress={() => goToCard(e.user.id)}
                  toneRight={he.matchPlayersPendingTag}
                />
              ))}
            </Card>
          </Section>
        ) : null}

        {guests.length > 0 ? (
          <Section
            title={he.matchPlayersSectionGuests}
            count={String(guests.length)}
          >
            <Card style={styles.listCard}>
              {guests.map((g, i) => (
                <GuestRow key={g.id} guest={g} showDivider={i > 0} />
              ))}
            </Card>
          </Section>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>
        {title}
        {count ? <Text style={styles.sectionCount}> ({count})</Text> : null}
      </Text>
      {children}
    </View>
  );
}

function Empty() {
  return <Text style={styles.emptyText}>{he.matchPlayersEmpty}</Text>;
}

function PlayerRow({
  entry,
  showDivider,
  onPress,
  toneRight,
}: {
  entry: RosterEntry;
  showDivider: boolean;
  onPress: () => void;
  toneRight?: string;
}) {
  const { user, isAdmin, arrival } = entry;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        showDivider && styles.rowDivider,
        pressed && { backgroundColor: colors.surfaceMuted },
      ]}
      accessibilityRole="button"
      accessibilityLabel={user.name}
    >
      <PlayerIdentity user={user} size="sm" />
      <View style={styles.rowBody}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {user.name}
          </Text>
          {isAdmin ? <Tag label={he.matchPlayersAdminTag} tone="primary" /> : null}
        </View>
        {arrival === 'late' ? (
          <Tag label={he.matchPlayersLateTag} tone="warning" inline />
        ) : arrival === 'no_show' ? (
          <Tag label={he.matchPlayersNoShowTag} tone="danger" inline />
        ) : null}
      </View>
      {toneRight ? (
        <Text style={styles.toneRight} numberOfLines={1}>
          {toneRight}
        </Text>
      ) : null}
      <Ionicons name="chevron-back" size={16} color={colors.textMuted} />
    </Pressable>
  );
}

function GuestRow({ guest, showDivider }: { guest: GameGuest; showDivider: boolean }) {
  return (
    <View style={[styles.row, showDivider && styles.rowDivider]}>
      <View style={styles.guestAvatar}>
        <Ionicons name="person" size={18} color={colors.textMuted} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.name} numberOfLines={1}>
          {guest.name}
        </Text>
        <Text style={styles.guestSub}>{he.matchPlayersGuestTag}</Text>
      </View>
    </View>
  );
}

function Tag({
  label,
  tone,
  inline,
}: {
  label: string;
  tone: 'primary' | 'warning' | 'danger';
  inline?: boolean;
}) {
  const palette =
    tone === 'primary'
      ? { bg: colors.primaryLight, fg: colors.primary }
      : tone === 'warning'
        ? { bg: '#FEF3C7', fg: '#B45309' }
        : { bg: '#FEE2E2', fg: colors.danger };
  return (
    <View
      style={[
        styles.tag,
        { backgroundColor: palette.bg },
        inline && { alignSelf: 'flex-start', marginTop: 2 },
      ]}
    >
      <Text style={[styles.tagText, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xl,
  },
  section: { gap: spacing.sm },
  sectionTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  sectionCount: {
    color: colors.textMuted,
    fontWeight: '500',
    fontSize: 14,
  },
  listCard: { padding: 0, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  rowBody: { flex: 1, gap: 4 },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  name: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
    flexShrink: 1,
  },
  toneRight: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
  },
  guestAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guestSub: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  tagText: {
    ...typography.caption,
    fontWeight: '700',
    fontSize: 11,
  },
  emptyText: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
