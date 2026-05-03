// Edit-game screen — same wizard as Create, just bootstrapped from
// the existing game's saved values and submitting via updateGameV2.

import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { ScreenHeader } from '@/components/ScreenHeader';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { gameService } from '@/services/gameService';
import { Game } from '@/types';
import { colors, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import type { GameStackParamList } from '@/navigation/GameStack';
import {
  GameWizardForm,
  type GameFormValues,
} from '@/screens/games/GameWizardForm';
import { Text } from 'react-native';

type Nav = NativeStackNavigationProp<GameStackParamList, 'GameEdit'>;
type Route = RouteProp<GameStackParamList, 'GameEdit'>;

function gameToValues(g: Game): GameFormValues {
  return {
    title: g.title,
    startsAt: g.startsAt,
    fieldName: g.fieldName ?? '',
    location: g.fieldAddress ?? g.city ?? '',
    format: g.format ?? '5v5',
    numberOfTeams: g.numberOfTeams ?? 2,
    matchDurationMinutes: g.matchDurationMinutes
      ? String(g.matchDurationMinutes)
      : '',
    extraTimeMinutes: g.extraTimeMinutes
      ? String(g.extraTimeMinutes)
      : '',
    hasReferee: !!g.hasReferee,
    hasPenalties: !!g.hasPenalties,
    hasHalfTime: !!g.hasHalfTime,
    visibility: g.visibility ?? 'community',
    fieldType: g.fieldType,
    cancelDeadlineHours: g.cancelDeadlineHours,
    requiresApproval: !!g.requiresApproval,
    notes: g.notes ?? '',
    bringBall: g.bringBall ?? true,
    bringShirts: g.bringShirts ?? true,
    minPlayers: g.minPlayers ? String(g.minPlayers) : '',
  };
}

export function GameEditScreen() {
  const nav = useNavigation<Nav>();
  const { gameId } = useRoute<Route>().params;
  const [game, setGame] = useState<Game | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const g = await gameService.getGameById(gameId);
        if (!alive) return;
        // null and ACCESS_BLOCKED both render the generic error
        // state below — by design, an admin who landed here without
        // permission to read the doc shouldn't be silently shown
        // anything else. We don't differentiate further because
        // GameEdit is admin-only; non-admins can't reach this route.
        setGame(g);
      } catch (err) {
        const code =
          typeof (err as { code?: unknown })?.code === 'string'
            ? ((err as { code: string }).code)
            : '';
        if (alive && code === 'ACCESS_BLOCKED') {
          setGame(null); // empty state below; nav already restricts
                          // who can hit this route.
        } else if (__DEV__) {
          console.warn('[gameEdit] load failed', err);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [gameId]);

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.editGameTitle} />
        <View style={styles.center}>
          <SoccerBallLoader size={40} />
        </View>
      </SafeAreaView>
    );
  }
  if (!game) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.editGameTitle} />
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.textMuted} />
          <Text style={styles.emptyText}>{he.error}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const submit = async (v: GameFormValues) => {
    const parsedMin = parseInt(v.minPlayers, 10);
    const parsedDuration = parseInt(v.matchDurationMinutes, 10);
    const parsedExtra = parseInt(v.extraTimeMinutes, 10);
    const playersPerTeam =
      v.format === '6v6' ? 6 : v.format === '7v7' ? 7 : 5;
    // Visibility is access-control: routed through the dedicated
    // setVisibility handler so its admin/status/enum guards run, not
    // through the generic patch path (which now rejects `visibility`).
    if (v.visibility !== game.visibility) {
      await gameService.setVisibility(game.id, v.visibility);
    }
    await gameService.updateGameV2(game.id, {
      title: v.title.trim() || game.title,
      startsAt: v.startsAt,
      fieldName: v.fieldName.trim(),
      maxPlayers: playersPerTeam * v.numberOfTeams,
      minPlayers:
        Number.isFinite(parsedMin) && parsedMin > 0 ? parsedMin : undefined,
      format: v.format,
      numberOfTeams: v.numberOfTeams,
      cancelDeadlineHours: v.cancelDeadlineHours,
      fieldType: v.fieldType,
      matchDurationMinutes:
        Number.isFinite(parsedDuration) && parsedDuration > 0
          ? parsedDuration
          : undefined,
      requiresApproval: v.requiresApproval,
      bringBall: v.bringBall,
      bringShirts: v.bringShirts,
      notes: v.notes.trim() || undefined,
      fieldAddress: v.location.trim() || undefined,
      hasReferee: v.hasReferee,
      hasPenalties: v.hasPenalties,
      hasHalfTime: v.hasHalfTime,
      extraTimeMinutes:
        Number.isFinite(parsedExtra) && parsedExtra > 0
          ? parsedExtra
          : 0,
    });
    nav.replace('MatchDetails', { gameId: game.id });
  };

  return (
    <GameWizardForm
      headerTitle={he.editGameTitle}
      submitLabel={he.editGameSubmit}
      initial={gameToValues(game)}
      onSubmit={submit}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
