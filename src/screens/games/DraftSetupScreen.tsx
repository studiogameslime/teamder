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
import { TeamsEditModal } from '@/components/match/TeamsEditModal';
import { useGameStore } from '@/store/gameStore';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { gameService } from '@/services';
import { toast } from '@/components/Toast';
import { logError } from '@/services/errorLog';
import { colors, radius, spacing, typography, shadows, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { toGuestRosterId, type Game } from '@/types';
import {
  previewPath,
  balanceTeams,
  MIN_TEAMS,
  MAX_TEAMS,
  type DraftMethod,
} from '@/utils/draft';
import { balanceTiming } from '@/components/anim/game/triggerLogic';
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
  // Step 0: which split METHOD. null = the method picker is showing.
  //   'auto'   → balanced by internal rating (internal-rating communities only)
  //   'manual' → the captain draft (the classic flow)
  //   'random' → random even split, no ratings
  const [splitMode, setSplitMode] = useState<'auto' | 'manual' | 'random' | null>(
    null,
  );
  // Team count for auto/random (the manual flow derives it from #captains).
  const [autoNumTeams, setAutoNumTeams] = useState(MIN_TEAMS);
  const [generating, setGenerating] = useState(false);
  // DnD "edit existing teams" modal (only when teams already exist).
  const [editOpen, setEditOpen] = useState(false);

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
        // Seed the auto/random team count from the game's configured
        // numberOfTeams (clamped to the supported range). Without this it stuck
        // at 2 unless the admin tapped a pill, so a 4-team game silently split
        // into 2 (B09).
        if (typeof g?.numberOfTeams === 'number') {
          setAutoNumTeams(
            Math.min(MAX_TEAMS, Math.max(MIN_TEAMS, g.numberOfTeams)),
          );
        }
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
    // Use the PREFIXED `guest:` roster id — the same id DraftBoard (and every
    // other surface) uses. With the raw id, a guest picked as captain didn't
    // match DraftBoard's prefixed roster: their name showed blank in the
    // captain slot AND they leaked back into the player pool (user report).
    const guests = (game.guests ?? []).map((g) => ({
      id: toGuestRosterId(g.id),
      name: g.name,
    }));
    return [...players, ...guests];
  }, [game, playersMap]);

  // Resolve any roster id (uid or guest:<id>) → display identity for the
  // DnD editor. Falls back to a placeholder while the store hydrates.
  const resolveRoster = useCallback(
    (id: string) => participants.find((p) => p.id === id) ?? { id, name: '…' },
    [participants],
  );
  const hasTeams = !!game?.draftTeams?.teams?.length;

  const toggleCaptain = useCallback((uid: string) => {
    setCaptainIds((prev) =>
      prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid],
    );
  }, []);

  const numTeams = captainIds.length;
  // The number of captains is fixed by the team count chosen at game creation
  // (user request) — pick exactly this many, one per team. Clamp to the
  // supported range as a guard for legacy/missing values.
  const expectedCaptains = Math.min(
    MAX_TEAMS,
    Math.max(MIN_TEAMS, game?.numberOfTeams ?? MIN_TEAMS),
  );
  const previewTeams = expectedCaptains;

  // Validation: exactly `expectedCaptains` captains, and at least one
  // non-captain left to draft.
  const tooFew = numTeams < expectedCaptains;
  const tooMany = numTeams > expectedCaptains;
  const noPlayersLeft = numTeams >= participants.length && participants.length > 0;
  const captainsOk = numTeams === expectedCaptains && !noPlayersLeft;
  const canContinue = captainsOk && method !== null;

  const hint = noPlayersLeft
    ? he.draftNotEnoughPlayers
    : tooFew || tooMany
      ? he.draftPickExactCaptains(expectedCaptains)
      : method === null
        ? he.draftChooseOrder
        : null;

  const onContinue = () => {
    if (!canContinue || !method) return;
    nav.navigate('DraftBoard', { gameId, captainIds, method });
  };

  // "אוטומטי לפי דירוג" only makes sense where the admins keep internal
  // ratings; elsewhere it would score everyone neutral (= random anyway).
  const internalRating =
    myCommunities.find((c) => c.id === game?.groupId)?.internalRating === true;
  // Each team needs ≥1 player → cap the offered count at the roster size.
  const maxTeams = Math.min(MAX_TEAMS, participants.length);

  // Run an auto (rating) or random split, save it, and land on the editable
  // draft summary so the admin can tweak before it's final.
  const runGenerate = useCallback(async () => {
    if (!game || !currentUser || generating) return;
    const grp = myCommunities.find((c) => c.id === game.groupId);
    const activeGuests = (game.guests ?? []).filter((gu) => !gu.waitlisted);
    const playerIds = [
      ...(game.players ?? []),
      ...activeGuests.map((gu) => toGuestRosterId(gu.id)),
    ];
    // 'random' → no ratings (balanceTeams shuffles + splits evenly).
    const ratings: Record<string, number> = {};
    if (splitMode === 'auto') {
      for (const uid of game.players ?? []) {
        const r = grp?.adminRatings?.[uid];
        if (typeof r === 'number' && r > 0) ratings[uid] = r;
      }
      for (const gu of activeGuests) {
        if (typeof gu.estimatedRating === 'number' && gu.estimatedRating > 0) {
          ratings[toGuestRosterId(gu.id)] = gu.estimatedRating;
        }
      }
    }
    setGenerating(true);
    try {
      const computeStart = Date.now();
      // Recent splits drive the "don't rebuild last week's teams" half of the
      // balance. A failure or an empty history is fine — the split then falls
      // back to rating alone. 'random' mode ignores ratings AND history: it is
      // meant to be a genuine draw.
      const history =
        splitMode === 'auto'
          ? await gameService.getRecentSplits(game.groupId, {
              excludeGameId: game.id,
            })
          : [];
      const { result, unratedCount } = balanceTeams({
        playerIds,
        ratings,
        numTeams: autoNumTeams,
        format: game.format,
        createdBy: currentUser.id,
        history,
      });
      // Auto/random balance is saved as a DRAFT (published:false) too — the
      // admin then reviews it in DraftBoard and publishes from MatchDetails.
      await gameService.saveDraftTeams(game.id, { ...result, published: false });
      // Anim 13 — the balance is computed locally (instant), so pad to a
      // minimal "computing" phase (spec floor ≥300ms) via the existing
      // `generating` loader, so the result never pops in. Capped, never padded
      // past the floor — the effect must not add real latency beyond that.
      const elapsed = Date.now() - computeStart;
      const floorMs = balanceTiming().minComputeMs;
      if (elapsed < floorMs) {
        await new Promise((r) => setTimeout(r, floorMs - elapsed));
      }
      if (splitMode === 'auto' && unratedCount > 0) {
        toast.info(he.autoBalanceUnrated(unratedCount));
      }
      nav.navigate('DraftBoard', {
        gameId: game.id,
        captainIds: result.teams.map((t) => t.captainId),
        method: 'snake',
        resume: true,
      });
    } catch (err) {
      logError('draftGenerate', err, { gameId: game.id, splitMode });
      toast.error(he.autoBalanceError);
    } finally {
      setGenerating(false);
    }
  }, [
    game,
    currentUser,
    generating,
    myCommunities,
    splitMode,
    autoNumTeams,
    nav,
  ]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.draftTitle} />
      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        {/* Step 0 — pick a split METHOD. */}
        {splitMode === null ? (
          <>
            {/* Teams already exist → offer a direct edit (drag-and-drop swap)
                above the "split again" methods. */}
            {hasTeams ? (
              <>
                <MethodCard
                  icon="git-compare"
                  title={he.draftEditExistingTitle}
                  subtitle={he.draftEditExistingSub}
                  onPress={() => setEditOpen(true)}
                />
                <Text style={styles.orHint}>{he.draftMethodTitle}</Text>
              </>
            ) : (
              <Text style={styles.sectionTitle}>{he.draftMethodTitle}</Text>
            )}
            {internalRating ? (
              <MethodCard
                icon="sparkles"
                title={he.draftMethodAuto}
                subtitle={he.draftMethodAutoSub}
                onPress={() => setSplitMode('auto')}
              />
            ) : null}
            <MethodCard
              icon="people"
              title={he.draftMethodManual}
              subtitle={he.draftMethodManualSub}
              onPress={() => setSplitMode('manual')}
            />
            <MethodCard
              icon="shuffle"
              title={he.draftMethodRandom}
              subtitle={he.draftMethodRandomSub}
              onPress={() => setSplitMode('random')}
            />
          </>
        ) : splitMode === 'manual' ? (
          <>
            <BackToMethods onPress={() => setSplitMode(null)} />
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
                    <View style={styles.playerRowInner}>
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
          </>
        ) : (
          /* auto / random — just pick how many teams */
          <>
            <BackToMethods onPress={() => setSplitMode(null)} />
            {/* No team-count picker — it's already set at game creation, so we
                split into exactly that many ("למה אני אמור לבחור... כבר קבעתי"). */}
            <View style={styles.teamsInfo}>
              <Ionicons name="people" size={18} color={colors.primary} />
              <Text style={styles.teamsInfoText}>
                {he.draftTeamsToCreate(autoNumTeams)}
              </Text>
            </View>
            <Text style={styles.autoHint}>
              {splitMode === 'auto'
                ? he.draftMethodAutoSub
                : he.draftMethodRandomSub}
            </Text>
          </>
        )}
      </ScrollView>

      {/* Sticky CTA — depends on the chosen method. The method picker itself
          has no footer (the cards are the action). */}
      {splitMode === 'manual' ? (
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
      ) : splitMode ? (
        <View style={styles.footer}>
          <Button
            title={he.draftGenerateCta}
            onPress={runGenerate}
            disabled={participants.length < MIN_TEAMS || generating}
            loading={generating}
            fullWidth
            size="lg"
          />
        </View>
      ) : null}

      {game ? (
        <TeamsEditModal
          visible={editOpen}
          game={game}
          resolve={resolveRoster}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            toast.success(he.draftSaved);
            nav.navigate('MatchDetails', { gameId });
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

/** A tappable card on the method picker. */
function MethodCard({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <PressableScale onPress={onPress} style={styles.methodCard}>
      <View style={styles.methodInner}>
        <View style={styles.methodIcon}>
          <Ionicons name={icon} size={22} color={colors.primary} />
        </View>
        <View style={styles.methodText}>
          <Text style={styles.methodTitle}>{title}</Text>
          <Text style={styles.methodSub}>{subtitle}</Text>
        </View>
        <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
      </View>
    </PressableScale>
  );
}

/** "‹ חזרה לבחירת שיטה" link shown above a chosen method's content. */
function BackToMethods({ onPress }: { onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} style={styles.backRow}>
      <Ionicons name="chevron-forward" size={18} color={colors.primary} />
      <Text style={styles.backText}>{he.draftMethodBack}</Text>
    </PressableScale>
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
  orHint: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: spacing.md,
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
    // The captain chip wraps below the name when there's no room, instead of
    // crushing the name to fit them both on one line.
    flexWrap: 'wrap',
  },
  playerRowActive: { borderColor: colors.primary },
  playerName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    // Never shrink the name — the captain chip wraps first.
    flexShrink: 0,
    maxWidth: '100%',
    textAlign: RTL_LABEL_ALIGN,
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
  // ── Method picker ──────────────────────────────────────────────────
  methodCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  methodInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  methodIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodText: { flex: 1, gap: 2 },
  methodTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  methodSub: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginBottom: spacing.md,
  },
  backText: { ...typography.caption, color: colors.primary, fontWeight: '800' },
  // ── Team-count pills (auto/random) ─────────────────────────────────
  countRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  countPill: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countPillOn: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  countPillText: { ...typography.h2, color: colors.text, fontWeight: '800' },
  countPillTextOn: { color: colors.primary },
  autoHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
