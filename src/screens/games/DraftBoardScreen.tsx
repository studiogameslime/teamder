// DraftBoardScreen — Step 2 of חלוקת כוחות (the heart of the feature).
//
// Captains pick players in turns. Tapping an available player assigns them
// to the team whose turn it is and auto-advances — no confirm button. The
// top shows whose turn it is + the pick path; teams are horizontal cards
// (so 2–4 never get cramped); available players are a clean photo+name
// list. When everyone is placed it flips to a summary with "סיים".

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
import { appAlert } from '@/components/AppDialog';
import { DraftOrderPath } from '@/components/draft/DraftOrderPath';
import { DraftTeamCard } from '@/components/draft/DraftTeamCard';
import { useGameStore } from '@/store/gameStore';
import { useUserStore } from '@/store/userStore';
import { gameService } from '@/services';
import { logError } from '@/services/errorLog';
import { colors, radius, spacing, typography, shadows } from '@/theme';
import { he } from '@/i18n/he';
import type { DraftTeamsResult, Game } from '@/types';
import { buildPickOrder, teamLetter } from '@/utils/draft';
import type { GameStackParamList } from '@/navigation/GameStack';

type Nav = NativeStackNavigationProp<GameStackParamList>;
type Params = RouteProp<GameStackParamList, 'DraftBoard'>;

const TEAM_CARD_WIDTH = 230;

