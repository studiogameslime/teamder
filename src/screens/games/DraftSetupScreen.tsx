// DraftSetupScreen — Step 1 of חלוקת כוחות.
//
// The manager taps players to mark them captains (selection ORDER sets the
// team order: 1st captain → קבוצה א, 2nd → ב, …), then picks the draft
// order (snake / regular). "המשך" carries the captain ids + method to the
// draft board. Fully dynamic for 2–4 teams.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/PressableScale';
import { UserAvatar } from '@/components/UserAvatar';
import { Button } from '@/components/Button';
import { DraftOrderPath } from '@/components/draft/DraftOrderPath';
import { useGameStore } from '@/store/gameStore';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { gameService } from '@/services';
import { toast } from '@/components/Toast';
import { logError } from '@/services/errorLog';
import { colors, radius, spacing, typography, shadows } from '@/theme';
import { he } from '@/i18n/he';
import type { Game } from '@/types';
import {
  previewPath,
  MIN_TEAMS,
  MAX_TEAMS,
  type DraftMethod,
} from '@/utils/draft';
import type { GameStackParamList } from '@/navigation/GameStack';

type Nav = NativeStackNavigationProp<GameStackParamList>;
type Params = RouteProp<GameStackParamList, 'DraftSetup'>;

export function DraftSetupScreen() {
  const nav = useNavigation<Nav>();
  const { gameId } = useRoute<Params>().params;

  const playersMap = useGameStore((s) => s.players);
  const hydratePlayers = useGameStore((s) => s.hydratePlayers);
  const currentUser = useUserStore((s) => s.currentUser);
  const myCommunities = useGroupStore((s) => s.groups);

  const [game, setGame] = useState<Game | null>(null);
  const [captainIds, setCaptainIds] = useState<string[]>([]);
  // No default: the manager MUST actively pick an order. With a pre-selected
  // default they often hit "המשך" without ever scrolling to the order options
  // below a long captain list. Null → "המשך" stays disabled until chosen.
  const [method, setMethod] = useState<DraftMethod | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const g = await gameService.getGameById(gameId);
        if (!alive) return;
        // Teams (כוחות) are a manager-only action. Guard the screen itself
        // — not just the menu entry — so a non-manager who reaches it via a
        // stale nav state or deep link is bounced out instead of editing.
        if (g) {
          const grp = myCommunities.find((c) => c.id === g.groupId);
          const isAdmin =
            !!currentUser &&
            (g.createdBy === currentUser.id ||
              (!!grp && grp.adminIds.includes(currentUser.id)));
          if (!isAdmin) {
            toast.info(he.draftAdminOnly);
            if (nav.canGoBack()) nav.goBack();
            return;
          }
        }
        setGame(g);
        if (g?.players?.length) hydratePlayers(g.players);
      } catch (err) {
        logError('draftSetupLoad', err, { gameId });
      }
    })();
    return () => {
      alive = false;
    };
  }, [gameId, hydratePlayers, currentUser, myCommunities, nav]);

  // Draftable roster = registered players (uid → name/avatar from the
  // store) PLUS per-game guests (name only; avatar falls back to a
  // deterministic disc from the guest id).
  const participants = useMemo<
    { id: string; name: string; avatarId?: string; photoUrl?: string }[]
  >(() => {
    if (!game) return [];
    const players = (game.players ?? []).map((uid) => {
      const p = playersMap[uid];
      return {
        id: uid,
        name: p?.displayName ?? '…',
        avatarId: p?.avatarId,
        photoUrl: p?.photoUrl,
      };
    });
    const guests = (game.guests ?? []).map((g) => ({ id: g.id, name: g.name }));
    return [...players, ...guests];
  }, [game, playersMap]);

  const toggleCaptain = useCallback((uid: string) => {
    setCaptainIds((prev) =>
      prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid],
    );
  }, []);

  const numTeams = captainIds.length;
  const previewTeams = Math.min(MAX_TEAMS, Math.max(MIN_TEAMS, numTeams || MIN_TEAMS));

  // Validation: 2–4 captains, and at least one non-captain to draft.
  const tooFew = numTeams < MIN_TEAMS;
  const tooMany = numTeams > MAX_TEAMS;
  const noPlayersLeft = numTeams >= participants.length && participants.length > 0;
  const captainsOk = !tooFew && !tooMany && !noPlayersLeft;
  const canContinue = captainsOk && method !== null;

  const hint = tooMany
    ? he.draftTooManyCaptains
    : noPlayersLeft
      ? he.draftNotEnoughPlayers
      : tooFew
        ? he.draftNeedCaptains
        : method === null
          ? he.draftChooseOrder
          : null;

  const onContinue = () => {
    if (!canContinue || !method) return;
    nav.navigate('DraftBoard', { gameId, captainIds, method });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.draftTitle} />
      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.stepChip}>
          <Text style={styles.stepText}>{he.draftStepLabel(1, 2)}</Text>
        </View>
        <Text style={styles.sectionTitle}>{he.draftSetupSubtitle}</Text>

        {/* Players — tap to toggle captain */}
        <View style={styles.list}>
          {participants.map((u) => {
            const capIndex = captainIds.indexOf(u.id);
            const isCap = capIndex >= 0;
            return (
              <PressableScale
                key={u.id}
                onPress={() => toggleCaptain(u.id)}
                style={[styles.playerRow, isCap && styles.playerRowActive]}
              >
                {/* PressableScale puts children inside a single Animated.View
                    (no flexDirection) — so the row layout MUST live on this
                    inner wrapper, not on the PressableScale style. */}
                <View style={styles.playerRowInner}>
                  {/* Identity grouped on the right (avatar · name · קפטן);
                      the select check sits alone on the left. */}
                  <View style={styles.playerIdentity}>
                    <UserAvatar user={u} size={44} />
                    <Text style={styles.playerName} numberOfLines={1}>
                      {u.name}
                    </Text>
                    {isCap ? (
                      <View style={styles.capBadge}>
                        <Ionicons name="shield-checkmark" size={13} color={colors.primary} />
                        <Text style={styles.capBadgeText}>{he.draftCaptainBadge}</Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={[styles.check, isCap && styles.checkOn]}>
                    {isCap ? (
                      <Ionicons name="checkmark" size={18} color="#FFFFFF" />
                    ) : null}
                  </View>
                </View>
              </PressableScale>
            );
          })}
          {participants.length === 0 ? (
            <Text style={styles.emptyHint}>{he.draftNotEnoughPlayers}</Text>
          ) : null}
        </View>

        {/* Draft order */}
        <Text style={[styles.sectionTitle, styles.orderTitle]}>
          {he.draftOrderTitle}
        </Text>
        <Text style={styles.orderSubtitle}>{he.draftOrderSubtitle}</Text>

        <OrderOption
          selected={method === 'snake'}
          onPress={() => setMethod('snake')}
          order={previewPath(previewTeams, 'snake')}
          recommended
        />
        <OrderOption
          selected={method === 'regular'}
          onPress={() => setMethod('regular')}
          order={previewPath(previewTeams, 'regular')}
        />

        {/* Teams-to-create info */}
        <View style={styles.teamsInfo}>
          <Ionicons name="people" size={18} color={colors.primary} />
          <Text style={styles.teamsInfoText}>
            {he.draftTeamsToCreate(numTeams || MIN_TEAMS)}
          </Text>
        </View>

      </ScrollView>

      {/* Sticky CTA. The hint lives HERE (not in the scroll) so the reason
          "המשך" is disabled — including "בחרו סדר הגרלה" — is always visible
          and nudges the manager to scroll down to the order options. */}
      <View style={styles.footer}>
        {hint ? <Text style={styles.footerHint}>{hint}</Text> : null}
        <Button
          title={he.draftContinue}
          onPress={onContinue}
          disabled={!canContinue}
          fullWidth
          size="lg"
        />
      </View>
    </SafeAreaView>
  );
}

