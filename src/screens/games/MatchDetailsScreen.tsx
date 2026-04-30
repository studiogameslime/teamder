// MatchDetailsScreen — read-mostly view of a single match.
//
// Five vertical bands, all left-aligned to the same 16dp gutter:
//
//   ① Header — large title, sub-line (📅 date · time + 📍 location),
//      hairline divider beneath.
//   ② Info grid — symmetric 2×2: format / players / surface / duration.
//   ③ Players — clean rows (avatar + name + status badge for guest /
//      admin) with subtle dividers, NOT pill buttons.
//   ④ Manage row — admin-only secondary link (organizer / coach).
//   ⑤ Sticky bottom CTA — outline-only red for cancel, full pill green
//      for join.

import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
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
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { PlayerIdentity } from '@/components/PlayerIdentity';
import { GuestModal } from '@/components/GuestModal';
import { ConfirmDestructiveModal } from '@/components/ConfirmDestructiveModal';
import { toast } from '@/components/Toast';
import { gameService } from '@/services/gameService';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { Game, GameFormat, FieldType, UserId } from '@/types';
import { colors, shadows, spacing } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { useGameStore } from '@/store/gameStore';
import type { GameStackParamList } from '@/navigation/GameStack';

type Nav = NativeStackNavigationProp<GameStackParamList, 'MatchDetails'>;
type Params = RouteProp<GameStackParamList, 'MatchDetails'>;

type CardStatus = 'joined' | 'waitlist' | 'pending' | 'none';

function statusForUser(g: Game, uid: UserId): CardStatus {
  if (g.players.includes(uid)) return 'joined';
  if (g.waitlist.includes(uid)) return 'waitlist';
  if ((g.pending ?? []).includes(uid)) return 'pending';
  return 'none';
}

function formatDateLong(ms: number): string {
  const d = new Date(ms);
  const days = [
    'יום ראשון',
    'יום שני',
    'יום שלישי',
    'יום רביעי',
    'יום חמישי',
    'יום שישי',
    'שבת',
  ];
  const day = days[d.getDay()];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mn = String(d.getMinutes()).padStart(2, '0');
  return `${day} · ${dd}/${mm} · ${hh}:${mn}`;
}

function formatLabel(f: GameFormat | undefined): string | null {
  if (f === '5v5') return he.gameFormat5;
  if (f === '6v6') return he.gameFormat6;
  if (f === '7v7') return he.gameFormat7;
  return null;
}

function fieldTypeLabel(f: FieldType): string {
  if (f === 'asphalt') return he.fieldTypeAsphalt;
  if (f === 'synthetic') return he.fieldTypeSynthetic;
  return he.fieldTypeGrass;
}

