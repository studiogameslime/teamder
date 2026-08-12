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

import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { AppearItem } from '@/components/anim/AppearItem';
import { CommunityCard } from '@/components/community/CommunityCard';
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
}: {
  radiusKm: number;
  limit: number;
  /** Squad-size floor — see nearbyClubsService. */
  minMembers: number;
  /** Open the club's PUBLIC page (the viewer is never a member of these). */
  onOpenClub: (groupId: string) => void;
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
        .catch(() => alive && setClubs([]));
      return () => {
        alive = false;
      };
      // `excludeIds` is a fresh Set each render — key on its contents instead
      // so this doesn't refetch on every parent re-render.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, Array.from(excludeIds).sort().join(','), radiusKm, limit, minMembers]),
  );

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
          // "עיר · מגרש" — drop the standalone city when the free-text address
          // already names it (same rule the communities feed applies).
          const city = (g.city ?? '').trim();
          const fieldName = (g.fieldName ?? '').trim();
          const fieldAddress = (g.fieldAddress ?? '').trim();
          const cityInAddress =
            city.length > 0 &&
            fieldAddress.toLowerCase().includes(city.toLowerCase());
          const locationLine = [
            cityInAddress ? '' : city,
            fieldName,
            fieldAddress,
          ]
            .filter((s) => s.length > 0)
            .join(' · ');
          return (
            <AppearItem key={g.id} index={idx}>
              <CommunityCard
                name={g.name}
                locationLine={locationLine}
                description={g.description}
                coverPhotoUrl={g.coverPhotoUrl}
                coverImageId={g.coverImageId}
                memberCount={g.memberCount}
                // Always 'none' here — members and pending requests are
                // filtered out before we ever build a card.
                status="none"
                onPress={() => onOpenClub(g.id)}
                onJoinPress={() => handleJoin(g)}
                joinBusy={busyId === g.id}
                joinLabel={
                  g.isOpen ? he.communitiesCardJoin : he.communityRequestToJoin
                }
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
