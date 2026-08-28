// NearbyClubsSection — "מועדונים באזור שלך" on the matches tab.
//
// When there's no open match to join, the next best thing isn't an empty
// screen — it's the community that runs matches every week. This section
// surfaces a few joinable clubs near the viewer and lets them open the club's
// public page or ask to join, using the exact same card and join flow as the
// communities tab.
//
// PRIVACY, BY CONSTRUCTION: every field rendered here comes from the public
// club mirror (`GroupPublic`) — name, cover, city, member count, description.
// A club's matches are not in that document at all, so a closed club's
// fixtures, times, venues and sign-up counts cannot leak through this surface
// no matter what the club has scheduled.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { AppearItem } from '@/components/anim/AppearItem';
import { ClubCard } from '@/components/community/ClubCard';
import { resolveClubCard } from '@/utils/clubCard';
import { toast } from '@/components/Toast';
import { nearbyClubsService } from '@/services/nearbyClubsService';
import { GroupJoinRejectedError } from '@/services/groupService';
import { logError } from '@/services/errorLog';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { ensureNotGuest } from '@/utils/guestGate';
import { useGroupStore } from '@/store/groupStore';
import { useUserStore } from '@/store/userStore';
import type { GroupPublic } from '@/types';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

export function NearbyClubsSection({
  radiusKm,
  limit,
  minMembers,
  onOpenClub,
  refreshTick,
}: {
  radiusKm: number;
  limit: number;
  /** Squad-size floor — see nearbyClubsService. */
  minMembers: number;
  /** Open the club's PUBLIC page (the viewer is never a member of these). */
  onOpenClub: (groupId: string) => void;
  /** Bumped by pull-to-refresh; refetches in place without remounting. */
  refreshTick?: number;
}) {
  const user = useUserStore((s) => s.currentUser);
  const myGroups = useGroupStore((s) => s.groups);
  const pendingGroups = useGroupStore((s) => s.pendingGroups);
  const requestJoinById = useGroupStore((s) => s.requestJoinById);

  const [clubs, setClubs] = useState<GroupPublic[] | null>(null);
  const [scope, setScope] = useState<'nearby' | 'all'>('nearby');
  const [busyId, setBusyId] = useState<string | null>(null);
  // Locally hide a club the viewer just acted on, so the row doesn't sit there
  // still offering "join" until the next fetch.
  const [actedOn, setActedOn] = useState<Set<string>>(new Set());

  // Already a member / already asked → never suggest it. Both lists come from
  // the group store, so this costs no reads.
  const excludeIds = useMemo(() => {
    const s = new Set<string>();
    myGroups.forEach((g) => s.add(g.id));
    pendingGroups.forEach((g) => s.add(g.id));
    return s;
  }, [myGroups, pendingGroups]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      nearbyClubsService
        .getNearbyClubs(user ?? null, {
          excludeGroupIds: excludeIds,
          radiusKm,
          limit,
          minMembers,
        })
        .then((res) => {
          if (!alive) return;
          setClubs(res.clubs);
          setScope(res.scope);
        })
        // A failed fetch must NOT blank the section. `setClubs([])` here made
        // an error indistinguishable from "no clubs nearby", and since the
        // parent remounts this on pull-to-refresh, one bad request wiped
        // content that was on screen a second earlier — leaving an empty
        // padded box with no explanation (user report, iOS 1.0.97).
        // Keep whatever is already rendered; the next focus refetches.
        // A failed fetch must NOT blank the section. `setClubs([])` made an
        // error indistinguishable from "no clubs nearby", and one bad request
        // wiped content that was on screen a second earlier — leaving an empty
        // padded box with no explanation (user report, iOS 1.0.97).
        //
        // Read through a ref: this callback's deps deliberately exclude
        // `clubs`, so the captured value would be whatever it was when the
        // deps last changed — i.e. still null after the first success.
        .catch(() => {
          if (alive && clubsRef.current === null) setClubs([]);
        });
      return () => {
        alive = false;
      };
      // `excludeIds` is a fresh Set each render — key on its contents instead
      // so this doesn't refetch on every parent re-render.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, Array.from(excludeIds).sort().join(','), radiusKm, limit, minMembers, refreshTick]),
  );

  // Mirrors `clubs` for the error path above, which runs inside a callback
  // that must not depend on it (depending on it would refetch on every load).
  const clubsRef = useRef<typeof clubs>(null);
  useEffect(() => {
    clubsRef.current = clubs;
  }, [clubs]);

  const visible = useMemo(
    () => (clubs ?? []).filter((g) => !actedOn.has(g.id)),
    [clubs, actedOn],
  );

  const handleJoin = async (club: GroupPublic) => {
    if (!ensureNotGuest(he.guestRegisterJoinCommunity)) return;
    if (!user) return;
    setBusyId(club.id);
    try {
      const status = await requestJoinById(club.id, user.id);
      if (status === 'pending') {
        logEvent(AnalyticsEvent.GroupJoinRequested, { groupId: club.id });
        toast.success(he.toastJoinRequestSent);
        setActedOn((s) => new Set(s).add(club.id));
      } else if (status === 'joined') {
        toast.success(he.toastJoinedGroup);
        setActedOn((s) => new Set(s).add(club.id));
      } else if (status === 'already_member') {
        toast.info(he.groupAlreadyMember);
        setActedOn((s) => new Set(s).add(club.id));
      }
    } catch (err) {
      if (
        err instanceof GroupJoinRejectedError ||
        (err as Error)?.name === 'GroupJoinRejectedError'
      ) {
        toast.error(he.toastJoinRejected);
        return;
      }
      const code =
        typeof (err as { code?: unknown })?.code === 'string'
          ? (err as { code: string }).code
          : '';
      if (code === 'GROUP_FULL') {
        toast.error(he.toastGroupFull);
      } else {
        // Offline / timeout / stale App Check isn't a bug — the user retries.
        const transient = [
          'unavailable',
          'deadline-exceeded',
          'cancelled',
          'unauthenticated',
          'firebase-app-check-token-is-invalid',
        ].includes(code);
        if (!transient) {
          logError('requestJoinGroup', err, {
            screen: 'GamesListScreen/NearbyClubs',
            groupId: club.id,
            userId: user.id,
          });
        }
        toast.error(he.toastRequestFailed);
      }
    } finally {
      setBusyId(null);
    }
  };

  // Still loading, or genuinely nothing to suggest → render nothing. This is
  // supporting content; an empty "clubs near you" header is worse than none.
  if (!clubs || visible.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>
          {scope === 'nearby' ? he.gamesClubsNearbyTitle : he.gamesClubsAnyTitle}
        </Text>
        <View style={styles.underline} />
      </View>
      <Text style={styles.sub}>
        {scope === 'nearby' ? he.gamesClubsNearbySub : he.gamesClubsAnySub}
      </Text>

      <View style={styles.list}>
        {visible.map((g, idx) => {
          // ClubCard shows the CITY only — no pitch name, no address, no
          // distance. The composed "עיר · מגרש · כתובת" line the old card took
          // has no slot here, so it is not built.
          const city = (g.city ?? '').trim();
          return (
            <AppearItem key={g.id} index={idx}>
              {/* The SAME card the communities feed uses. This section had kept
                  the older CommunityCard, so the identical club rendered two
                  different ways one tab apart. `locationLine` (pitch + address)
                  is deliberately dropped: ClubCard takes the city only. */}
              <ClubCard
                vm={resolveClubCard({
                  // Always 'none' here — members and pending requests are
                  // filtered out before we ever build a card.
                  isAdmin: false,
                  isMember: false,
                  isPending: false,
                  isOpen: g.isOpen === true,
                  playerCount: g.memberCount ?? 0,
                  // This section ranks by proximity but never surfaces the
                  // number, and null must not read as "far away".
                  distanceKm: null,
                  friends: [],
                  gamesLast30: g.gamesLast30 ?? null,
                  gamesLast60: g.gamesLast60 ?? null,
                })}
                name={g.name}
                city={city}
                coverPhotoUrl={g.coverPhotoUrl}
                coverImageId={g.coverImageId}
                onPress={() => onOpenClub(g.id)}
                onCtaPress={() => handleJoin(g)}
                ctaBusy={busyId === g.id}
              />
            </AppearItem>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.lg },
  // Mirrors the screen's own section header (title + short blue underline) so
  // this reads as another section of the matches tab, not a bolted-on block.
  titleRow: { paddingHorizontal: spacing.xs, alignItems: 'flex-start', gap: 4 },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: RTL_LABEL_ALIGN,
    writingDirection: 'rtl',
  },
  underline: {
    width: 36,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#3B82F6',
  },
  sub: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    writingDirection: 'rtl',
    paddingHorizontal: spacing.xs,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  list: { gap: spacing.md },
});