export function MatchDetailsScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Params>();
  const gameId = route.params.gameId;
  const user = useUserStore((s) => s.currentUser);
  const myCommunities = useGroupStore((s) => s.groups);
  const hydratePlayers = useGameStore((s) => s.hydratePlayers);
  const playersMap = useGameStore((s) => s.players);

  const [game, setGame] = useState<Game | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [guestModalOpen, setGuestModalOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const reload = React.useCallback(async () => {
    setLoading(true);
    try {
      const g = await gameService.getGameById(gameId);
      setGame(g);
      if (g) {
        logEvent(AnalyticsEvent.GameViewed, { gameId: g.id, status: g.status });
        const uids = Array.from(
          new Set([...g.players, ...g.waitlist, ...(g.pending ?? [])]),
        );
        if (uids.length > 0) hydratePlayers(uids);
      }
    } catch (err) {
      if (__DEV__) console.warn('[matchDetails] reload failed', err);
    } finally {
      setLoading(false);
    }
  }, [gameId, hydratePlayers]);

  useEffect(() => {
    reload();
  }, [reload]);
  useFocusEffect(
    React.useCallback(() => {
      reload();
    }, [reload]),
  );

  const isAdmin = useMemo(() => {
    if (!user || !game) return false;
    if (game.createdBy === user.id) return true;
    const grp = myCommunities.find((c) => c.id === game.groupId);
    return !!grp && grp.adminIds.includes(user.id);
  }, [user, game, myCommunities]);

  const adminUids = useMemo(() => {
    if (!game) return new Set<string>();
    const ids = new Set<string>();
    if (game.createdBy) ids.add(game.createdBy);
    const grp = myCommunities.find((c) => c.id === game.groupId);
    grp?.adminIds.forEach((id) => ids.add(id));
    return ids;
  }, [game, myCommunities]);

  const handlePrimary = async () => {
    if (!user || !game) return;
    const status = statusForUser(game, user.id);
    setBusy(true);
    try {
      if (status === 'joined' || status === 'waitlist' || status === 'pending') {
        await gameService.cancelGameV2(game.id, user.id);
      } else {
        await gameService.joinGameV2(game.id, user.id);
      }
      await reload();
    } catch (err) {
      if (__DEV__) console.warn('[matchDetails] primary failed', err);
    } finally {
      setBusy(false);
    }
  };

  if (loading || !game) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.matchDetailsTitle} />
        <View style={styles.center}>
          <SoccerBallLoader size={48} />
        </View>
      </SafeAreaView>
    );
  }

  const status = user ? statusForUser(game, user.id) : 'none';
  const fmt = formatLabel(game.format);
  // Capacity tracks BOTH registered uids and per-game guests — a guest
  // is a real seat at the match, just without a /users record.
  const guestCount = (game.guests ?? []).length;
  const totalParticipants = game.players.length + guestCount;
  const isFull = totalParticipants >= game.maxPlayers;

  const primaryDestructive =
    status === 'joined' || status === 'waitlist' || status === 'pending';

  const primaryLabel = (() => {
    if (primaryDestructive) return he.matchDetailsCancel;
    if (isFull && !game.requiresApproval) return he.gameStatusWaitlist;
    if (game.requiresApproval) return he.gameCardRequestJoin;
    return he.matchDetailsJoin;
  })();

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader
        title={he.matchDetailsTitle}
        actions={
          isAdmin
            ? [
                {
                  icon: 'create-outline',
                  onPress: () => nav.navigate('GameEdit', { gameId: game.id }),
                  label: he.matchDetailsEdit,
                },
              ]
            : undefined
        }
      />

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={reload}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* ① HEADER */}
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            <Text style={styles.heroTitle} numberOfLines={2}>
              {game.title}
            </Text>
            <HeroStatusBadge status={status} game={game} />
          </View>
          <View style={styles.headerSub}>
            {/* Mirrors MatchCard's infoLine pattern: a full-width
                space-between row with the content atom on the RIGHT
                and an empty placeholder pushing it there. The atom
                itself is content-sized (icon + text, no flex). */}
            <View style={styles.subLine}>
              <View style={styles.subRow}>
                <Ionicons
                  name="calendar-outline"
                  size={14}
                  color={colors.textMuted}
                  style={styles.subIcon}
                />
                <Text style={styles.subText}>{formatDateLong(game.startsAt)}</Text>
              </View>
              <View />
            </View>
            <View style={styles.subLine}>
              <View style={styles.subRow}>
                <Ionicons
                  name="location-outline"
                  size={14}
                  color={colors.textMuted}
                  style={styles.subIcon}
                />
                <Text style={styles.subText} numberOfLines={1}>
                  {game.fieldName}
                </Text>
              </View>
              <View />
            </View>
          </View>
          <View style={styles.divider} />
        </View>

        {/* ② INFO GRID — strict 2×2 */}
        <View style={styles.infoGrid}>
          <InfoCell
            icon="football-outline"
            label={he.matchDetailsFormat}
            value={fmt ?? '—'}
          />
          <InfoCell
            icon="people-outline"
            label={he.matchDetailsPlayers}
            value={`${totalParticipants}/${game.maxPlayers}`}
          />
          <InfoCell
            icon="leaf-outline"
            label={he.matchDetailsField}
            value={game.fieldType ? fieldTypeLabel(game.fieldType) : '—'}
          />
          <InfoCell
            icon="time-outline"
            label={he.matchDetailsDuration}
            value={
              game.matchDurationMinutes
                ? `${game.matchDurationMinutes} ${he.minutesShort}`
                : '—'
            }
          />
        </View>

        {/* ③ PLAYERS */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            {he.matchDetailsPlayers}{' '}
            <Text style={styles.sectionCount}>
              ({totalParticipants}/{game.maxPlayers})
            </Text>
          </Text>
          {isAdmin ? (
            <Pressable
              onPress={() => setGuestModalOpen(true)}
              hitSlop={6}
              style={({ pressed }) => [
                styles.addGuestBtn,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Ionicons name="add" size={16} color={colors.primary} />
              <Text style={styles.addGuestText}>{he.matchDetailsAddGuest}</Text>
            </Pressable>
          ) : null}
        </View>

        {game.players.length === 0 && (game.guests ?? []).length === 0 ? (
          <Text style={styles.emptyText}>{he.gameCardMissing(game.maxPlayers)}</Text>
        ) : (
          <Card style={styles.playersCard}>
            {game.players.map((uid, i) => {
              const p = playersMap[uid];
              const name = p?.displayName ?? '...';
              const isOrganizer = adminUids.has(uid);
              const isLast =
                i === game.players.length - 1 && (game.guests ?? []).length === 0;
              return (
                <View
                  key={uid}
                  style={[styles.playerRow, !isLast && styles.playerRowDivider]}
                >
                  {/* Player row — RTL order:
                      SHIRT (right) → ROLE BADGE → NAME → ⚽ ball.
                      Badge sits between shirt and name so the role
                      pill reads as a label on the shirt itself, not
                      a trailing afterthought. */}
                  <PlayerIdentity
                    user={{ id: uid, name, jersey: p?.jersey }}
                    size={32}
                  />
                  {isOrganizer ? (
                    <Badge label={he.matchDetailsRoleAdmin} tone="info" size="sm" />
                  ) : null}
                  <Text style={styles.playerName} numberOfLines={1}>
                    {name}
                  </Text>
                  {game.ballHolderUserId === uid ? (
                    <Text style={styles.ballHolder}>⚽</Text>
                  ) : null}
                </View>
              );
            })}
            {(game.guests ?? []).map((g, i, arr) => {
              const isLast = i === arr.length - 1;
              return (
                <View
                  key={`guest:${g.id}`}
                  style={[styles.playerRow, !isLast && styles.playerRowDivider]}
                >
                  {/* Same RTL order as registered rows: SHIRT (right)
                      → "אורח" badge → NAME → trash (LEFT, admin-only).
                      Badge clings to the shirt; trash stays in its
                      own corner via `marginStart:'auto'`. */}
                  <PlayerIdentity user={{ id: `guest:${g.id}`, name: g.name }} size={32} />
                  <Badge label={he.guestBadge} tone="warning" size="sm" />
                  <Text style={styles.playerName} numberOfLines={1}>
                    {g.name}
                  </Text>
                  {isAdmin ? (
                    <Pressable
                      onPress={() =>
                        user &&
                        gameService
                          .removeGuest(game.id, user.id, g.id)
                          .then(() => reload())
                          .catch((err) => {
                            if (__DEV__)
                              console.warn('[matchDetails] removeGuest failed', err);
                          })
                      }
                      hitSlop={6}
                      style={({ pressed }) => [
                        styles.guestRemove,
                        styles.guestTrashAuto,
                        pressed && { opacity: 0.6 },
                      ]}
                    >
                      <Ionicons name="trash-outline" size={18} color="#DC2626" />
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </Card>
        )}

        {/* ④ MANAGE — admin only.
            JSX ordered for RTL flow: TEXT first (renders RIGHT),
            settings + chevron clustered on the LEFT. The text now
            says "עבור למצב לייב" — clearer call-to-action than the
            generic "ניהול משחק". */}
        {isAdmin ? (
          <Pressable
            onPress={() => nav.navigate('LiveMatch', { gameId: game.id })}
            style={({ pressed }) => [
              styles.manageRow,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={styles.manageText}>{he.matchDetailsGoLive}</Text>
            <View style={styles.manageIcons}>
              <Ionicons name="play-circle-outline" size={20} color={colors.primary} />
              <Ionicons name="chevron-back" size={16} color={colors.primary} />
            </View>
          </Pressable>
        ) : null}
      </ScrollView>

      {/* Guest modal — admin-only entry point. Reuses the same modal
          used by the LiveMatch screen so the form stays consistent. */}
      {user ? (
        <GuestModal
          visible={guestModalOpen}
          gameId={game.id}
          callerId={user.id}
          onClose={() => setGuestModalOpen(false)}
          onChanged={reload}
        />
      ) : null}

      <ConfirmDestructiveModal
        visible={deleteOpen}
        title={he.deleteGameTitle}
        body={he.deleteGameBody}
        onClose={() => setDeleteOpen(false)}
        onConfirm={async () => {
          try {
            await gameService.deleteGame(game.id);
            setDeleteOpen(false);
            toast.success(he.deleteGameSuccess);
            nav.goBack();
          } catch (err) {
            if (__DEV__) console.warn('[matchDetails] delete failed', err);
            toast.error(he.error);
          }
        }}
      />

      {/* ⑤ STICKY CTA — primary action + admin-only delete on the same row. */}
      <View style={[styles.cta, isAdmin && styles.ctaRow]}>
        <View style={{ flex: 1 }}>
          <Button
            title={primaryLabel}
            variant={primaryDestructive ? 'danger' : 'primary'}
            size="lg"
            fullWidth
            loading={busy}
            onPress={handlePrimary}
          />
        </View>
        {isAdmin ? (
          <View style={{ flex: 1 }}>
            <Button
              title={he.deleteGameTitle}
              variant="danger"
              size="lg"
              fullWidth
              iconLeft="trash-outline"
              onPress={() => setDeleteOpen(true)}
            />
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function HeroStatusBadge({ status, game }: { status: CardStatus; game: Game }) {
  if (status === 'joined')
    return <Badge label={he.matchStatusJoined} tone="primary" size="sm" />;
  if (status === 'waitlist')
    return <Badge label={he.matchStatusWaitlist} tone="warning" size="sm" />;
  if (status === 'pending')
    return <Badge label={he.matchStatusPending} tone="neutral" size="sm" />;
  if (game.players.length >= game.maxPlayers)
    return <Badge label={he.matchStatusFull} tone="neutral" size="sm" />;
  return <Badge label={he.matchStatusOpen} tone="primary" size="sm" />;
}

function InfoCell({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  // forceRTL flips `flexDirection: 'row'` to RTL flow, so the first
  // JSX child (the icon) ends up at the RIGHT edge of the cell. The
  // text block follows to its left and fills the remaining width
  // (flex:1). The 8px gap sits on the icon's physical LEFT — the
  // side facing the text — via `marginLeft`.
  return (
    <View style={styles.infoCell}>
      <Ionicons
        name={icon}
        size={18}
        color={colors.primary}
        style={styles.infoCellIcon}
      />
      <View style={styles.infoCellText}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: 110,
    gap: spacing.lg,
  },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ① Header
  header: {
    gap: spacing.sm,
  },
  // forceRTL flips `row` to RTL flow visually, so the first JSX child
  // (heroTitle) ends up on the RIGHT and the badge on the LEFT — that's
  // the correct Hebrew reading order. `row-reverse` in forceRTL would
  // flip BACK to LTR, which is the bug we were hitting.
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  heroTitle: {
    color: colors.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    textAlign: 'right',
    // `flexShrink:1` (NOT flex:1) lets a long match name truncate
    // gracefully without stealing the badge's slot on the LEFT corner.
    flexShrink: 1,
  },
  headerSub: {
    gap: 4,
  },
  // Wrapper line: full width, space-between pushes the atom to the
  // RIGHT and the empty placeholder View to the LEFT.
  subLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  subIcon: {
    // RTL-aware gap to text: `marginEnd` resolves to physical LEFT
    // under forceRTL, which is the side facing the text.
    marginEnd: 8,
  },
  subText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  divider: {
    height: 1,
    backgroundColor: colors.divider,
    marginTop: spacing.sm,
  },

  // ② Info grid
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  infoCell: {
    // `justifyContent:'flex-start'` packs both the icon AND the
    // text-block to the row's start (= RIGHT edge of the cell)
    // under forceRTL — labels/values glue right next to the icon
    // instead of stretching to the LEFT edge.
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    ...shadows.card,
  },
  infoCellText: {
    // `alignItems:'flex-start'` is the start of the cross-axis (horizontal
    // since the View defaults to column). Under forceRTL, start = RIGHT,
    // so each child Text packs to the RIGHT edge of the text block —
    // glued tight against the icon, not stranded center / left.
    alignItems: 'flex-start',
    flexShrink: 1,
  },
  infoCellIcon: {
    // RTL-aware gap to text block on icon's physical LEFT side.
    marginEnd: spacing.sm,
  },
  infoLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'right',
  },
  infoValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 2,
    textAlign: 'right',
  },

  // ③ Players
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'right',
  },
  sectionCount: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '500',
  },
  addGuestBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 999,
  },
  addGuestText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  guestRemove: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playersCard: {
    padding: 0,
    overflow: 'hidden',
  },
  playerRow: {
    // forceRTL auto-flips `row` → first JSX child (name) lands at the
    // RIGHT edge, last child (shirt) at the LEFT — proper Hebrew flow.
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  playerRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  playerName: {
    // Content-sized so the name + role badge cluster tight to the
    // shirt on the RIGHT. `flex:1` here was previously stretching the
    // name across the row and pushing the badge to the LEFT edge —
    // not what we want. `flexShrink:1` keeps long names truncatable.
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'right',
    flexShrink: 1,
  },
  guestTrashAuto: {
    // `marginStart:'auto'` pushes the trash icon to the END of the
    // flex direction (= LEFT corner of the row under forceRTL). Used
    // only on the guest-row trash so registered-player rows stay tight.
    marginStart: 'auto',
  },
  ballHolder: {
    fontSize: 16,
  },
  emptyText: {
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.xl,
    fontSize: 14,
  },

  // ④ Manage row (admin) — kept for legacy callers.
  manageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    ...shadows.card,
  },
  manageText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'right',
    flexShrink: 1,
  },
  manageIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },


  // ⑤ Sticky CTA
  cta: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  ctaRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
});
