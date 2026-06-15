// RatePlayersScreen — rate the people you played with.
//
// Reached from the "דרג את חבריך מהמשחק" banner on a finished match.
// Lists the game's REGISTERED players (guests excluded — they have no
// account to rate, and `game.players` only holds real user ids) minus
// the viewer themselves. Each row shows the player's identity plus an
// inline 1–5 star row; tapping a star saves the vote immediately via
// `ratingsService.ratePlayer` (ratings are global per rater→rated pair,
// so no group scoping is needed). Tapping the active star again clears
// the vote.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  RouteProp,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { PlayerIdentity } from '@/components/PlayerIdentity';
import { RatingStars } from '@/components/RatingStars';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { gameService } from '@/services/gameService';
import { ratingsService } from '@/services/ratingsService';
import { logError } from '@/services/errorLog';
import { useGameStore } from '@/store/gameStore';
import { useUserStore } from '@/store/userStore';
import { toast } from '@/components/Toast';
import { successHaptic } from '@/utils/haptics';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { Game, RatingValue } from '@/types';
import type { GameStackParamList } from '@/navigation/GameStack';

type Nav = NativeStackNavigationProp<GameStackParamList, 'RatePlayers'>;
type Params = RouteProp<GameStackParamList, 'RatePlayers'>;

export function RatePlayersScreen() {
  const nav = useNavigation<Nav>();
  const { gameId } = useRoute<Params>().params;

  const playersMap = useGameStore((s) => s.players);
  const hydratePlayers = useGameStore((s) => s.hydratePlayers);
  const currentUser = useUserStore((s) => s.currentUser);

  const [game, setGame] = useState<Game | null>(null);
  const [loading, setLoading] = useState(true);
  // rater's current vote per rated-user id (0 = not voted yet)
  const [votes, setVotes] = useState<Record<string, RatingValue | 0>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  // Registered players minus the viewer. Guests are never in `players[]`.
  const rateableIds = useMemo(() => {
    if (!game || !currentUser) return [];
    return (game.players ?? []).filter((p) => p !== currentUser.id);
  }, [game, currentUser]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const g = await gameService.getGameById(gameId);
        if (!alive) return;
        setGame(g);
        if (g && g.players.length > 0) hydratePlayers(g.players);
      } catch (err) {
        logError('ratePlayersLoad', err, { screen: 'RatePlayersScreen', gameId });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [gameId, hydratePlayers]);

  // Pre-fill the rater's existing votes so re-opening shows current stars.
  useEffect(() => {
    if (!currentUser || rateableIds.length === 0) return;
    let alive = true;
    (async () => {
      const entries = await Promise.all(
        rateableIds.map(async (uid) => {
          const v = await ratingsService
            .getMyVote(currentUser.id, uid)
            .catch(() => null);
          return [uid, (v?.rating ?? 0) as RatingValue | 0] as const;
        }),
      );
      if (!alive) return;
      setVotes((prev) => {
        const next = { ...prev };
        for (const [uid, r] of entries) next[uid] = r;
        return next;
      });
    })();
    return () => {
      alive = false;
    };
  }, [currentUser, rateableIds]);

  const handleRate = useCallback(
    async (ratedId: string, next: number) => {
      if (!currentUser) return;
      const prev = votes[ratedId] ?? 0;
      // Optimistic UI; revert on failure.
      setVotes((s) => ({ ...s, [ratedId]: next as RatingValue | 0 }));
      setSaving((s) => ({ ...s, [ratedId]: true }));
      try {
        if (next === 0) {
          await ratingsService.clearMyVote(currentUser.id, ratedId);
        } else {
          await ratingsService.ratePlayer(
            currentUser.id,
            ratedId,
            next as RatingValue,
          );
          successHaptic();
        }
      } catch (err) {
        setVotes((s) => ({ ...s, [ratedId]: prev }));
        toast.error(he.ratePlayersSaveFailed);
        if (__DEV__) console.warn('[ratePlayers] save failed', err);
      } finally {
        setSaving((s) => ({ ...s, [ratedId]: false }));
      }
    },
    [currentUser, votes],
  );

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.ratePlayersTitle} />
      {loading ? (
        <View style={styles.center}>
          <SoccerBallLoader size={40} />
        </View>
      ) : rateableIds.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>{he.ratePlayersEmpty}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.intro}>{he.ratePlayersIntro}</Text>
          <Card style={styles.listCard}>
            {rateableIds.map((uid, i) => {
              const p = playersMap[uid];
              return (
                <View
                  key={uid}
                  style={[styles.row, i > 0 && styles.rowDivider]}
                >
                  <View style={styles.identity}>
                    <PlayerIdentity
                      user={{
                        id: uid,
                        name: p?.displayName ?? '...',
                        avatarId: p?.avatarId,
                        photoUrl: p?.photoUrl,
                      }}
                      size="sm"
                    />
                  </View>
                  <RatingStars
                    value={votes[uid] ?? 0}
                    size={28}
                    onChange={(n) => handleRate(uid, n)}
                  />
                </View>
              );
            })}
          </Card>
          <Text style={styles.hint}>{he.ratePlayersHint}</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  intro: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  listCard: { padding: 0, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  identity: { flexShrink: 1 },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
});
