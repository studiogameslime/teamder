import { observeCaughtError } from '../../utils/errorObservation';
// AvailablePlayersScreen — coach-only "find invitable players for this
// game" surface. Pulls users whose availability matches the game's
// weekday + city + hour and that aren't already in the game, then lets
// the coach send the existing inviteToGame notification per row.
//
// Filters live in `userService.findAvailablePlayers`. This screen is a
// thin presentation layer.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { USE_MOCK_DATA } from '@/firebase/config';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Rect, Circle, Line } from 'react-native-svg';
import { formatDayDate, formatTime } from '@/utils/format';
import { activeGuestCount } from '@/types';
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
import { logError } from '@/services/errorLog';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { toast } from '@/components/Toast';
import type { Game, User } from '@/types';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';

type RouteParams = { AvailablePlayers: { gameId: string; previewCandidates?: boolean } };

export function AvailablePlayersScreen() {
  const route = useRoute<RouteProp<RouteParams, 'AvailablePlayers'>>();
  const nav = useNavigation<any>();
  const { gameId } = route.params;
  const preview = __DEV__ && USE_MOCK_DATA && process.env.EXPO_PUBLIC_QA_ROUTES === '1' && route.params.previewCandidates === true;
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
  const [query, setQuery] = useState('');
  const [onlyUninvited, setOnlyUninvited] = useState(false);
  const [sameCity, setSameCity] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const pageEpoch = useRef(0);
  const pageLock = useRef(false);
  const inviteLock = useRef(false);
  const pulseLock = useRef(false);
  const group = myCommunities.find(c => c.id === game?.groupId);
  const city = game?.city || group?.city || '';
  const visible = useMemo(() => candidates.filter(u =>
    u.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) &&
    (!onlyUninvited || !invitedIds.has(u.id)) &&
    (!sameCity || (u.availability?.homeCity || u.availability?.preferredCity || '').trim() === city.trim())
  ), [candidates, query, onlyUninvited, invitedIds, sameCity, city]);
  const free = game?.maxPlayers ? Math.max(0, game.maxPlayers - (game.players?.length ?? 0) - activeGuestCount(game.guests) - (game.pendingPromotion?.uid ? 1 : 0)) : null;

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
    ++pageEpoch.current;
    pageLock.current = false;
    setCursor(null);
    setLoadingMore(false);
    setMoreFailed(false);
    (async () => {
      setLoading(true);
      setLoadFailed(false);
      try {
        const g = await gameService.getGameById(gameId);
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
        const grp = myCommunities.find((c) => c.id === g.groupId);
        // Time, location, membership and privacy are derived on the server.
        const page = await userService.findAvailablePlayersPage(gameId);
        const list = page.players;
        if (alive) {
          setCursor(page.cursor);
          if (preview) {
            // Local render fixture, only through the explicit QA route. No accounts
            // or documents are created, and invitation actions stay local below.
            const { mockPlayers } = require('@/data/mockData');
            const demo: User[] = mockPlayers.slice(-3).map((p: {id: string; displayName: string; avatarId?: string}, i: number) => ({
              id: p.id, name: p.displayName, avatarId: p.avatarId,
              createdAt: 0, availability: { preferredDays: [], preferredCity: i === 1 ? 'רמת גן' : (g.city || grp?.city || 'תל אביב') },
            }));
            setCandidates(demo);
            setInvitedIds(new Set([demo[2].id]));
          } else setCandidates(list);
        }
      } catch (err) {
    observeCaughtError(err, {"source":"src/screens/games/AvailablePlayersScreen.tsx","handler":"AvailablePlayersScreen","site":"AvailablePlayersScreen:dc3fc2a5b4"});
        logError('findAvailablePlayers', err, {
          screen: 'AvailablePlayersScreen',
          gameId,
          userId: me.id,
        });
        if (alive) setLoadFailed(true);
        if (__DEV__) console.warn('[availablePlayers] load failed', err);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      ++pageEpoch.current;
    };
    // Keyed on stable primitives — NOT the raw `me`/`myCommunities` objects —
    // so a store-reference churn (e.g. after sending an invite) can't re-trigger
    // a full reload. `me`/`myCommunities` are read fresh inside when it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, me?.id, communitiesKey, retry, preview]);

  const loadMore = async () => {
    if (!cursor || pageLock.current || loading) return;
    const request = pageEpoch.current;
    pageLock.current = true;
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      const page = await userService.findAvailablePlayersPage(gameId, cursor);
      if (request !== pageEpoch.current) return;
      setCandidates(old => [...new Map([...old,...page.players].map(p => [p.id,p])).values()]);
      setCursor(page.cursor);
    } catch (err) {
    observeCaughtError(err, {"source":"src/screens/games/AvailablePlayersScreen.tsx","handler":"loadMore","site":"AvailablePlayersScreen:5663fa9289"});
      if (request === pageEpoch.current) setMoreFailed(true);
      logError('findAvailablePlayersPage', err, {gameId});
    } finally {
      if (request === pageEpoch.current) {pageLock.current=false;setLoadingMore(false);}
    }
  };

  const invite = async (target: User) => {
    if (!game || !me || inviteLock.current || invitedIds.has(target.id)) return;
    inviteLock.current = true;
    setInvitingId(target.id);
    try {
      if (!preview) await notificationsService.inviteToGame({
        recipientId: target.id,
        gameId: game.id,
      });
      if (!preview) logEvent(AnalyticsEvent.AvailablePlayerInvited, {
        gameId: game.id,
        targetId: target.id,
      });
      // CF bumps invitesSent server-side; we just update the local
      // "invited X" state so the row immediately disables.
      setInvitedIds((s) => new Set([...s, target.id]));
      toast.success(
        he.playerCardInviteSentToast.replace('{name}', target.name),
      );
    } catch (err) {
    observeCaughtError(err, {"source":"src/screens/games/AvailablePlayersScreen.tsx","handler":"invite","site":"AvailablePlayersScreen:18a2145173"});
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
      inviteLock.current = false;
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
          if (pulseLock.current) return;
          pulseLock.current = true;
          setPulsing(true);
          try {
            const res = preview ? { started: true, alreadyRunning: false, reason: undefined } : await gameService.startFillerPulse(game.id);
            if (res.started) {
              setPulseSent(true);
              toast.success(
                res.alreadyRunning ? he.sendPulseAlready : he.sendPulseStarted,
              );
            } else {
              toast.error(REASON_MSG[res.reason ?? ''] ?? he.sendPulseError);
            }
          } catch (err) {
    observeCaughtError(err, {"source":"src/screens/games/AvailablePlayersScreen.tsx","handler":"onPress","site":"AvailablePlayersScreen:3163eb023a"});
            logError('startFillerPulse', err, { gameId: game.id });
            toast.error(he.sendPulseError);
          } finally {
            pulseLock.current = false;
            setPulsing(false);
          }
        },
      },
    ]);
  };

  const header = game && <>
    <Text style={styles.intro}>השחקנים כאן הגדירו זמינות שמתאימה למועד ולאזור המחזור</Text>
    <View style={styles.summary}>
      <View pointerEvents="none" style={styles.pitch} accessible={false}><Svg width={125} height={95} viewBox="0 0 140 100"><Rect x={4} y={4} width={132} height={92} fill="none" stroke="#DCEBFF" strokeWidth={1.5}/><Line x1={70} y1={4} x2={70} y2={96} stroke="#DCEBFF"/><Circle cx={70} cy={50} r={19} fill="none" stroke="#DCEBFF"/><Rect x={4} y={30} width={20} height={40} fill="none" stroke="#DCEBFF"/><Rect x={116} y={30} width={20} height={40} fill="none" stroke="#DCEBFF"/></Svg></View>
      <Text style={styles.roundTitle}>{game.title}</Text>
      <View style={styles.line}><Ionicons name="calendar-outline" size={20} color="#52688D"/><Text style={styles.context}>{formatDayDate(game.startsAt)} · {formatTime(game.startsAt)}{city ? ` · ${city}` : ''}</Text></View>
      <View style={styles.badge}><Ionicons name="people-outline" size={17} color="#187849"/><Text style={styles.badgeText}>{free === null ? 'הרשמה ללא מכסה' : free ? `${free} מקומות פנויים בהרכב` : 'ההרכב מלא · הצטרפות להמתנה'}</Text></View>
    </View>
    <View style={styles.search}><Ionicons name="search-outline" size={22} color="#7284A5"/><TextInput value={query} onChangeText={setQuery} placeholder="חיפוש שחקנים זמינים" placeholderTextColor="#7284A5" accessibilityLabel="חיפוש שחקנים זמינים" style={styles.input}/>{!!query && <Pressable onPress={() => setQuery('')} accessibilityLabel="נקה חיפוש" hitSlop={10}><Ionicons name="close-circle" size={20} color="#7284A5"/></Pressable>}</View>
    <View style={styles.filters}>
      <Ionicons name="options-outline" size={21} color="#52688D"/>
      <Pressable accessibilityRole="checkbox" accessibilityState={{checked: onlyUninvited}} onPress={() => setOnlyUninvited(v => !v)} style={[styles.filter, onlyUninvited && styles.filterOn]}><Text style={[styles.filterText, onlyUninvited && styles.filterOnText]}>טרם הוזמנו</Text></Pressable>
      {!!city && <Pressable accessibilityRole="checkbox" accessibilityState={{checked: sameCity}} onPress={() => setSameCity(v => !v)} style={[styles.filter, sameCity && styles.filterOn]}><Text style={[styles.filterText, sameCity && styles.filterOnText]}>באותה עיר</Text></Pressable>}
      <Text style={styles.count}>{visible.length} מוצגים</Text>
    </View>
  </>;
  const footer = game && <View style={styles.pulseCard}>
    <View style={styles.line}><Ionicons name="megaphone-outline" size={25} color="#2D68FF"/><Text style={styles.pulseTitle}>מחפשים עוד שחקנים?</Text></View>
    <Text style={styles.pulseExplain}>{he.sendPulseExplain}</Text>
    <Button title={pulseSent ? he.sendPulseSentBtn : he.sendPulseCta} variant={pulseSent ? 'outline' : 'primary'} style={pulseSent ? styles.sent : styles.primary} fullWidth loading={pulsing} disabled={pulseSent || pulsing} onPress={sendToAll}/>
    <Text style={styles.disclaimer}>הפנייה באזור אינה מוגבלת למסנני הרשימה.</Text>
  </View>;

  return <SafeAreaView style={styles.root} edges={['top']}>
    <ScreenHeader title="שחקנים זמינים למחזור"/>
    {loading ? <SoccerBallLoader size={40} style={{marginTop: spacing.lg}}/> : loadFailed || !game ? <View style={styles.empty}><Text style={styles.emptyText}>{he.gameLoadError}</Text><Button title="נסה שוב" onPress={() => setRetry(v => v + 1)}/></View> : <FlatList
      data={visible} keyExtractor={u => u.id} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      ListHeaderComponent={header} ListFooterComponent={<>{cursor ? <View style={styles.empty}><Text style={styles.emptyText}>{moreFailed ? 'לא ניתן לטעון שחקנים נוספים כרגע' : 'יש עוד שחקנים לבדיקה'}</Text><Button title={moreFailed ? 'נסה שוב' : 'הצג שחקנים נוספים'} loading={loadingMore} onPress={loadMore}/></View> : null}{footer}</>}
      onEndReached={() => {if (visible.length && !moreFailed) void loadMore();}} onEndReachedThreshold={0.3}
      ListEmptyComponent={<View style={styles.empty}><Ionicons name="people-outline" size={36} color="#8DA6CA"/><Text style={styles.emptyText}>{cursor ? 'החיפוש עדיין לא הושלם' : candidates.length ? 'אין שחקנים שמתאימים לסינון הזה' : he.availablePlayersEmpty}</Text></View>}
      renderItem={({item}) => {
        const sent = invitedIds.has(item.id);
        const playerCity = item.availability?.homeCity || item.availability?.preferredCity;
        return <View style={styles.row}>
          <PlayerIdentity user={item} size={49} onPress={() => nav.navigate('PlayerCard',{userId:item.id,groupId:game.groupId})}/>
          <View style={styles.identity}>
            <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
            {!!playerCity && <Text style={styles.sub} numberOfLines={1}>{playerCity}</Text>}
          </View>
          <Button variant={sent ? 'outline' : 'primary'} title={sent ? 'הזמנה נשלחה' : 'שלח הזמנה'} size="sm" style={sent ? styles.sent : styles.primary} disabled={sent || !!invitingId} loading={invitingId === item.id} onPress={() => invite(item)}/>
        </View>;
      }}/>}
  </SafeAreaView>;
}


