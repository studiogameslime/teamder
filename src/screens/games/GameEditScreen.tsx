// Edit-game screen — same wizard as Create, just bootstrapped from
// the existing game's saved values and submitting via updateGameV2.

import React, { useEffect, useState } from 'react';
import { Alert, View, StyleSheet } from 'react-native';
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
    // Strict: never infer "selected from list" from a pre-filled
    // string. The flag flips to true only when the user actively
    // taps a city in the autocomplete dropdown. On edit this means
    // the user must re-pick the city from the list before submit
    // — guarantees the saved fieldAddress always corresponds to a
    // real city pick (no free-typed leftovers).
    locationFromList: false,
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
    // Surfaced by the wizard ONLY when this game was originally
    // created with a deferred-open time (`registrationOpensAt > 0`
    // OR `status='scheduled'`). The edit screen passes
    // `mode='recurring'` in that case so the picker renders.
    registrationOpensAt: g.registrationOpensAt ?? 0,
  };
}

/**
 * Decides whether the wizard should run in recurring mode for this
 * edit. We surface the `registrationOpensAt` picker in two cases:
 *   • the game still has a future open-time (status='scheduled'), so
 *     the admin can adjust the schedule before the CF flips it.
 *   • the game already opened but was originally a recurring create
 *     (`registrationOpensAt > 0`). Editing here is mostly inert —
 *     the CF's `openedNotificationSent` latch prevents a second push
 *     — but exposing the field keeps the form symmetric with create.
 */
function shouldEditAsRecurring(g: Game): boolean {
  return (
    g.status === 'scheduled' ||
    (typeof g.registrationOpensAt === 'number' && g.registrationOpensAt > 0)
  );
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

  const isRecurringEdit = shouldEditAsRecurring(game);

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
    // `registrationOpensAt` is patched only for recurring edits,
    // and only while the game is still in 'scheduled' state — once
    // the CF has flipped it to 'open' the field is moot. The CF's
    // `openedNotificationSent` flag prevents a re-flip from
    // dispatching a second push.
    const regOpensPatch =
      isRecurringEdit && game.status === 'scheduled' && v.registrationOpensAt > 0
        ? { registrationOpensAt: v.registrationOpensAt }
        : {};
    try {
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
        ...regOpensPatch,
      });
    } catch (err) {
      const e = err as Error & {
        code?: string;
        conflict?: { title: string; startsAt: number };
      };
      if (e.code === 'GAME_OVERLAP' && e.conflict) {
        const ts = new Date(e.conflict.startsAt);
        const when = `${ts.getDate()}.${ts.getMonth() + 1} ${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`;
        Alert.alert(
          he.createGameOverlapTitle,
          he.createGameOverlapBody(
            e.conflict.title || he.createGameOverlapUnknownTitle,
            when,
          ),
        );
        return;
      }
      if (e.code === 'GAME_REG_AFTER_KICKOFF') {
        Alert.alert(he.editGameRegAfterKickoffTitle, he.editGameRegAfterKickoffBody);
        return;
      }
      if (e.code === 'GAME_ALREADY_STARTED') {
        Alert.alert(he.editGameAlreadyStartedTitle, he.editGameAlreadyStartedBody);
        nav.replace('MatchDetails', { gameId: game.id });
        return;
      }
      throw err;
    }
    nav.replace('MatchDetails', { gameId: game.id });
  };

  return (
    <GameWizardForm
      headerTitle={he.editGameTitle}
      submitLabel={he.editGameSubmit}
      initial={gameToValues(game)}
      onSubmit={submit}
      mode={isRecurringEdit ? 'recurring' : 'standard'}
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
