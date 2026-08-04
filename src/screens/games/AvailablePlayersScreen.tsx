// AvailablePlayersScreen — coach-only "find invitable players for this
// game" surface. Pulls users whose availability matches the game's
// weekday + city + hour and that aren't already in the game, then lets
// the coach send the existing inviteToGame notification per row.
//
// Filters live in `userService.findAvailablePlayers`. This screen is a
// thin presentation layer.

import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';

import { ScreenHeader } from '@/components/ScreenHeader';
import { PlayerIdentity } from '@/components/PlayerIdentity';
import { Button } from '@/components/Button';
import { appAlert } from '@/components/AppDialog';
import { userService } from '@/services';
import { gameService } from '@/services/gameService';
import { notificationsService } from '@/services/notificationsService';
import { achievementsService } from '@/services/achievementsService';
import { logError } from '@/services/errorLog';
import { toast } from '@/components/Toast';
import type { Game, User } from '@/types';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';

type RouteParams = { AvailablePlayers: { gameId: string } };

export function AvailablePlayersScreen() {
  const route = useRoute<RouteProp<RouteParams, 'AvailablePlayers'>>();
  const nav = useNavigation<any>();
  const { gameId } = route.params;
  const me = useUserStore((s) => s.currentUser);
  const myCommunities = useGroupStore((s) => s.groups);

  const [game, setGame] = useState<Game | null>(null);
  const [candidates, setCandidates] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());
  // "Send to everyone available, in pulses" — manual filler-pulse trigger.
  const [pulsing, setPulsing] = useState(false);
  const [pulseSent, setPulseSent] = useState(false);

  // Stable key of the viewer's communities (id + the fields that affect the
  // availability query). Keying the loader on THIS string instead of the raw
  // `myCommunities` array stops a full reload every time an unrelated store
  // update hands back a new array reference — which is what made the page
  // "refresh after each invite" (the invite CF bumps a doc, a listener churns
  // the store, and the old `[me, myCommunities, city]` deps re-fired the load).
  const communitiesKey = useMemo(
    () =>
      myCommunities
        .map((c) => `${c.id}:${c.city ?? ''}:${c.lat ?? ''}:${c.lng ?? ''}`)
        .join('|'),
    [myCommunities],
  );

  useEffect(() => {
    if (!gameId || !me) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const myCommunityIds = myCommunities.map((g) => g.id);
        const [mine, community] = await Promise.all([
          gameService.getMyGames(me.id).catch(() => [] as Game[]),
          gameService
            .getCommunityGames(me.id, myCommunityIds)
            .catch(() => [] as Game[]),
        ]);
        const g =
          mine.find((x) => x.id === gameId) ??
          community.find((x) => x.id === gameId) ??
          null;
        if (!alive) return;
        setGame(g);
        if (!g) {
          setCandidates([]);
          return;
        }
        // Seed the "already invited" set from the game's server-recorded
        // invitees (the CF arrayUnions each recipient into `invitedUserIds`).
        // Without this the local `invitedIds` reset every time the screen
        // remounted, so a player already invited looked invitable again on
        // return (user report).
        setInvitedIds(new Set(g.invitedUserIds ?? []));
        const day = new Date(g.startsAt).getDay();
        const hour = formatHour(g.startsAt);
        const exclude = [
          // Never offer to invite yourself — the CF rejects it with
          // invalid-argument ("cannot invite yourself"), which surfaced
          // as a logged error from real users.
          me.id,
          ...(g.players ?? []),
          ...(g.waitlist ?? []),
          ...(g.pending ?? []),
        ];
        // Prefer the game's actual field coords for the radius match; fall
        // back to the community's coords, then the city name.
        const grp = myCommunities.find((c) => c.id === g.groupId);
        const gameLat = g.fieldLat ?? grp?.lat;
        const gameLng = g.fieldLng ?? grp?.lng;
        // Resolve the filter city from the just-loaded game's community.
        const cityResolved = grp?.city || undefined;
        const list = await userService.findAvailablePlayers({
          day,
          hour,
          city: cityResolved,
          gameLat,
          gameLng,
          excludeIds: exclude,
        });
        if (alive) setCandidates(list);
      } catch (err) {
        logError('findAvailablePlayers', err, {
          screen: 'AvailablePlayersScreen',
          gameId,
          userId: me.id,
        });
        if (__DEV__) console.warn('[availablePlayers] load failed', err);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // Keyed on stable primitives — NOT the raw `me`/`myCommunities` objects —
    // so a store-reference churn (e.g. after sending an invite) can't re-trigger
    // a full reload. `me`/`myCommunities` are read fresh inside when it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, me?.id, communitiesKey]);

  const invite = async (target: User) => {
    if (!game || !me || invitingId) return;
    setInvitingId(target.id);
    try {
      await notificationsService.inviteToGame({
        recipientId: target.id,
        gameId: game.id,
      });
      // CF bumps invitesSent server-side; we just update the local
      // "invited X" state so the row immediately disables.
      setInvitedIds((s) => new Set([...s, target.id]));
      toast.success(
        he.playerCardInviteSentToast.replace('{name}', target.name),
      );
    } catch (err) {
      logError('inviteToGame', err, {
        screen: 'AvailablePlayersScreen',
        gameId: game.id,
        userId: me.id,
        targetId: target.id,
      });
      const code = (err as { code?: string })?.code ?? '';
      if (code === 'resource-exhausted') {
        toast.error(he.inviteRateLimited);
      } else if (code === 'failed-precondition') {
        toast.error(he.inviteAlreadyJoined);
      } else if (code === 'permission-denied') {
        toast.error(he.inviteNotAllowed);
      } else if (code === 'invalid-argument') {
        toast.error(he.inviteSelfNotAllowed);
      } else {
        toast.error(String((err as Error).message ?? err));
      }
    } finally {
      setInvitingId(null);
    }
  };

  const REASON_MSG: Record<string, string> = {
    TOO_LATE: he.sendPulseTooLate,
    TOO_EARLY: he.sendPulseTooEarly,
    GAME_FULL: he.sendPulseFull,
    NO_CITY: he.sendPulseNoCity,
    GAME_NOT_OPEN: he.sendPulseNotOpen,
  };

  const sendToAll = () => {
    if (!game || pulsing || pulseSent) return;
    appAlert(he.sendPulseTitle, he.sendPulseConfirm, [
      { text: he.cancel, style: 'cancel' },
      {
        text: he.sendPulseCta,
        onPress: async () => {
          setPulsing(true);
          try {
            const res = await gameService.startFillerPulse(game.id);
            if (res.started) {
              setPulseSent(true);
              toast.success(
                res.alreadyRunning ? he.sendPulseAlready : he.sendPulseStarted,
              );
            } else {
              toast.error(REASON_MSG[res.reason ?? ''] ?? he.sendPulseError);
            }
          } catch (err) {
            logError('startFillerPulse', err, { gameId: game.id });
            toast.error(he.sendPulseError);
          } finally {
            setPulsing(false);
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.availablePlayersTitle} />
      {game ? (
        <View style={styles.pulseCard}>
          <Text style={styles.pulseTitle}>{he.sendPulseTitle}</Text>
          <Text style={styles.pulseExplain}>{he.sendPulseExplain}</Text>
          <Button
            title={pulseSent ? he.sendPulseSentBtn : he.sendPulseCta}
            variant={pulseSent ? 'outline' : 'primary'}
            fullWidth
            loading={pulsing}
            disabled={pulseSent}
            onPress={sendToAll}
          />
        </View>
      ) : null}
      {loading ? (
        <SoccerBallLoader size={40} style={{ marginTop: spacing.lg }} />
      ) : !game ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{he.gameLoadError}</Text>
        </View>
      ) : candidates.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{he.availablePlayersEmpty}</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={candidates}
          keyExtractor={(u) => u.id}
          // Read-only preview of who the pulse will reach — the per-row
          // one-by-one invite was removed (user request): a single "send to
          // everyone" button up top is the only send action now.
          renderItem={({ item }) => (
            <View style={styles.row}>
              <PlayerIdentity
                user={item}
                size={44}
                onPress={() =>
                  nav.navigate('PlayerCard', {
                    userId: item.id,
                    groupId: game?.groupId,
                  })
                }
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.name}
                </Text>
                {item.availability?.preferredCity ? (
                  <Text style={styles.sub} numberOfLines={1}>
                    {item.availability.preferredCity}
                  </Text>
                ) : null}
              </View>
            </View>
          )}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}
    </SafeAreaView>
  );
}

function formatHour(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  pulseCard: {
    margin: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pulseTitle: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '900',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  pulseExplain: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'right',
    writingDirection: 'rtl',
    lineHeight: 19,
  },
  list: { padding: spacing.lg, gap: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  sep: { height: 1, backgroundColor: colors.divider, marginVertical: 4 },
  name: { ...typography.bodyBold, color: colors.text },
  sub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