function OrderOption({
  selected,
  onPress,
  order,
  recommended,
}: {
  selected: boolean;
  onPress: () => void;
  order: number[];
  recommended?: boolean;
}) {
  return (
    <PressableScale
      onPress={onPress}
      style={[styles.option, selected && styles.optionActive]}
    >
      <View style={styles.optionInner}>
        <View style={styles.optionBody}>
          {/* Fixed-height line reserved on BOTH options (badge or empty) so
              the two cards stay exactly the same height. */}
          <View style={styles.badgeLine}>
            {recommended ? (
              <View style={styles.recBadge}>
                <Ionicons name="star" size={11} color="#FFFFFF" />
                <Text style={styles.recBadgeText}>{he.draftRecommended}</Text>
              </View>
            ) : null}
          </View>
          <DraftOrderPath order={order} compact />
        </View>
        <View style={[styles.radio, selected && styles.radioOn]}>
          {selected ? <View style={styles.radioDot} /> : null}
        </View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  stepChip: {
    alignSelf: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    marginBottom: spacing.sm,
  },
  stepText: { ...typography.caption, color: colors.textMuted, fontWeight: '700' },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  list: { gap: spacing.sm },
  playerRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    ...shadows.card,
  },
  playerRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  playerIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flexShrink: 1,
  },
  playerRowActive: { borderColor: colors.primary },
  playerName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'right',
  },
  capBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  capBadgeText: { ...typography.caption, color: colors.primary, fontWeight: '800' },
  check: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  emptyHint: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  orderTitle: { marginTop: spacing.xxl },
  orderSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  option: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  optionInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  optionActive: { borderColor: colors.primary },
  optionBody: { flex: 1 },
  // Reserved top line (same height on both cards) that holds the מומלץ
  // badge on the right — keeps the two options exactly the same height.
  badgeLine: {
    height: 22,
    flexDirection: 'row',
    justifyContent: 'flex-start', // right under RTL
    marginBottom: spacing.sm,
  },
  recBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  recBadgeText: { ...typography.caption, color: '#FFFFFF', fontWeight: '800' },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: colors.primary },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
  teamsInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  teamsInfoText: { ...typography.body, color: colors.primary, fontWeight: '800' },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  footer: {
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    backgroundColor: colors.surface,
  },
  footerHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
});