const styles = StyleSheet.create({
  root: {flex:1,backgroundColor:'#F3F8FF'},
  list: {padding:16,gap:10},
  intro: {fontSize:14,color:'#6C80A5',textAlign:RTL_LABEL_ALIGN,marginBottom:12},
  summary: {borderRadius:22,borderWidth:1,borderColor:'#DCEAFF',padding:16,gap:10,backgroundColor:'#FFF',overflow:'hidden',marginBottom:12},
  pitch: {position:'absolute',end:-10,top:-14,transform:[{rotate:'-25deg'}]},
  roundTitle: {...typography.h3,color:'#0C1942',textAlign:RTL_LABEL_ALIGN},
  line: {flexDirection:'row',alignItems:'center',gap:8},
  context: {flex:1,fontSize:14,color:'#52688D',textAlign:RTL_LABEL_ALIGN},
  badge: {alignSelf:'flex-start',flexDirection:'row',alignItems:'center',gap:6,paddingVertical:7,paddingHorizontal:12,borderRadius:18,backgroundColor:'#DCF6EB'},
  badgeText: {fontSize:13,fontWeight:'700',color:'#187849'},
  search: {flexDirection:'row',alignItems:'center',gap:8,backgroundColor:'#FFF',paddingHorizontal:12,borderRadius:17,borderWidth:1,borderColor:'#DCEAFF',marginBottom:12},
  input: {flex:1,textAlign:'right',fontSize:15,color:'#12234D',paddingVertical:12},
  filters: {flexDirection:'row',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:4},
  filter: {paddingVertical:9,paddingHorizontal:12,borderRadius:18,backgroundColor:'#E6F0FF',borderWidth:1,borderColor:'#D4E5FC'},
  filterOn: {backgroundColor:'#2D68FF',borderColor:'#2D68FF'},
  filterText: {fontSize:13,color:'#315080'},
  filterOnText: {color:'#FFF'},
  count: {fontSize:12,color:'#7183A2'},
  row: {flexDirection:'row',alignItems:'center',gap:10,padding:13,borderRadius:22,borderWidth:1,borderColor:'#DCEAFF',backgroundColor:'#FFF'},
  identity: {flex:1,gap:4},
  name: {...typography.bodyBold,color:'#0C1942',textAlign:RTL_LABEL_ALIGN},
  sub: {fontSize:13,color:'#667C9E',textAlign:RTL_LABEL_ALIGN},
  primary: {backgroundColor:'#2D68FF',borderColor:'#2D68FF',borderRadius:14},
  sent: {backgroundColor:'#E8EDF5',borderColor:'#E8EDF5',borderRadius:14},
  pulseCard: {padding:16,gap:12,borderRadius:22,borderWidth:1,borderColor:'#CFE3FF',backgroundColor:'#E8F3FF',marginTop:6},
  pulseTitle: {...typography.h3,color:'#0C1942',flex:1,textAlign:RTL_LABEL_ALIGN},
  pulseExplain: {fontSize:14,lineHeight:21,color:'#52688D',textAlign:RTL_LABEL_ALIGN},
  disclaimer: {fontSize:11,color:'#667C9E',textAlign:'center'},
  empty: {padding:24,gap:14,alignItems:'center',justifyContent:'center'},
  emptyText: {...typography.body,color:colors.textMuted,textAlign:'center'},
});