export function DraftBoardScreen() {
  const nav = useNavigation<Nav>();
  const { gameId, captainIds, method } = useRoute<Params>().params;

  const playersMap = useGameStore((s) => s.players);
  const hydratePlayers = useGameStore((s) => s.hydratePlayers);
  const currentUser = useUserStore((s) => s.currentUser);

  const [game, setGame] = useState<Game | null>(null);
  /** uids in the order they were picked; team = order[k]. Captains excluded. */
  const [picks, setPicks] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const g = await gameService.getGameById(gameId);
        if (!alive) return;
        setGame(g);
        if (g?.players?.length) hydratePlayers(g.players);
      } catch (err) {
        logError('draftBoardLoad', err, { gameId });
      }
    })();
    return () => {
      alive = false;
    };
  }, [gameId, hydratePlayers]);

  const resolve = useCallback(
    (uid: string) => {
      const p = playersMap[uid];
      return {
        id: uid,
        name: p?.displayName ?? '…',
        avatarId: p?.avatarId,
        photoUrl: p?.photoUrl,
      };
    },
    [playersMap],
  );

  const numTeams = captainIds.length;
  const draftable = useMemo(
    () => (game?.players ?? []).filter((p) => !captainIds.includes(p)),
    [game?.players, captainIds],
  );
  const order = useMemo(
    () => buildPickOrder(numTeams, draftable.length, method),
    [numTeams, draftable.length, method],
  );

  const assigned = useMemo(() => new Set(picks), [picks]);
  const pickIndex = picks.length;
  const done = order.length > 0 && pickIndex >= order.length;
  const currentTeam = done ? null : order[pickIndex] ?? 0;

  const available = useMemo(
    () => draftable.filter((p) => !assigned.has(p)),
    [draftable, assigned],
  );

  /** Drafted member uids for a given team, in pick order. */
  const membersOf = useCallback(
    (team: number) => picks.filter((_, k) => order[k] === team),
    [picks, order],
  );

  const pick = useCallback(
    (uid: string) => {
      if (done) return;
      setPicks((prev) => [...prev, uid]);
    },
    [done],
  );

  const undo = useCallback(() => {
    setPicks((prev) => prev.slice(0, -1));
  }, []);

  const finish = useCallback(async () => {
    if (!currentUser) return;
    const result: DraftTeamsResult = {
      method,
      numTeams,
      createdAt: Date.now(),
      createdBy: currentUser.id,
      teams: Array.from({ length: numTeams }, (_, t) => ({
        index: t,
        captainId: captainIds[t],
        playerIds: [captainIds[t], ...membersOf(t)],
      })),
    };
    setSaving(true);
    try {
      await gameService.saveDraftTeams(gameId, result);
      appAlert(he.draftTitle, he.draftSaved);
      nav.navigate('MatchDetails', { gameId });
    } catch (err) {
      logError('draftSave', err, { gameId });
      appAlert(he.draftTitle, he.draftSaveError);
    } finally {
      setSaving(false);
    }
  }, [currentUser, method, numTeams, captainIds, membersOf, gameId, nav]);

  // ── Summary view ────────────────────────────────────────────────────
  if (done) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.draftTitle} />
        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.summaryHead}>
            <View style={styles.summaryIcon}>
              <Ionicons name="trophy" size={26} color={colors.primary} />
            </View>
            <Text style={styles.summaryTitle}>{he.draftSummaryTitle}</Text>
            <Text style={styles.summarySub}>{he.draftSummarySubtitle}</Text>
          </View>
          <View style={styles.summaryList}>
            {Array.from({ length: numTeams }, (_, t) => (
              <DraftTeamCard
                key={t}
                index={t}
                captain={resolve(captainIds[t])}
                members={membersOf(t).map(resolve)}
              />
            ))}
          </View>
        </ScrollView>
        <View style={styles.footer}>
          <Button
            title={he.draftFinish}
            onPress={finish}
            loading={saving}
            fullWidth
            size="lg"
            iconLeft="checkmark-circle"
          />
        </View>
      </SafeAreaView>
    );
  }

  // ── Draft board ─────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader
        title={he.draftTitle}
        actions={
          pickIndex > 0
            ? [{ icon: 'arrow-undo-outline', onPress: undo, label: he.draftUndo }]
            : undefined
        }
      />
      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.stepChip}>
          <Text style={styles.stepText}>{he.draftStepLabel(2, 2)}</Text>
        </View>

        {/* Whose turn */}
        <Text style={styles.turn}>
          {he.draftBoardTurn(teamLetter(currentTeam ?? 0))}
        </Text>
        <View style={styles.pathWrap}>
          <DraftOrderPath order={order} activeIndex={pickIndex} />
        </View>

        {/* Teams — horizontal cards */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.teamsRow}
        >
          {Array.from({ length: numTeams }, (_, t) => (
            <DraftTeamCard
              key={t}
              index={t}
              captain={resolve(captainIds[t])}
              members={membersOf(t).map(resolve)}
              highlight={currentTeam === t}
              width={TEAM_CARD_WIDTH}
            />
          ))}
        </ScrollView>

        {/* Available players */}
        <Text style={styles.availTitle}>{he.draftAvailableTitle}</Text>
        <View style={styles.availList}>
          {available.map((uid) => {
            const u = resolve(uid);
            return (
              <View key={uid} style={styles.availRow}>
                <UserAvatar user={u} size={42} />
                <Text style={styles.availName} numberOfLines={1}>
                  {u.name}
                </Text>
                <PressableScale style={styles.pickBtn} onPress={() => pick(uid)}>
                  <Text style={styles.pickBtnText}>{he.draftPick}</Text>
                </PressableScale>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
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
    marginBottom: spacing.md,
  },
  stepText: { ...typography.caption, color: colors.textMuted, fontWeight: '700' },
  turn: {
    ...typography.h3,
    color: colors.primary,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  pathWrap: { marginBottom: spacing.lg },
  teamsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.sm,
  },
  availTitle: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    textAlign: 'right',
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  availList: { gap: spacing.xs },
  availRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  availName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    flex: 1,
    textAlign: 'right',
  },
  pickBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  pickBtnText: { ...typography.button, color: '#FFFFFF', fontWeight: '800' },
  // summary
  summaryHead: { alignItems: 'center', marginBottom: spacing.lg },
  summaryIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  summaryTitle: {
    ...typography.h2,
    color: colors.text,
    fontWeight: '800',
    textAlign: 'center',
  },
  summarySub: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 2,
  },
  summaryList: { gap: spacing.md },
  footer: {
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    backgroundColor: colors.surface,
  },
});
