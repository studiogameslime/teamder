import React, { useCallback, useRef, useState } from 'react';
import { OwnCardSectionSkeleton } from '@/components/loading/CentralSkeletons';
import { LoadingNotice } from '@/components/loading/ScreenSkeletons';
import { ActivityIndicator, ImageBackground, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { captureRef } from 'react-native-view-shot';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SafeModal } from '@/components/SafeModal';
import { UserAvatar } from '@/components/UserAvatar';
import { ComparisonActivitySection } from '@/components/profile/ComparisonActivitySection';
import { PlayerAvailabilitySummary } from '@/components/social/PlayerAvailabilitySummary';
import { toast } from '@/components/Toast';
import { ownPlayerCardService } from '@/services/ownPlayerCardService';
import { userService } from '@/services/userService';
import { groupService } from '@/services/groupService';
import { socialPlayersService } from '@/services/socialPlayersService';
import { buildAppInviteUrl } from '@/services/deepLinkService';
import { createShortInviteUrl } from '@/services/inviteLinkService';
import { observeCaughtError } from '@/utils/errorObservation';
import { publicCardStats } from '@/utils/ownPlayerCard';
import { effectiveStatus } from '@/services/gameLifecycle';
import { clubRouteFor } from '@/utils/clubRoute';
import { getCoverSource } from '@/data/coverImages';
import { resolveRoundCover } from '@/data/roundCover';
import { formatGameDay, formatTime } from '@/utils/format';
import { useUserStore } from '@/store/userStore';
import { RTL_LABEL_ALIGN } from '@/theme';
import type { Game, Group, User } from '@/types';
import type { SocialProfile } from '@/types/social';

type Data = Awaited<ReturnType<typeof ownPlayerCardService.load>>;
type LastStats = Awaited<ReturnType<typeof ownPlayerCardService.lastStats>>;
type Remote<T> = { value?: T; failed?: boolean; loading?: boolean; pendingProfile?: boolean };
export type OwnPlayerCardPreview = { data: Data; clubs: Group[]; referrals: number; lastStats: LastStats; publicProfile?: SocialProfile };
type Icon = keyof typeof Ionicons.glyphMap;

