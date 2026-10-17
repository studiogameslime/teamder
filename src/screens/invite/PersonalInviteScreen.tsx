import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { UserAvatar } from '@/components/UserAvatar';
import { FriendActionButton } from '@/components/profile/FriendActionButton';
import { useAuthenticatedAction } from '@/hooks/useAuthenticatedAction';
import { resolveInviteLandingActivity, type InviteLandingActivity } from '@/services/personalInviteLanding';
import { resolveRoundCover } from '@/data/roundCover';
import { getCoverSource } from '@/data/coverImages';
import { formatDayDate, formatTime } from '@/utils/format';
import { MatchCardSkeleton } from '@/components/anim/MatchCardSkeleton';
import { AppearItem } from '@/components/anim/AppearItem';
import {
  resolveInviter,
  type InviteContext,
} from '@/services/personalInvite';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { useUserStore } from '@/store/userStore';
import { colors, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { activeGuestCount, type Game, type GroupPublic } from '@/types';
import type { PublicUser } from '@/firebase/firestore';

type Nav = { navigate: (s: string, p?: unknown) => void; goBack: () => void };
type Params = { PersonalInvite: { invitedBy?: string; source?: string } | undefined };

type ActivityState =
  | { status: 'loading' }
  | ({ status: 'ready'; owner: string } & InviteLandingActivity)
  | { status: 'error' };

export function PersonalInviteScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<RouteProp<Params, 'PersonalInvite'>>();
  const invitedBy = route.params?.invitedBy;
  const authAction = useAuthenticatedAction();
  const me = useUserStore((s) => s.currentUser);

  // Two independent loads, deliberately. The hero is the reason the screen
  // exists and resolves from a single get; the activity below is a query and a
  // few more gets. Making the hero wait for them would put a spinner over the
  // one sentence somebody actually came for.
  const [inviter, setInviter] = useState<PublicUser | null>(null);
  const [inviterLoading, setInviterLoading] = useState(!!invitedBy);
  const [unresolved, setUnresolved] = useState<InviteContext['unresolvedReason']>(
    invitedBy ? undefined : 'no_inviter',
  );
  const [activity, setActivity] = useState<ActivityState>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    setInviter(null);
    setInviterLoading(!!invitedBy);
    void (async () => {
      const { inviter: found, reason } = await resolveInviter(invitedBy);
      if (!alive) return;
      setInviter(found);
      setUnresolved(reason);
      setInviterLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [invitedBy]);

  const activityRequest = useRef(0);
  const loadActivity = useCallback(async () => {
    const request = ++activityRequest.current;
    if (!me) return;
    setActivity({ status: 'loading' });
    try {
      const result = await resolveInviteLandingActivity(invitedBy, me.id, me.isGuest === true);
      if (request === activityRequest.current) setActivity({ status: 'ready', owner: `${me.id}:${me.isGuest === true}:${invitedBy}`, ...result });
    } catch {
      // Keep the inviter visible and make the failed query retryable.
      if (request === activityRequest.current) setActivity({ status: 'error' });
    }
  }, [invitedBy, me]);

  useEffect(() => {
    void loadActivity();
    return () => { activityRequest.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id, me?.isGuest, invitedBy]);

  // Reported once, and only once BOTH loads have settled: the whole value of
  // `has_clubs` / `has_games` is telling "nobody tapped" apart from "there was
  // nothing to tap", and firing early records the second as the first.
  const reportedRef = useRef(false);
  useEffect(() => {
    if (reportedRef.current || inviterLoading || activity.status === 'loading') return;
    reportedRef.current = true;
    logEvent(AnalyticsEvent.PersonalInviteViewed, {
      is_guest: me?.isGuest === true,
      entry_source: 'personal_invite',
      // The uid, never the name: one is a join key, the other is a person's
      // identity sitting in an analytics property forever.
      inviter_uid: invitedBy,
      inviter_resolved: !!inviter,
      unresolved_reason: unresolved,
      has_clubs: activity.status === 'ready' && activity.clubs.length > 0,
      has_games: activity.status === 'ready' && activity.games.length > 0,
      source: route.params?.source,
    });
  }, [inviterLoading, activity, inviter, unresolved, invitedBy, me, route.params]);

  const openClub = (club: GroupPublic) => {
    logEvent(AnalyticsEvent.PersonalInviteTargetOpened, {
      target_type: 'club',
      target_id: club.id,
      inviter_uid: invitedBy,
    });
    // The PUBLIC club screen, always — it is the one that reads
    // `/groupsPublic` and carries the join path, including the request flow
    // for a club that is not open. Sending a non-member to the members' screen
    // would be a rules denial dressed up as a broken page.
    nav.navigate('CommunityDetailsPublic', { groupId: club.id });
  };

  const openGame = (game: Game) => {
    logEvent(AnalyticsEvent.PersonalInviteTargetOpened, {
      target_type: 'game',
      target_id: game.id,
      inviter_uid: invitedBy,
    });
    // MatchDetails owns joining — including the membership question. A match
    // inside a club the viewer is not in renders its own blocked-access view
    // there rather than a join button this screen has no business offering.
    nav.navigate('MatchDetails', { gameId: game.id });
  };

  const explore = () => {
    logEvent(AnalyticsEvent.PersonalInviteExploreTapped, { inviter_uid: invitedBy });
    nav.navigate('GuestHome');
  };

  const named = inviter && inviter.id === invitedBy ? inviter.name?.trim() : undefined;
  const ready = activity.status === 'ready' && activity.owner === `${me?.id}:${me?.isGuest === true}:${invitedBy}` ? activity : null;
  const nextGame = ready?.games[0];
  const isGuest = !me || me.isGuest === true;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
          <Text style={styles.wordmark}>Teamder</Text>
          <Pressable onPress={explore} hitSlop={8} style={styles.closeBtn}
            accessibilityRole="button" accessibilityLabel={he.personalInviteCloseA11y}>
            <Ionicons name="close" size={25} color={colors.textMuted} />
          </Pressable>
        </View>
        <View style={styles.hero}>
          {inviterLoading ? <View style={styles.avatarSkeleton} /> : inviter && named ? <>
            <View style={styles.identity}>
              <UserAvatar user={inviter} size={76} ring />
              <View style={styles.identityCopy}>
                <Text style={styles.name}>{named}</Text>
                <Text style={styles.subtitle}>הזמין אותך לשחק יחד</Text>
              </View>
            </View>
            {inviter.id !== me?.id ? <View style={styles.friendArea}>
              {isGuest ? <>
                <Button title="התחבר להוספה לחברים" variant="outline" fullWidth iconRight="person-add-outline"
                  onPress={authAction.requestAuth} />
                <Text style={styles.friendHint}>לאחר ההתחברות אפשר לשלוח בקשת חברות</Text>
              </> : <FriendActionButton key={`${me.id}:${inviter.id}`} meId={me.id} otherUserId={inviter.id} />}
            </View> : null}
          </> : <>
            <Ionicons name="mail-open-outline" size={36} color={colors.primary} />
            <Text style={styles.name}>{he.personalInviteGenericTitle}</Text>
            <Text style={styles.subtitle}>{he.personalInviteGenericBody}</Text>
          </>}
        </View>

        {activity.status === 'loading' || (activity.status === 'ready' && !ready) ? <MatchCardSkeleton count={1} /> : activity.status === 'error' ?
          <Notice title="הפעילות לא נטענה" body="אפשר לנסות שוב. פרטי ההזמנה נשמרו." retry={loadActivity} /> : ready ? <>
            <Text style={styles.sectionTitle}>המחזור הקרוב</Text>
            {ready.gamesUnavailable ? <Notice title="פרטי המחזור לא נטענו" retry={loadActivity} /> : nextGame ?
              <UpcomingRound game={nextGame} club={ready.clubs.find(c => c.id === nextGame.groupId)} onPress={() => openGame(nextGame)} /> :
              <Notice title="אין כרגע מחזור קרוב שמוצג לך" body="כשיהיה מחזור זמין להצטרפות, אפשר יהיה למצוא אותו כאן." />}
            <Text style={styles.sectionTitle}>המועדונים שבהם משחק</Text>
            {ready.clubs.map((club, index) => <AppearItem key={club.id} index={index}>
              <ClubRow club={club} onPress={() => openClub(club)} />
            </AppearItem>)}
            {ready.clubsUnavailable ? <Notice title="חלק מפרטי המועדונים לא נטענו" retry={loadActivity} /> :
              ready.clubs.length === 0 ? <Notice title={isGuest ? 'מועדונים נוספים אחרי התחברות' : 'אין כרגע מועדונים שמוצגים לך'}
                body={isGuest ? 'אפשר להתחבר כדי לראות את המועדונים הזמינים בפרופיל.' : undefined} /> : null}
          </> : null}
        <Pressable onPress={explore} style={styles.explore} accessibilityRole="button">
          <Text style={styles.exploreText}>גלה עוד מועדונים ומחזורים</Text>
          <Ionicons name="chevron-back" size={18} color={colors.primary} />
        </Pressable>
      </ScrollView>
      {authAction.sheet}
    </SafeAreaView>
  );
}

function Notice({title, body, retry}: {title: string; body?: string; retry?: () => Promise<void>}) {
  return <View style={styles.notice}>
    <Text style={styles.noticeTitle}>{title}</Text>
    {body ? <Text style={styles.meta}>{body}</Text> : null}
    {retry ? <Button title={he.retry} variant="outline" onPress={() => void retry()} /> : null}
  </View>;
}

function UpcomingRound({game, club, onPress}: {game: Game; club?: GroupPublic; onPress: () => void}) {
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const spots = Math.max(0, game.maxPlayers - game.players.length - activeGuestCount(game.guests) - (game.pendingPromotion?.uid ? 1 : 0));
  return <View style={styles.roundCard}>
    <View style={styles.coverArea}>
      <Image source={resolveRoundCover(game, club ?? null, false, failedPhoto)} style={styles.roundCover}
        onError={() => { if (club?.coverPhotoUrl) setFailedPhoto(club.coverPhotoUrl); }} />
      <View style={styles.roundBadge}><Text style={styles.roundBadgeText}>{spots > 0 ? 'ההרשמה פתוחה' : 'ההרשמה לרשימת המתנה'}</Text></View>
    </View>
    <View style={styles.roundBody}>
      <Text style={styles.roundTitle}>{game.title || 'מחזור קרוב'}</Text>
      <View style={styles.detailRow}><Ionicons name="calendar-outline" size={18} color={colors.textMuted} />
        <Text style={styles.detailText}>{`${formatDayDate(game.startsAt)} · ⁦${formatTime(game.startsAt)}⁩`}</Text></View>
      <View style={styles.detailRow}><Ionicons name="location-outline" size={18} color={colors.textMuted} />
        <Text style={styles.detailText}>{game.fieldName || 'פרטי המגרש במחזור'}</Text></View>
      <Text style={styles.spots}>{spots > 0 ? spots === 1 ? 'נותר מקום אחד' : `נותרו ${spots} מקומות` : 'המחזור מלא · אפשר לצפות בפרטים'}{game.requiresApproval ? ' · ההצטרפות באישור' : ''}</Text>
      <Button title="לפרטי המחזור" fullWidth iconLeft="chevron-back" onPress={onPress} />
    </View>
  </View>;
}

function ClubRow({club, onPress}: {club: GroupPublic; onPress: () => void}) {
  const [failedPhoto, setFailedPhoto] = useState(false);
  const source = club.coverPhotoUrl && !failedPhoto ? {uri: club.coverPhotoUrl} : getCoverSource(club.coverImageId);
  return <Card style={styles.clubCard} onPress={onPress}>
    <View style={styles.clubRow}>
      {source ? <Image source={source} style={styles.clubCover} onError={() => setFailedPhoto(true)} /> :
        <View style={styles.clubIcon}><Ionicons name="shield-outline" size={24} color={colors.primary} /></View>}
      <View style={styles.clubText}>
        <Text style={styles.clubName} numberOfLines={2}>{club.name}</Text>
        <Text style={styles.meta}>{[club.city, he.personalInviteClubMembers(club.memberCount)].filter(Boolean).join(' · ')}</Text>
      </View>
      <Ionicons name="chevron-back" size={19} color={colors.textMuted} />
    </View>
  </Card>;
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bg},
  scroll: {padding: 16, paddingBottom: 28, gap: 12},
  topRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4},
  wordmark: {fontSize: 27, fontWeight: '900', color: colors.primary},
  closeBtn: {minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center'},
  hero: {backgroundColor: '#EDF4FF', borderRadius: 22, padding: 16, gap: 16},
  identity: {flexDirection: 'row', gap: 14, alignItems: 'center'},
  identityCopy: {flex: 1, minWidth: 0, gap: 5},
  name: {fontSize: 25, fontWeight: '800', color: colors.text, textAlign: RTL_LABEL_ALIGN},
  subtitle: {fontSize: 15, lineHeight: 22, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN},
  friendArea: {gap: 7, minHeight: 46, justifyContent: 'center'},
  friendHint: {fontSize: 12, lineHeight: 18, textAlign: 'center', color: colors.textMuted},
  avatarSkeleton: {width: 76, height: 76, borderRadius: 38, backgroundColor: '#DBE7FC'},
  sectionTitle: {fontSize: 20, fontWeight: '800', color: colors.text, textAlign: RTL_LABEL_ALIGN, marginTop: 6},
  roundCard: {backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 20, overflow: 'hidden'},
  coverArea: {margin: 8, height: 98, borderRadius: 14, overflow: 'hidden', backgroundColor: '#E8EEF5'},
  roundCover: {width: '100%', height: '100%', resizeMode: 'cover'},
  roundBadge: {position: 'absolute', top: 9, start: 9, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 20, backgroundColor: '#DCFCE7'},
  roundBadgeText: {fontSize: 12, fontWeight: '700', color: '#166534'},
  roundBody: {padding: 12, paddingTop: 3, gap: 8},
  roundTitle: {fontSize: 21, fontWeight: '800', color: colors.text, textAlign: RTL_LABEL_ALIGN},
  detailRow: {flexDirection: 'row', alignItems: 'center', gap: 7},
  detailText: {flex: 1, minWidth: 0, fontSize: 14, lineHeight: 20, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN},
  spots: {fontSize: 13, lineHeight: 19, color: colors.primary, textAlign: RTL_LABEL_ALIGN},
  clubCard: {padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 18},
  clubRow: {flexDirection: 'row', alignItems: 'center', gap: 11},
  clubCover: {width: 46, height: 46, borderRadius: 23, backgroundColor: colors.surfaceMuted},
  clubIcon: {width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center'},
  clubText: {flex: 1, minWidth: 0, gap: 4},
  clubName: {fontSize: 16, fontWeight: '800', color: colors.text, textAlign: RTL_LABEL_ALIGN},
  meta: {fontSize: 13, lineHeight: 20, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN},
  notice: {padding: 16, gap: 7, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border},
  noticeTitle: {fontSize: 15, lineHeight: 22, fontWeight: '700', color: colors.text, textAlign: RTL_LABEL_ALIGN},
  explore: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 48, paddingVertical: 10},
  exploreText: {fontSize: 15, fontWeight: '700', color: colors.primary, flexShrink: 1, textAlign: 'center'},
});
