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
import { logError } from '@/services/errorLog';
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
  // Hydrate the new GameFormValues shape from the persisted Game.
  // Recurring is no longer a top-level wizard mode — it's a step-3
  // toggle. We pre-set it ON for any game that was originally created
  // with a deferred-open time (status='scheduled' or
  // `registrationOpensAt > 0`) so the picker shows by default; the
  // admin can flip it OFF to convert the game to immediate-open.
  const isRecurringEdit =
    g.status === 'scheduled' ||
    (typeof g.registrationOpensAt === 'number' && g.registrationOpensAt > 0);
  // City is the matcher key. Pre-fill from the saved value and trust
  // it as canonical (it was picked from the same autocomplete in the
  // create / previous edit flow). Previously we forced the admin to
  // re-tap every time the screen opened, which was pure friction; the
  // wizard's onChange handler still flips `cityFromList` back to
  // false the moment the admin manually edits, so the matcher
  // guarantee survives.
  const presetCity = (g.city ?? '').trim();
  return {
    title: g.title,
    startsAt: g.startsAt,
    fieldName: g.fieldName ?? '',
    city: presetCity,
    cityFromList: presetCity.length > 0,
    fieldAddress: g.fieldAddress ?? '',
    fieldType: g.fieldType,
    format: g.format ?? '5v5',
    numberOfTeams: g.numberOfTeams ?? 2,
    matchDurationMinutes: g.matchDurationMinutes
      ? String(g.matchDurationMinutes)
      : '',
    // Tag-based rule chips. Prefer the new `ruleTags` array; if a
    // legacy doc only has the old hasReferee/Penalties/HalfTime
    // booleans (or `extraTimeMinutes`), synthesize the equivalent
    // chips so the editor sees what the game actually carries — they
    // can keep, remove, or rename freely. Saving will write the new
    // tag array; the legacy booleans stay untouched on the doc.
    ruleTags:
      Array.isArray(g.ruleTags) && g.ruleTags.length > 0
        ? g.ruleTags
        : [
            g.hasReferee ? 'שופט' : '',
            g.hasHalfTime ? 'משחקים עם חוצים' : '',
            g.hasPenalties ? 'פנדלים בסיום' : '',
            typeof g.extraTimeMinutes === 'number' && g.extraTimeMinutes > 0
              ? `זמן נוסף ${g.extraTimeMinutes}'`
              : '',
          ].filter((s) => s.length > 0),
    visibility: g.visibility ?? 'community',
    requiresApproval: !!g.requiresApproval,
    recurringGameEnabled: isRecurringEdit,
    registrationOpensAt: g.registrationOpensAt ?? 0,
    cancelDeadlineHours: g.cancelDeadlineHours,
    // For legacy games (saved before the filler fields existed):
    // default `acceptsFillers` to false (admin must opt in
    // explicitly, even after the field is added), and use 70 as the
    // sensible default trust floor.
    acceptsFillers: g.acceptsFillers === true,
    fillerMinTrust:
      typeof g.fillerMinTrust === 'number' ? g.fillerMinTrust : 70,
    notes: g.notes ?? '',
    bringBall: g.bringBall ?? true,
    bringShirts: g.bringShirts ?? true,
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
        } else {
          logError('gameEditLoad', err, {
            screen: 'GameEditScreen',
            gameId,
          });
          if (__DEV__) console.warn('[gameEdit] load failed', err);
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
    const parsedDuration = parseInt(v.matchDurationMinutes, 10);
    const playersPerTeam =
      v.format === '6v6' ? 6 : v.format === '7v7' ? 7 : 5;
    const newMaxPlayers = playersPerTeam * v.numberOfTeams;
    // Block lowering capacity below what's already registered. Counts
    // players + guests + pending (anyone currently holding a slot or
    // about to). Waitlist is excluded — it's overflow by definition.
    const registeredCount =
      (game.players?.length ?? 0) +
      (game.guests?.length ?? 0) +
      (game.pending?.length ?? 0);
    if (newMaxPlayers < registeredCount) {
      Alert.alert(
        he.editGameCapacityTooLowTitle,
        he.editGameCapacityTooLowBody(registeredCount, newMaxPlayers),
      );
      return;
    }
    // Warn before moving kickoff into the past (FV-03).
    if (!v.recurringGameEnabled && v.startsAt < Date.now()) {
      const proceed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          he.createGamePastDateTitle,
          he.createGamePastDateBody,
          [
            { text: he.cancel, style: 'cancel', onPress: () => resolve(false) },
            { text: he.createGamePastDateConfirm, onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        );
      });
      if (!proceed) return;
    }
    // Notify-on-edit confirm: changing the time / field / format of a
    // game that already has registered players (players + waitlist)
    // sends them an update push (NT-05). Tell the admin before it goes
    // out (FV-04/06/07). Format change matters because the capacity
    // derives from format × numberOfTeams — a 5v5→7v7 flip can change
    // who fits.
    const notifiableCount =
      (game.players?.length ?? 0) + (game.waitlist?.length ?? 0);
    const timeChanged = v.startsAt !== game.startsAt;
    const fieldChanged = v.fieldName.trim() !== (game.fieldName ?? '');
    const formatChanged = v.format !== game.format;
    if (notifiableCount > 0 && (timeChanged || fieldChanged || formatChanged)) {
      const proceed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          he.editGameNotifyTitle,
          he.editGameNotifyBody(notifiableCount),
          [
            { text: he.cancel, style: 'cancel', onPress: () => resolve(false) },
            { text: he.editGameNotifyConfirm, onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        );
      });
      if (!proceed) return;
    }
    // Visibility is access-control: routed through the dedicated
    // setVisibility handler so its admin/status/enum guards run, not
    // through the generic patch path (which now rejects `visibility`).
    if (v.visibility !== game.visibility) {
      try {
        await gameService.setVisibility(game.id, v.visibility);
      } catch (err) {
        logError('setVisibility', err, {
          screen: 'GameEditScreen',
          gameId: game.id,
          visibility: v.visibility,
        });
        throw err;
      }
    }
    // `registrationOpensAt` is patched only when the recurring toggle
    // is ON and the game is still in 'scheduled' state — once the CF
    // has flipped it to 'open' the field is moot. The CF's
    // `openedNotificationSent` flag prevents a re-flip from
    // dispatching a second push.
    const regOpensPatch =
      v.recurringGameEnabled &&
      game.status === 'scheduled' &&
      v.registrationOpensAt > 0
        ? { registrationOpensAt: v.registrationOpensAt }
        : {};
    try {
      await gameService.updateGameV2(game.id, {
        title: v.title.trim() || game.title,
        startsAt: v.startsAt,
        fieldName: v.fieldName.trim(),
        maxPlayers: newMaxPlayers,
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
        city: v.city.trim() || undefined,
        fieldAddress: v.fieldAddress.trim() || undefined,
        ruleTags: v.ruleTags,
        acceptsFillers: v.acceptsFillers,
        fillerMinTrust: v.acceptsFillers ? v.fillerMinTrust : undefined,
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
      logError('updateGameV2', err, {
        screen: 'GameEditScreen',
        gameId: game.id,
      });
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