function Title({ title, icon }: { title: string; icon: Icon }) {
  return <View style={s.heading}><Ionicons name={icon} size={23} color="#2563EB"/><Text style={s.title}>{title}</Text></View>;
}
function Action({ title, icon, onPress, outline = false, busy = false }: { title: string; icon: Icon; onPress: () => void; outline?: boolean; busy?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={onPress} style={({ pressed }) => [s.action, outline && s.outline, pressed && { opacity: 0.7 }]}>
    <Text style={[s.actionText, outline && s.blue]}>{title}</Text>{busy ? <ActivityIndicator color={outline ? '#2563EB' : 'white'}/> : <Ionicons name={icon} size={20} color={outline ? '#2563EB' : 'white'}/>}
  </Pressable>;
}
function Link({ title, onPress }: { title: string; onPress: () => void }) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title} style={s.link}><Text style={s.linkText}>{title}</Text><Ionicons name="chevron-back" size={20} color="#2563EB"/></Pressable>;
}
function Numbers({ items }: { items: { label: string; value: number | null }[] }) {
  return <View style={s.numbers}>{items.map(item => <View key={item.label} style={s.metric}><Text style={s.number}>{item.value ?? '—'}</Text><Text style={s.metricLabel}>{item.label}</Text></View>)}</View>;
}
function Hero({ user, compact = false }: { user: User; compact?: boolean }) {
  return <ImageBackground source={require('@/assets/images/synthetic-pitch.png')} style={[s.hero, compact && s.compactHero]} imageStyle={s.heroImage}>
    <LinearGradient colors={['rgba(235,246,255,0.62)', '#F4F7FB']} style={StyleSheet.absoluteFill}/>
    <UserAvatar user={user} size={compact ? 56 : 82} ring/><Text style={[s.name, compact && s.compactName]}>{user.name}</Text>
    {user.availability?.homeCity ? <Text style={s.subtitle}>{user.availability.homeCity}</Text> : null}
  </ImageBackground>;
}
/** A smaller version of home's split photo/meta card, with the same cover resolver. */
function CompactUpcomingRound({ game, club, coverLoading, onOpen }: { game: Game; club?: Group; coverLoading: boolean; onOpen: () => void }) {
  const [failedPhotoUrl, setFailedPhotoUrl] = useState<string | null>(null);
  const activePhoto = useRef(club?.coverPhotoUrl);
  activePhoto.current = club?.coverPhotoUrl;
  const live = effectiveStatus(game) === 'active';
  const source = resolveRoundCover(game, club, coverLoading, failedPhotoUrl);
  const venue = [game.fieldName, game.city].filter(Boolean).join(' · ');
  const ink = live ? '#6D28D9' : '#15803D';
  return <View style={s.nextCard}>
    <View style={s.nextTop}>
      <View style={s.nextMeta}>
        <View style={s.heading}><Ionicons name="calendar-outline" size={17} color={ink}/><Text style={s.nextHeading}>המחזור הקרוב שלי</Text></View>
        <Text style={s.nextName} numberOfLines={2}>{game.title}</Text>
        {club?.name && club.name !== game.title ? <Text style={s.nextClub} numberOfLines={1}>{club.name}</Text> : null}
        {venue ? <View style={s.nextInfo}><Ionicons name="location-outline" size={13} color="#667796"/><Text style={s.nextDetail} numberOfLines={2}>{venue}</Text></View> : null}
        <View style={s.nextInfo}><Ionicons name="time-outline" size={13} color={ink}/><Text style={s.nextDate}>{formatGameDay(game.startsAt)} · {formatTime(game.startsAt)}</Text></View>
      </View>
      <View style={s.nextPhoto}>
        <ImageBackground source={source} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => {
          if (club?.coverPhotoUrl && activePhoto.current === club.coverPhotoUrl) setFailedPhotoUrl(club.coverPhotoUrl);
        }}/>
        <LinearGradient colors={['#FFFFFF', 'rgba(255,255,255,0)']} locations={[0, 0.75]} start={{ x: 1, y: 0.5 }} end={{ x: 0, y: 0.5 }} style={StyleSheet.absoluteFill} pointerEvents="none"/>
        <View style={[s.nextBadge, { backgroundColor: ink }]}><Ionicons name={live ? 'radio' : 'checkmark-circle'} size={12} color="white"/><Text style={s.nextBadgeText} numberOfLines={1}>{live ? 'מתקיים עכשיו' : 'רשום'}</Text></View>
      </View>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="לפרטי המחזור" onPress={onOpen} style={({ pressed }) => [s.nextAction, { backgroundColor: live ? '#F3EEFF' : '#ECFDF3' }, pressed && { opacity: 0.7 }]}>
      <Ionicons name={live ? 'radio-outline' : 'checkmark-circle-outline'} size={18} color={ink}/><Text style={[s.nextActionText, { color: ink }]}>לפרטי המחזור</Text><Ionicons name="chevron-back" size={17} color={ink}/>
    </Pressable>
  </View>;
}
function LoadState({ remote, retry, kind = 'round' }: { remote: Remote<unknown>; retry: () => void; kind?: React.ComponentProps<typeof OwnCardSectionSkeleton>['kind'] }) {
  if (remote.failed) return <View style={s.state}><Text style={s.body}>לא ניתן לטעון כרגע.</Text><Link title="נסה שוב" onPress={retry}/></View>;
  return remote.loading ? remote.value === undefined ? <OwnCardSectionSkeleton kind={kind}/> : <LoadingNotice compact label="מעדכנים את הנתונים שלך"/> : null;
}

