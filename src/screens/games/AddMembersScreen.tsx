import { observeCaughtError } from '../../utils/errorObservation';
// AddMembersScreen — admin-only "register members from the community" picker.
// Lists the game's community members who AREN'T already in the roster and lets
// the admin register several at once straight into the game (server-side
// adminAddPlayers → players, overflowing to waitlist). Each gets a push.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import Svg, { Rect, Line, Circle } from 'react-native-svg';
import { formatDayDate, formatTime } from '@/utils/format';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';
import { UserAvatar } from '@/components/UserAvatar';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { userService } from '@/services';
import { gameService } from '@/services/gameService';
import { logError } from '@/services/errorLog';
import { toast } from '@/components/Toast';
import type { Game, User } from '@/types';
import { activeGuestCount } from '@/types';
import { typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { selectionHaptic } from '@/utils/haptics';

type RouteParams = { AddMembers: { gameId: string; reserve?: boolean } };

export function AddMembersScreen() {
  const route = useRoute<RouteProp<RouteParams, 'AddMembers'>>();
  const nav = useNavigation<any>();
  const { gameId } = route.params;
  // "Reserve" mode = the same picker opened on a not-yet-open (scheduled) game,
  // where the admin pre-secures spots for chosen regulars before registration
  // opens. Only the copy changes; the server op (adminAddPlayers) is identical.
  const reserve = route.params.reserve === true;
  const me = useUserStore((s) => s.currentUser);
  const myCommunities = useGroupStore((s) => s.groups);

  const [game, setGame] = useState<Game | null>(null);
  const [members, setMembers] = useState<User[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const [query, setQuery] = useState('');
  const [availableIds, setAvailableIds] = useState<Set<string>>(new Set());
  const filteredMembers = useMemo(() => members.filter(u => u.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [members, query]);

  useEffect(() => {
    if (!gameId || !me) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const g = await gameService.getGameById(gameId).catch((caughtError236c7003ab: unknown) => { observeCaughtError(caughtError236c7003ab, {"source":"src/screens/games/AddMembersScreen.tsx","handler":"AddMembersScreen","site":"AddMembersScreen:236c7003ab"}); return null; });
        if (!alive) return;
        setGame(g);
        if (!g) {
          setMembers([]);
          return;
        }
        const grp = myCommunities.find((c) => c.id === g.groupId);
        const memberIds = Array.from(
          new Set([...(grp?.playerIds ?? []), ...(grp?.adminIds ?? [])]),
        );
        // Exclude anyone already in the roster (players/waitlist/pending).
        // Normally we also hide the admin themselves ("למה אני מופיע פה?"), but
        // in RESERVE mode (before registration opens) the admin has no normal
        // way to join yet, so they must be able to reserve their OWN spot too —
        // keep self in the list there.
        const inRoster = new Set([
          ...(g.players ?? []),
          ...(g.waitlist ?? []),
          ...(g.pending ?? []),
        ]);
        const toLoad = memberIds.filter(
          (id) => !inRoster.has(id) && (reserve || id !== me?.id),
        );
        const profiles = await Promise.all(
          toLoad.map((id) => userService.getUserById(id).catch((caughtError591865f3c0: unknown) => { observeCaughtError(caughtError591865f3c0, {"source":"src/screens/games/AddMembersScreen.tsx","handler":"AddMembersScreen","site":"AddMembersScreen:591865f3c0"}); return null; })),
        );
        if (!alive) return;
        setMembers(
          profiles.filter((u): u is User => !!u).sort((a, b) => a.name.localeCompare(b.name, 'he')),
        );
      } catch (err) {
    observeCaughtError(err, {"source":"src/screens/games/AddMembersScreen.tsx","handler":"AddMembersScreen","site":"AddMembersScreen:31cd171528"});
        logError('AddMembersScreen.load', err, { gameId });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [gameId, me, myCommunities]);

  // Only server-confirmed matches receive an availability badge. A failed or
  // capped lookup leaves the badge absent; it never claims unavailability.
  useEffect(() => {
    let alive = true;
    setAvailableIds(new Set());
    if (!game) return;
    userService.findAvailablePlayers({ gameId: game.id, day: new Date(game.startsAt).getDay(), excludeIds: [] })
      .then(users => { if (alive) setAvailableIds(new Set(users.map(u => u.id))); })
      .catch(err => { observeCaughtError(err, {"source":"src/screens/games/AddMembersScreen.tsx","handler":"AddMembersScreen","site":"AddMembersScreen:5b29fb8d16"}); return logError('AddMembersScreen.availability', err, { gameId }); });
    return () => { alive = false; };
  }, [game?.id, game?.startsAt]);

  const spotsLeft = useMemo(() => {
    if (!game || !game.maxPlayers) return Infinity;
    // Real remaining roster spots = cap − players − active guests − a held
    // promotion offer (all of which occupy a seat), matching the server.
    return Math.max(
      0,
      game.maxPlayers -
        (game.players?.length ?? 0) -
        activeGuestCount(game.guests) -
        (game.pendingPromotion?.uid ? 1 : 0),
    );
  }, [game]);

  const toggle = (id: string) => {
    if (inFlight.current) return;
    // In RESERVE mode (scheduled game, before registration opens) don't let the
    // admin pick more than the free spots — reserving into the waitlist would
    // fire a confusing "you're on the waitlist" push before the doors open.
    if (reserve && !selected.has(id) && selected.size >= spotsLeft) {
      toast.info(he.reserveSpotsCapReached(spotsLeft));
      return;
    }
    selectionHaptic();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onSubmit = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0 || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      const res = await gameService.adminAddMembers(gameId, ids);
      const total = res.addedToPlayers + res.addedToWaitlist;
      if (total === 0) {
        toast.info(he.addMembersNoneAdded);
      } else if (res.addedToWaitlist > 0) {
        toast.success(he.addMembersDoneWaitlist(res.addedToPlayers, res.addedToWaitlist));
      } else {
        toast.success(
          reserve ? he.reserveSpotsDone(res.addedToPlayers) : he.addMembersDone(res.addedToPlayers),
        );
      }
      if (nav.canGoBack()) nav.goBack();
    } catch (err) {
    observeCaughtError(err, {"source":"src/screens/games/AddMembersScreen.tsx","handler":"onSubmit","site":"AddMembersScreen:4e5935c0a6"});
      logError('AddMembersScreen.submit', err, { gameId });
      toast.error(he.addMembersError);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const occupied = (game?.players?.length ?? 0) + activeGuestCount(game?.guests);
  const projected = occupied + Math.min(selected.size, spotsLeft);
  const waiting = Math.max(0, selected.size - spotsLeft);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title={reserve ? he.reserveSpotsTitle : 'הוספת שחקנים למחזור'} />
      {loading ? <View style={styles.center}><SoccerBallLoader /></View> : (
        <>
          {game && <View style={styles.summary}>
            <View pointerEvents="none" style={styles.pitch} accessible={false}>
              <Svg width={140} height={100} viewBox="0 0 140 100">
                <Rect x={4} y={4} width={132} height={92} fill="none" stroke="#D4E6FD" strokeWidth={1.5} />
                <Line x1={70} y1={4} x2={70} y2={96} stroke="#D4E6FD" strokeWidth={1.5} />
                <Circle cx={70} cy={50} r={19} fill="none" stroke="#D4E6FD" strokeWidth={1.5} />
                <Rect x={4} y={30} width={20} height={40} fill="none" stroke="#D4E6FD" strokeWidth={1.5} />
                <Rect x={116} y={30} width={20} height={40} fill="none" stroke="#D4E6FD" strokeWidth={1.5} />
              </Svg>
            </View>
            <View style={styles.summaryTop}>
              <View style={styles.calendar}><Ionicons name="calendar-outline" size={27} color="#12234D" /></View>
              <View style={styles.identity}>
                <Text style={styles.title} numberOfLines={2}>{game.title}</Text>
                <Text style={styles.date}>{formatDayDate(game.startsAt)} · {formatTime(game.startsAt)}</Text>
              </View>
            </View>
            <View style={styles.chips}>
              <View style={styles.chip}><Ionicons name="people" size={15} color="#315AAF" /><Text style={styles.chipText}>{game.maxPlayers ? `${occupied} מתוך ${game.maxPlayers} רשומים` : `${occupied} רשומים`}</Text></View>
              <View style={[styles.chip, styles.green]}><Text style={styles.greenText}>{Number.isFinite(spotsLeft) ? `${spotsLeft} מקומות פנויים` : 'ללא הגבלה'}</Text></View>
              <View style={styles.chip}><Ionicons name="checkmark-circle" size={15} color="#2D68FF" /><Text style={styles.chipText}>{selected.size} נבחרו</Text></View>
            </View>
          </View>}
          <View style={styles.search}>
            <Ionicons name="search-outline" size={23} color="#6C80A5" />
            <TextInput value={query} onChangeText={setQuery} placeholder="חיפוש חברי מועדון" placeholderTextColor="#7284A5" style={styles.input} accessibilityLabel="חיפוש חברי מועדון" />
            {!!query && <Pressable onPress={() => setQuery('')} accessibilityLabel="נקה חיפוש" hitSlop={12}><Ionicons name="close-circle" size={20} color="#7284A5" /></Pressable>}
          </View>
          <FlatList
            data={filteredMembers}
            keyExtractor={u => u.id}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={styles.list}
            ListEmptyComponent={<EmptyState icon="people-outline" title={query ? 'לא נמצאו חברים בחיפוש הזה' : he.addMembersEmpty} />}
            renderItem={({ item }) => {
              const on = selected.has(item.id);
              return <Pressable style={styles.row} onPress={() => toggle(item.id)} disabled={submitting} accessibilityRole="checkbox" accessibilityLabel={item.name} accessibilityState={{ checked: on, disabled: submitting }}>
                <UserAvatar user={item} size={42} />
                <View style={styles.identity}>
                  <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                  {availableIds.has(item.id) && <View style={styles.available}><Text style={styles.greenText}>זמין במועד המחזור</Text></View>}
                </View>
                <View style={[styles.check, on && styles.checkOn]}>{on && <Ionicons name="checkmark" size={20} color="#FFFFFF" />}</View>
              </Pressable>;
            }}
          />
          <View style={styles.footer}>
            <View style={styles.info}><Ionicons name="information-circle-outline" size={23} color="#2D68FF" /><Text style={styles.infoText}>{reserve ? 'אפשר לשריין מקומות עד למילוי ההרכב.' : 'כשההרכב מלא, שחקנים נוספים נכנסים להמתנה.'}</Text></View>
            <Button title={selected.size ? reserve ? he.reserveSpotsSubmit(selected.size) : `הוסף ${selected.size} שחקנים` : he.addMembersSubmitEmpty} variant="primary" size="lg" fullWidth style={styles.submit} disabled={!selected.size || submitting} loading={submitting} onPress={onSubmit} />
            {selected.size > 0 && <Text style={styles.projection}>{waiting > 0 ? `צפויים להתווסף: ${selected.size - waiting} להרכב · ${waiting} להמתנה` : `לאחר ההוספה: ${projected}${game?.maxPlayers ? ` מתוך ${game.maxPlayers}` : ' רשומים'}`}</Text>}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F3F8FF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  summary: { marginHorizontal: 16, marginTop: 8, marginBottom: 12, padding: 14, borderRadius: 22, backgroundColor: '#EEF6FF', borderWidth: 1, borderColor: '#D6E7FD', overflow: 'hidden' },
  pitch: { position: 'absolute', end: -15, top: -28, transform: [{ rotate: '-22deg' }] },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  calendar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#E1EEFF', alignItems: 'center', justifyContent: 'center' },
  identity: { flex: 1, gap: 4 },
  title: { ...typography.h3, color: '#0C1942', textAlign: RTL_LABEL_ALIGN },
  date: { fontSize: 14, color: '#53688F', textAlign: RTL_LABEL_ALIGN },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 16, backgroundColor: '#DFEDFF' },
  chipText: { fontSize: 12, color: '#315AAF' },
  green: { backgroundColor: '#DDF8EC' },
  greenText: { fontSize: 12, color: '#15813E' },
  search: { marginHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#DFEAF8', borderRadius: 18, paddingHorizontal: 15, minHeight: 50 },
  input: { flex: 1, fontSize: 16, color: '#12234D', textAlign: 'right', paddingVertical: 12 },
  list: { padding: 16, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 13, paddingVertical: 10, minHeight: 66, borderRadius: 20, borderWidth: 1, borderColor: '#DFEAF8', backgroundColor: '#FFFFFF' },
  name: { ...typography.bodyBold, color: '#0C1942', textAlign: RTL_LABEL_ALIGN },
  check: { width: 25, height: 25, borderRadius: 6, borderWidth: 1.5, borderColor: '#A5B6D2', alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: '#2D68FF', borderColor: '#2D68FF' },
  available: { alignSelf: 'flex-start', backgroundColor: '#DDF8EC', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  submit: { backgroundColor: '#2D68FF', borderColor: '#2D68FF', borderRadius: 18 },
  footer: { paddingHorizontal: 16, paddingBottom: 10, gap: 9 },
  info: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#E6F1FF', borderWidth: 1, borderColor: '#B9D6FF', padding: 11, borderRadius: 16 },
  infoText: { flex: 1, fontSize: 13, color: '#233966', textAlign: RTL_LABEL_ALIGN },
  projection: { textAlign: 'center', color: '#6C80A5', fontSize: 12 },
});