/** Owner-only page. Other-player and guest cards continue using their existing routes. */
export function OwnPlayerCard({ user, preview }: { user: User; preview?: OwnPlayerCardPreview }) {
  const nav = useNavigation<any>();
  const [data, setData] = useState<Remote<Data>>(preview ? { value: preview.data } : { loading: true });
  const [clubs, setClubs] = useState<Remote<Group[]>>(preview ? { value: preview.clubs } : { loading: true });
  const [referrals, setReferrals] = useState<Remote<number>>(preview ? { value: preview.referrals } : { loading: true });
  const [lastStats, setLastStats] = useState<Remote<LastStats>>(preview ? { value: preview.lastStats } : { loading: true });
  const [publicProfile, setPublicProfile] = useState<Remote<SocialProfile>>(preview?.publicProfile ? { value: preview.publicProfile } : {});
  const [showPublic, setShowPublic] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const publicGeneration = useRef(0);
  const sharingRef = useRef(false);
  const cardRef = useRef<View>(null);
  const lastStatsGameId = useRef<string | null>(preview?.data.last?.id ?? null);
  const owner = useUserStore(x => x.currentUser?.id);
  const ownerIsGuest = useUserStore(x => x.currentUser?.isGuest === true);
  const current = () => {
    if (preview) return true;
    const account = useUserStore.getState().currentUser;
    return owner === user.id && !ownerIsGuest && account?.id === user.id && !account.isGuest;
  };
  const retry = () => setReload(n => n + 1);

  useFocusEffect(useCallback(() => {
    if (preview) return;
    if (!current()) return;
    const turn = ++generation.current;
    let alive = true;
    const valid = () => alive && generation.current === turn && current();
    setData(previous => ({ ...previous, loading: true, failed: false }));
    setClubs(previous => ({ ...previous, loading: true, failed: false }));
    setReferrals(previous => ({ ...previous, loading: true, failed: false }));
    setLastStats(previous => ({ ...previous, loading: true, failed: false }));
    let roundsArrived = false;
    let requestedLast: string | undefined;
    const readLastStats = async (last: Game | null) => {
      if (!last) { lastStatsGameId.current = null; setLastStats({}); return; }
      if (requestedLast === last.id) return;
      requestedLast = last.id;
      if (lastStatsGameId.current !== last.id) setLastStats({ loading: true });
      lastStatsGameId.current = last.id;
      try {
        const stats = await ownPlayerCardService.lastStats(user.id, last.id);
        if (valid()) setLastStats({ value: stats });
      } catch (error) {
        observeCaughtError(error, { source: 'src/components/profile/OwnPlayerCard.tsx', handler: 'lastStats', site: 'OwnPlayerCard:lastStats' });
        if (valid()) setLastStats(previous => ({ ...previous, loading: false, failed: true }));
      }
    };
    // Independent sections keep an unavailable count distinct from an empty account.
    void ownPlayerCardService.load(user.id, { onRounds: value => {
      if (!valid()) return;
      const account = useUserStore.getState().currentUser;
      if (!account || account.isGuest || account.id !== user.id) return;
      roundsArrived = true;
      void readLastStats(value.last);
      setData(previous => ({ value: { user: previous.value?.user ?? account, ...value }, loading: true, pendingProfile: previous.value ? previous.pendingProfile : true }));
    } }).then(value => {
      if (!valid()) return;
      setData({ value });
      void readLastStats(value.last);
    }).catch(error => {
      observeCaughtError(error, { source: 'src/components/profile/OwnPlayerCard.tsx', handler: 'load', site: 'OwnPlayerCard:load' });
      if (valid()) {
        setData(previous => ({ ...previous, loading: false, failed: true }));
        if (!roundsArrived) setLastStats(previous => ({ ...previous, loading: false }));
      }
    });
    void groupService.listForUser(user.id, { includeAdminRatings: false }).then(value => {
      if (valid()) setClubs({ value });
    }).catch(error => {
      observeCaughtError(error, { source: 'src/components/profile/OwnPlayerCard.tsx', handler: 'clubs', site: 'OwnPlayerCard:clubs' });
      if (valid()) setClubs(previous => ({ ...previous, loading: false, failed: true }));
    });
    void userService.getInvitedUsersCount(user.id).then(value => {
      if (valid()) setReferrals({ value });
    }).catch(error => {
      observeCaughtError(error, { source: 'src/components/profile/OwnPlayerCard.tsx', handler: 'referrals', site: 'OwnPlayerCard:referrals' });
      if (valid()) setReferrals(previous => ({ ...previous, loading: false, failed: true }));
    });
    return () => { alive = false; generation.current++; };
  }, [user.id, reload, preview, owner, ownerIsGuest]));

  const fresh = data.value?.user ?? user;
  const go = (screen: string, params?: object) => {
    if (preview) return;
    // Push a fresh cabinet so an older instance cannot pop this card off the stack.
    if (screen === 'Achievements') {
      nav.push(screen, params);
      return;
    }
    // Every host of PlayerCard can reach ProfileStack; preserve the local stack
    // for destinations already registered there (match, statistics, club).
    if (['ProfileEdit', 'SocialPrivacy', 'Referrals'].includes(screen)) {
      if (nav.getState().routeNames.includes(screen)) nav.navigate(screen, params);
      else nav.navigate('ProfileTab', { screen, params, initial: false });
    } else nav.navigate(screen, params);
  };
  const openPublic = async () => {
    setShowPublic(true);
    if (preview || !current()) return;
    setPublicProfile({ loading: true });
    const turn = generation.current;
    const request = ++publicGeneration.current;
    const valid = () => current() && generation.current === turn && publicGeneration.current === request;
    try {
      const card = await socialPlayersService.profile(user.id, 'card');
      if (!valid()) return;
      setPublicProfile({ value: card, loading: !!card.detailsPending });
      if (card.detailsPending) {
        const value = await socialPlayersService.profile(user.id, 'summary');
        if (valid()) setPublicProfile({ value });
      }
    } catch (error) {
      if (!valid()) return;
      observeCaughtError(error, { source: 'src/components/profile/OwnPlayerCard.tsx', handler: 'openPublic', site: 'OwnPlayerCard:public' });
      setPublicProfile(previous => ({ value: previous.value, failed: true }));
    }
  };
  const share = async (kind: 'card' | 'invite') => {
    if (preview || !current() || sharingRef.current) return;
    sharingRef.current = true; setSharing(true);
    try {
      if (kind === 'invite') {
        const link = await createShortInviteUrl({
          type: 'app', invitedBy: user.id, fallbackLong: buildAppInviteUrl(user.id),
        });
        if (current()) await Share.share({ title: 'הזמנה לכדורגל', message: `בוא לשחק איתי! הצטרף דרך הקישור האישי שלי:\n${link}` });
      } else {
        const Sharing = require('expo-sharing') as typeof import('expo-sharing');
        if (!await Sharing.isAvailableAsync()) { toast.info('שיתוף תמונה אינו זמין במכשיר הזה'); return; }
        const uri = await captureRef(cardRef, { format: 'png', quality: 1 });
        if (current()) await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'כרטיס השחקן שלי' });
      }
    } catch (error) {
      observeCaughtError(error, { source: 'src/components/profile/OwnPlayerCard.tsx', handler: 'share', site: 'OwnPlayerCard:share' });
      if (current()) toast.error('לא ניתן לשתף כרגע. נסה שוב');
    } finally { sharingRef.current = false; setSharing(false); }
  };
  const total = data.value;
  const next = total?.next;
  const last = total?.last;
  const allNumbers = total ? [
    { label: 'מחזורים', value: total.attendedCount }, { label: 'שערים', value: data.pendingProfile ? null : fresh.stats?.goals ?? 0 }, { label: 'בישולים', value: data.pendingProfile ? null : fresh.stats?.assists ?? 0 },
  ] : [];
  const shareNumbers = total && !data.pendingProfile && !data.loading && !data.failed
    ? publicCardStats({ ...fresh, socialPrivacy: user.socialPrivacy }, total.attendedCount) : null;
  const publicValue = publicProfile.value;
  const publicNumbers = publicValue?.statisticsVisibility === 'everyone' ? publicValue.cardStats ?? publicValue.statistics?.stats : null;
  const clubName = (game: Game) => clubs.value?.find(club => club.id === game.groupId)?.name;

  if (!current()) return null;
  return <SafeAreaView style={s.root} edges={['top']}>
    <ScreenHeader title="כרטיס השחקן שלי" actions={[{ icon: 'shield-checkmark-outline', label: 'פרטיות השחקן', onPress: () => go('SocialPrivacy') }]}/>
    <ScrollView contentContainerStyle={s.content}>
      <Hero user={fresh} compact/>
      <View style={s.actions}><View style={s.half}><Action title="הסטטיסטיקה שלי" icon="stats-chart-outline" onPress={() => go('Statistics')}/></View><View style={s.half}><Action title="עריכת פרופיל" icon="create-outline" outline onPress={() => go('ProfileEdit')}/></View></View>
      {total && next ? <CompactUpcomingRound game={next} club={clubs.value?.find(club => club.id === next.groupId)} coverLoading={!!clubs.loading} onOpen={() => go('MatchDetails', { gameId: next.id })}/> :
        data.loading && !data.failed && !total ? <View style={s.nextCard}><OwnCardSectionSkeleton kind="upcoming"/></View> :
        <View style={s.card}><Title title="המחזור הקרוב שלי" icon="calendar-outline"/><LoadState remote={data} retry={retry}/>{total ? <Text style={s.body}>אין כרגע מחזור קרוב שאליו אתה רשום כשחקן.</Text> : null}</View>}
      <View style={s.card}><Title title="המחזור האחרון שלי" icon="time-outline"/><LoadState remote={data} retry={retry}/>
        {total ? last ? <><Text style={s.roundTitle}>{last.title}</Text>{clubName(last) ? <Text style={s.body}>{clubName(last)}</Text> : null}<Text style={s.body}>{new Date(last.startsAt).toLocaleDateString('he-IL')}</Text>
          <LoadState remote={lastStats} retry={retry} kind="numbers"/>
          {lastStats.value !== undefined || !lastStats.loading ? <Numbers items={[{ label: 'שערים', value: lastStats.value?.goals ?? null }, { label: 'בישולים', value: lastStats.value?.assists ?? null }, { label: 'משחקים', value: lastStats.value?.games ?? null }]}/> : null}
          {!lastStats.loading && !lastStats.value?.games && lastStats.value?.games !== 0 ? <Text style={s.caption}>נתונים שלא תועדו מוצגים כמקף.</Text> : null}
          <Link title="לסיכום המחזור שלי" onPress={() => go('MatchDetails', { gameId: last.id, initialTab: 'stats' })}/>
        </> : <Text style={s.body}>אחרי המחזור הראשון שבו תשחק, הסיכום שלך יופיע כאן.</Text> : null}
      </View>
      <View style={s.card}><Title title="המועדונים שלי" icon="people-outline"/><LoadState remote={clubs} retry={retry} kind="clubs"/>
        {clubs.value?.map(club => <Pressable key={club.id} accessibilityRole="button" accessibilityLabel={`למועדון ${club.name}`} onPress={() => go(clubRouteFor(club.id), { groupId: club.id })} style={s.clubRow}>
          <ImageBackground source={club.coverPhotoUrl ? { uri: club.coverPhotoUrl } : getCoverSource(club.coverImageId) ?? require('@/assets/images/synthetic-pitch.png')} style={s.clubImage} imageStyle={{ borderRadius: 10 }}/>
          <Text style={s.rowTitle}>{club.name}</Text><Ionicons name="chevron-back" size={20} color="#2563EB"/>
        </Pressable>)}
        {clubs.value?.length === 0 ? <Text style={s.body}>עדיין לא הצטרפת למועדון.</Text> : null}
      </View>
      <View style={s.card}><Title title="המספרים שלי" icon="stats-chart-outline"/><Text style={s.body}>בכל המועדונים · כל הזמנים</Text><LoadState remote={data} retry={retry} kind="numbers"/>
        {total ? <Numbers items={allNumbers}/> : null}<Link title="לסטטיסטיקה המלאה שלי" onPress={() => go('Statistics')}/>
      </View>
      <ComparisonActivitySection ownerId={user.id}/>
      <View style={s.card}><Title title="ארון התארים שלי" icon="trophy-outline"/><Text style={s.body}>ההישגים ותארי העונה שצברת, במקום אחד.</Text><Link title="לכל התארים שלי" onPress={() => go('Achievements')}/></View>
      <View style={s.card}><Title title="כך אחרים רואים אותי" icon="eye-outline"/><Text style={s.body}>תצוגה מקדימה לשחקן שאינו ברשימת החברים שלך.</Text><Action title="לתצוגה המקדימה" icon="eye-outline" outline onPress={() => void openPublic()}/></View>
      <View style={s.card}><Title title="שיתוף הכרטיס שלי" icon="share-social-outline"/><Text style={s.body}>שתף תמונה של כרטיס השחקן שלך. נתונים פרטיים אינם נכללים בתמונה.</Text>
        <View ref={cardRef} collapsable={false} style={s.shareCard}>
          <Hero user={fresh}/>{shareNumbers ? <Numbers items={[{ label: 'מחזורים', value: shareNumbers.rounds }, { label: 'שערים', value: shareNumbers.goals }, { label: 'בישולים', value: shareNumbers.assists }]}/> : <Text style={s.shareCaption}>נפגשים על המגרש</Text>}
          <Text style={s.brand}>כרטיס השחקן שלי</Text>
        </View>
        <Action title="שיתוף הכרטיס כתמונה" icon="share-social-outline" busy={sharing} onPress={() => void share('card')}/>
      </View>
      <View style={s.card}><Title title="הזמנת חברים" icon="person-add-outline"/><LoadState remote={referrals} retry={retry} kind="referrals"/>
        {referrals.value !== undefined ? <><Numbers items={[{ label: 'הצטרפו דרך הקישור שלך', value: referrals.value }]}/>{referrals.value > 0 ? <Link title="לחברים שהצטרפו דרכי" onPress={() => go('Referrals')}/> : null}</> : null}
        <Text style={s.body}>הזמן חברים להצטרף לאפליקציה דרך הקישור האישי שלך.</Text><Action title="שיתוף קישור ההזמנה" icon="link-outline" outline busy={sharing} onPress={() => void share('invite')}/>
      </View>
    </ScrollView>
    <SafeModal visible={showPublic} animationType="slide" onRequestClose={() => setShowPublic(false)}>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}><ScreenHeader title="תצוגה מקדימה" onBack={() => setShowPublic(false)}/>
        <ScrollView contentContainerStyle={s.content}><Text style={s.noticeText}>כך הכרטיס מוצג לשחקן שאינו חבר שלך</Text><LoadState remote={publicProfile} retry={() => void openPublic()} kind="profile"/>
          {publicValue ? <><Hero user={{ ...publicValue.player, createdAt: 0 }}/>{publicValue.player.city ? <Text style={s.body}>{publicValue.player.city}</Text> : null}
            <PlayerAvailabilitySummary player={publicValue.player}/>
            {publicValue.detailsPending && !publicNumbers ? <View style={s.card}><Title title="המספרים שלי" icon="stats-chart-outline"/><Text style={s.body}>{publicProfile.failed ? 'המספרים לא נטענו. אפשר לנסות שוב.' : 'טוען את המספרים שמוצגים בכרטיס'}</Text></View> : publicNumbers ? <View style={s.card}><Title title="המספרים שלי" icon="stats-chart-outline"/><Numbers items={[{ label: 'מחזורים', value: publicNumbers.attendedGames }, { label: 'שערים', value: publicNumbers.goals }, { label: 'בישולים', value: publicNumbers.assists }]}/></View> : <View style={s.card}><Title title="פרטיות הסטטיסטיקה" icon="shield-checkmark-outline"/><Text style={s.body}>{publicValue.statisticsVisibility === 'onlyMe' ? 'הסטטיסטיקה גלויה רק לך.' : 'הסטטיסטיקה גלויה לחברים בלבד.'}</Text></View>}
            <View style={s.card}><Title title="המועדונים שמוצגים בכרטיס" icon="people-outline"/>{publicValue.detailsPending ? <Text style={s.body}>{publicProfile.failed ? 'פרטי המועדונים לא נטענו. אפשר לנסות שוב.' : 'טוען את המועדונים שמוצגים בכרטיס'}</Text> : publicValue.clubs.length ? publicValue.clubs.map(club => <Text key={club.id} style={s.publicClub}>{club.name}</Text>) : <Text style={s.body}>אין מועדונים להצגה בכרטיס.</Text>}</View>
          </> : null}
          <Action title="להגדרות הפרטיות" icon="shield-checkmark-outline" outline onPress={() => { setShowPublic(false); go('SocialPrivacy'); }}/><Action title="חזרה לכרטיס שלי" icon="arrow-forward-outline" onPress={() => setShowPublic(false)}/>
        </ScrollView></SafeAreaView>
    </SafeModal>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F4F7FB' }, content: { padding: 16, paddingTop: 4, paddingBottom: 32, gap: 14 },
  hero: { alignItems: 'center', justifyContent: 'center', minHeight: 186, padding: 16, gap: 5, borderRadius: 18, overflow: 'hidden' }, heroImage: { borderRadius: 18 },
  compactHero: { minHeight: 112, padding: 12, gap: 3 }, compactName: { fontSize: 21 },
  name: { fontSize: 25, fontWeight: '800', color: '#0C1744', textAlign: 'center' }, subtitle: { fontSize: 14, color: '#667796', textAlign: 'center' },
  card: { padding: 14, gap: 10, backgroundColor: 'white', borderRadius: 18, borderWidth: 1, borderColor: '#E5ECF7', shadowColor: '#19345B', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 8 }, title: { flex: 1, color: '#0C1744', fontSize: 19, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  body: { color: '#667796', fontSize: 14, lineHeight: 22, textAlign: RTL_LABEL_ALIGN }, roundTitle: { color: '#15244F', fontSize: 16, fontWeight: '700', textAlign: RTL_LABEL_ALIGN, flexShrink: 1 },
  caption: { fontSize: 12, color: '#667796', textAlign: RTL_LABEL_ALIGN }, blue: { color: '#2563EB' },
  actions: { flexDirection: 'row', alignItems: 'stretch', gap: 10 }, half: { flex: 1 },
  action: { flexGrow: 1, minHeight: 48, borderRadius: 13, padding: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7, backgroundColor: '#2563EB', borderWidth: 1, borderColor: '#2563EB' },
  outline: { backgroundColor: 'white', borderColor: '#A9C6FF' }, actionText: { color: 'white', fontSize: 14, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
  numbers: { flexDirection: 'row', backgroundColor: '#EFF6FF', borderRadius: 14, paddingVertical: 16 }, metric: { flex: 1, alignItems: 'center', paddingHorizontal: 4, gap: 5 }, number: { fontSize: 29, fontWeight: '800', color: '#2563EB' }, metricLabel: { color: '#667796', fontSize: 13, textAlign: 'center' },
  link: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 44 }, linkText: { color: '#2563EB', fontSize: 14, fontWeight: '700', textAlign: RTL_LABEL_ALIGN, flex: 1 },
  clubRow: { minHeight: 65, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderColor: '#EDF1F8' }, clubImage: { width: 44, height: 44 }, rowTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: '#15244F', textAlign: RTL_LABEL_ALIGN },
  nextCard: { backgroundColor: 'white', borderRadius: 18, borderWidth: 1, borderColor: '#E5ECF7', padding: 12, gap: 8, shadowColor: '#19345B', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  nextTop: { flexDirection: 'row', gap: 8, alignItems: 'stretch', minHeight: 116 }, nextMeta: { flex: 1, minWidth: 0, gap: 4 },
  nextHeading: { flex: 1, fontSize: 17, fontWeight: '800', color: '#0C1744', textAlign: RTL_LABEL_ALIGN }, nextName: { color: '#15244F', fontSize: 15, fontWeight: '700', textAlign: RTL_LABEL_ALIGN }, nextClub: { color: '#667796', fontSize: 12, textAlign: RTL_LABEL_ALIGN },
  nextInfo: { flexDirection: 'row', alignItems: 'center', gap: 4 }, nextDetail: { flex: 1, fontSize: 12, lineHeight: 17, color: '#667796', textAlign: RTL_LABEL_ALIGN }, nextDate: { flex: 1, fontSize: 12, fontWeight: '700', color: '#334155', textAlign: RTL_LABEL_ALIGN },
  nextPhoto: { width: '28%', minWidth: 80, maxWidth: 108, borderRadius: 12, overflow: 'hidden' }, nextBadge: { position: 'absolute', top: 6, right: 4, left: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 12, paddingHorizontal: 5, paddingVertical: 4 }, nextBadgeText: { fontSize: 10, fontWeight: '700', color: 'white', flexShrink: 1, textAlign: 'center' },
  nextAction: { minHeight: 44, paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 11 }, nextActionText: { flex: 1, fontSize: 14, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  noticeText: { color: '#2563EB', fontSize: 14, fontWeight: '600', textAlign: RTL_LABEL_ALIGN, flexShrink: 1 },
  state: { paddingVertical: 12 }, shareCard: { overflow: 'hidden', borderRadius: 16, backgroundColor: '#F4F7FB' }, shareCaption: { padding: 14, color: '#667796', textAlign: 'center' }, brand: { padding: 10, fontSize: 13, fontWeight: '700', color: '#2563EB', textAlign: 'center' }, publicClub: { paddingVertical: 12, color: '#15244F', fontSize: 16, fontWeight: '600', textAlign: RTL_LABEL_ALIGN },
});
