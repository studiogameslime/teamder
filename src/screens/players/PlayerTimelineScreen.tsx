import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Line, Rect } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { RouteProp, useFocusEffect, useRoute } from '@react-navigation/native';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/EmptyState';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { UserAvatar } from '@/components/UserAvatar';
import { appAlert } from '@/components/AppDialog';
import { toast } from '@/components/Toast';
import { communityEventsService, groupService } from '@/services';
import { logError } from '@/services/errorLog';
import { useUserStore } from '@/store/userStore';
import { cardState, effectiveExpiry, DAY_MS } from '@/utils/cardState';
import { formatTime } from '@/utils/format';
import { playerTimelineView, type PlayerTimelineEntry, type PlayerTimelineFilter } from '@/utils/playerTimelineView';
import { RefereeCard, CARD_YELLOW, CARD_RED } from '@/components/community/CardCountBadges';
import { successHaptic } from '@/utils/haptics';
import { colors, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { CommunityPlayerEvent, Group, User } from '@/types';
import type { CommunitiesStackParamList } from '@/navigation/CommunitiesStack';
type Params = RouteProp<CommunitiesStackParamList, 'PlayerTimeline'>;
const META: Record<CommunityPlayerEvent['type'], {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  color: string;
}> = {
  yellow: {
    icon: 'card-outline',
    title: he.timelineEventYellow,
    color: CARD_YELLOW
  },
  red: {
    icon: 'card-outline',
    title: he.timelineEventRed,
    color: CARD_RED
  },
  ball: {
    icon: 'football-outline',
    title: he.timelineEventBall,
    color: '#2463FF'
  },
  jerseys: {
    icon: 'shirt',
    title: he.timelineEventJerseys,
    color: '#2463FF'
  }
};
const FILTERS: {
  id: PlayerTimelineFilter;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
}[] = [{
  id: 'all',
  label: 'הכול'
}, {
  id: 'cards',
  label: 'כרטיסים',
  icon: 'card-outline'
}, {
  id: 'equipment',
  label: 'ציוד',
  icon: 'shirt-outline'
}];
function dateLabel(at: number) {
  return new Date(at).toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric'
  });
}
function expiryLabel(ev: CommunityPlayerEvent, validity: number | null | undefined, now: number) {
  const exp = effectiveExpiry(ev, validity);
  if (exp === null || ev.revoked) return null;
  if (cardState(ev, validity, now) === 'expired') return he.cardExpiredOn(dateLabel(exp));
  const start = (value: number) => {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };
  const days = Math.round((start(exp) - start(now)) / DAY_MS);
  return `${he.cardValidUntil(dateLabel(exp))} · ${he.cardDaysLeft(days)}`;
}
export function PlayerTimelineScreen() {
  const {
    userId,
    groupId,
    name
  } = useRoute<Params>().params;
  const me = useUserStore(s => s.currentUser);
  const [group, setGroup] = useState<Group | null>(null);
  const [player, setPlayer] = useState<User | null>(null);
  const [actors, setActors] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<CommunityPlayerEvent[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<PlayerTimelineFilter>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const requestVersion = useRef(0);
  const actionLock = useRef(false);
  const {
    width,
    fontScale
  } = useWindowDimensions();
  const stacked = width < 360 || fontScale > 1.2;
  const reload = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const [nextGroup, nextEvents] = await Promise.all([groupService.get(groupId), communityEventsService.getPlayerTimeline(groupId, userId)]);
      if (version !== requestVersion.current) return;
      setGroup(nextGroup);
      setEvents(nextEvents);
      setNow(Date.now());
      setFailed(false);
      if (nextGroup?.cardsEnabled !== true) setFilter(previous => previous === 'cards' ? 'all' : previous);
      const ids = [...new Set([userId, ...nextEvents.flatMap(ev => [ev.issuedBy, ev.revokedBy].filter((id): id is string => !!id))])];
      // Identity-only batch: avatar and actor names use the existing allowed reader.
      void groupService.hydrateUsers(ids).then(users => {
        if (version !== requestVersion.current) return;
        setPlayer(users.find(u => u.id === userId) ?? null);
        setActors(Object.fromEntries(users.map(u => [u.id, u.name])));
      }).catch(err => logError('playerTimelineIdentity', err, {
        groupId,
        userId
      }));
    } catch (err) {
      if (version !== requestVersion.current) return;
      setFailed(true);
      logError('playerTimelineLoad', err, {
        groupId,
        userId
      });
    } finally {
      if (version === requestVersion.current) setRefreshing(false);
    }
  }, [groupId, userId]);
  useFocusEffect(useCallback(() => {
    void reload();
    return () => {
      requestVersion.current += 1;
    };
  }, [reload]));
  const model = useMemo(() => group ? playerTimelineView(events ?? [], group, userId, filter, now) : {
    entries: [],
    equipmentCount: 0,
    activeCards: 0
  }, [events, group, userId, filter, now]);
  const isAdmin = !!me && !!group?.adminIds.includes(me.id);
  const displayName = player?.name || name || 'השחקן';
  const joinedAt = group?.joinedAt?.[userId];
  const revoke = (ev: CommunityPlayerEvent) => {
    if (!isAdmin || !me || ev.revoked || actionLock.current) return;
    appAlert(he.cardRevokeConfirmTitle, he.cardRevokeConfirmBody, [{
      text: he.cancel,
      style: 'cancel'
    }, {
      text: he.cardRevoke,
      style: 'destructive',
      onPress: async () => {
        if (actionLock.current) return;
        actionLock.current = true;
        setBusy(ev.id);
        try {
          await communityEventsService.revokeCard(ev.id, me.id);
          successHaptic();
          toast.success(he.cardRevokedToast);
          await reload();
        } catch (err) {
          logError('revokeCardAction', err, {
            id: ev.id
          });
          toast.error('לא ניתן לבטל את הכרטיס. נסו שוב');
        } finally {
          actionLock.current = false;
          setBusy(null);
        }
      }
    }]);
  };
  if (events === null && !failed) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="ציר הזמן" /><View style={styles.center}><SoccerBallLoader /></View></SafeAreaView>;
  const error = <Pressable accessibilityRole="button" onPress={() => void reload()} style={styles.error}><Text style={styles.errorText}>לא ניתן לטעון את ציר הזמן. לחצו לניסיון חוזר</Text><Ionicons name="refresh-outline" size={18} color="#A33C24" /></Pressable>;
  if (!group) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="ציר הזמן" />{failed ? error : <EmptyState icon="information-circle-outline" title="המועדון אינו זמין" hint="חזרו למועדון ונסו שוב" />}</SafeAreaView>;
  return <SafeAreaView style={styles.safe} edges={['top']}>
    <ScreenHeader title={`ההיסטוריה של ${displayName}`} />
    <FlatList data={model.entries} keyExtractor={item => item.key} contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => {
      setRefreshing(true);
      void reload();
    }} tintColor={colors.primary} />} ListHeaderComponent={<>
        <LinearGradient colors={['#FFFFFF', '#F0F7FF']} start={{
        x: 1,
        y: 0
      }} end={{
        x: 0,
        y: 1
      }} style={styles.hero}>
          <View pointerEvents="none" style={styles.pitch}><Svg width={115} height={125} viewBox="0 0 115 125"><Rect x={5} y={5} width={105} height={115} rx={4} fill="none" stroke="#D8E8FF" /><Line x1={5} y1={62} x2={110} y2={62} stroke="#D8E8FF" /><Circle cx={57} cy={62} r={18} fill="none" stroke="#D8E8FF" /><Rect x={28} y={5} width={58} height={22} fill="none" stroke="#D8E8FF" /></Svg></View>
          <View style={styles.playerRow}>
            <UserAvatar user={player ?? {
            id: userId,
            name: displayName
          }} size={78} ring />
            <View style={styles.playerInfo}>
              <Text style={styles.playerName}>{displayName}</Text>
              <View style={styles.heroLine}><Ionicons name="people-outline" size={16} color="#51709E" /><Text style={styles.clubName}>{group.name}</Text></View>
              {typeof joinedAt === 'number' && joinedAt > 0 ? <View style={styles.heroLine}><Ionicons name="calendar-outline" size={16} color="#6C82A5" /><Text style={styles.joined}>חבר מאז {dateLabel(joinedAt)}</Text></View> : null}
            </View>
          </View>
          <View style={styles.summaries}>
            <View style={[styles.summary, styles.equipmentSummary]}><Text style={styles.equipmentText}>{model.equipmentCount} אירועי ציוד</Text><Ionicons name="shirt-outline" size={17} color="#2463FF" /></View>
            {group.cardsEnabled === true ? <View style={[styles.summary, styles.cardsSummary]}><Text style={styles.cardsText}>{model.activeCards} כרטיסים פעילים</Text><Ionicons name="card-outline" size={17} color="#227752" /></View> : null}
          </View>
        </LinearGradient>
        <View style={styles.filters}>{FILTERS.filter(f => f.id !== 'cards' || group.cardsEnabled === true).map(f => <Pressable key={f.id} accessibilityRole="button" accessibilityState={{
          selected: filter === f.id
        }} onPress={() => setFilter(f.id)} style={[styles.filter, filter === f.id && styles.selectedFilter]}><Text style={[styles.filterText, filter === f.id && styles.selectedText]}>{f.label}</Text>{f.icon ? <Ionicons name={f.icon} size={17} color={filter === f.id ? 'white' : '#496B9B'} /> : null}</Pressable>)}</View>
        {failed ? error : null}
        {events && events.length >= 200 ? <Text style={styles.limit}>מוצגים עד 200 האירועים האחרונים; הסיכום מתייחס לאירועים המוצגים</Text> : null}
      </>} ListEmptyComponent={!failed ? <EmptyState fill={false} icon="time-outline" title={filter === 'all' ? he.timelineEmpty : filter === 'cards' ? 'אין אירועי כרטיסים בציר הזה' : 'אין אירועי ציוד בציר הזה'} /> : null} renderItem={({
      item,
      index
    }) => <TimelineEvent entry={item} group={group} actors={actors} now={now} last={index === model.entries.length - 1} stacked={stacked} canManage={isAdmin} busy={busy} onRevoke={revoke} />} />
  </SafeAreaView>;
}
function TimelineEvent({
  entry,
  group,
  actors,
  now,
  last,
  stacked,
  canManage,
  busy,
  onRevoke
}: {
  entry: PlayerTimelineEntry;
  group: Group;
  actors: Record<string, string>;
  now: number;
  last: boolean;
  stacked: boolean;
  canManage: boolean;
  busy: string | null;
  onRevoke: (ev: CommunityPlayerEvent) => void;
}) {
  const ev = entry.kind === 'event' ? entry.event : null;
  const card = ev?.type === 'red' || ev?.type === 'yellow';
  const validity = ev?.type === 'red' ? group.redCardValidityDays : group.yellowCardValidityDays;
  const state = card && ev ? cardState(ev, validity, now) : 'active';
  const inactive = state !== 'active';
  const meta = ev ? META[ev.type] : {
    title: he.timelineBecameAdmin,
    color: '#2463FF',
    icon: 'shield-checkmark-outline' as const
  };
  const title = ev?.returned && ev.type === 'ball' ? he.timelineEventBallReturned : ev?.returned && ev.type === 'jerseys' ? he.timelineEventJerseysReturned : meta.title;
  const validityText = card && ev ? expiryLabel(ev, validity, now) : null;
  const actor = ev?.issuedBy ? actors[ev.issuedBy] : undefined;
  const revoker = ev?.revokedBy ? actors[ev.revokedBy] : undefined;
  const canRevoke = !!ev && card && canManage && !ev.revoked;
  const tone = card && !inactive ? ev?.type === 'red' ? styles.redCard : styles.yellowCard : null;
  return <View style={styles.eventRow}>
    <Pressable onLongPress={canRevoke ? () => onRevoke(ev!) : undefined} delayLongPress={400} style={[styles.eventCard, tone]}>
      <View style={[styles.eventMain, stacked && styles.stacked]}>
        <View style={[styles.eventHeading, stacked && styles.stackedContent]}>
          <Text style={[styles.eventTitle, inactive && styles.muted]}>{title}</Text>
          <Text style={styles.meta}>{dateLabel(entry.at)} · {formatTime(entry.at)}</Text>
          {actor ? <Text style={styles.meta}>עודכן על ידי {actor}</Text> : null}
          {inactive ? <Text style={styles.status}>{state === 'revoked' ? he.cardStateRevoked : he.cardStateExpired}</Text> : null}
        </View>
        {ev?.detail ? <Text style={[styles.detail, stacked && styles.stackedContent, inactive && styles.muted]}>{ev.detail}</Text> : null}
      </View>
      {validityText ? <View style={styles.inline}><Text style={[styles.validity, state === 'expired' && styles.muted]}>{validityText}</Text><Ionicons name="hourglass-outline" size={13} color="#6C82A5" /></View> : null}
      {ev?.revoked && ev.revokedAt ? <Text style={styles.meta}>בוטל ב־{dateLabel(ev.revokedAt)}{revoker ? ` · על ידי ${revoker}` : ''}</Text> : null}
      {canRevoke && state === 'active' ? <Pressable disabled={busy !== null} accessibilityRole="button" accessibilityLabel={he.cardRevoke} onPress={() => onRevoke(ev!)} style={styles.revoke}><Text style={styles.revokeText}>{he.cardRevoke}</Text>{busy === ev?.id ? <ActivityIndicator size="small" color={colors.danger} /> : <Ionicons name="close-circle-outline" size={15} color={colors.danger} />}</Pressable> : null}
    </Pressable>
    {/* Text precedes the rail, putting every event icon on the visual left. */}
    <View style={styles.rail}>
      {!last ? <View style={styles.railLine} /> : null}
      <View style={[styles.node, {
        borderColor: card ? meta.color + '60' : '#C5DCFF',
        backgroundColor: card && !inactive ? ev?.type === 'red' ? '#FFF0EF' : '#FFF8DF' : '#F8FBFF'
      }]}>
        {card ? <RefereeCard color={meta.color} w={17} h={24} struck={inactive} /> : <Ionicons name={meta.icon} size={23} color={meta.color} />}
      </View>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F3F7FE'
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 28
  },
  hero: {
    padding: 16,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#DCE9FB',
    overflow: 'hidden',
    marginBottom: 17
  },
  pitch: {
    position: 'absolute',
    right: -16,
    top: -18,
    opacity: 0.75,
    transform: [{
      rotate: '-18deg'
    }]
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13
  },
  playerInfo: {
    flex: 1,
    minWidth: 0
  },
  playerName: {
    fontSize: 23,
    lineHeight: 30,
    fontWeight: '800',
    color: '#142340',
    textAlign: RTL_LABEL_ALIGN
  },
  heroLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 5
  },
  clubName: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: '#51709E',
    flex: 1,
    textAlign: RTL_LABEL_ALIGN
  },
  joined: {
    fontSize: 12,
    lineHeight: 18,
    color: '#6C82A5',
    flex: 1,
    textAlign: RTL_LABEL_ALIGN
  },
  summaries: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
    flexWrap: 'wrap'
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 20
  },
  equipmentSummary: {
    backgroundColor: '#E5F0FF'
  },
  cardsSummary: {
    backgroundColor: '#E4F5EE'
  },
  equipmentText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
    color: '#234E93'
  },
  cardsText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
    color: '#236A50'
  },
  filters: {
    flexDirection: 'row',
    gap: 9,
    marginBottom: 16
  },
  filter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 43,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: '#D7E5F8',
    paddingHorizontal: 8,
    paddingVertical: 9,
    backgroundColor: '#F8FBFF'
  },
  selectedFilter: {
    backgroundColor: '#2463FF',
    borderColor: '#2463FF'
  },
  filterText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    color: '#496B9B'
  },
  selectedText: {
    color: 'white'
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10
  },
  eventCard: {
    flex: 1,
    minWidth: 0,
    padding: 13,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#DFEAF9',
    backgroundColor: 'white',
    marginBottom: 12,
    shadowColor: '#294C82',
    shadowOffset: {
      width: 0,
      height: 3
    },
    shadowRadius: 8,
    shadowOpacity: 0.04,
    elevation: 1
  },
  eventMain: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12
  },
  stacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 6
  },
  stackedContent: {
    flex: 0,
    width: '100%'
  },
  eventHeading: {
    flex: 1,
    minWidth: 0
  },
  eventTitle: {
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '800',
    color: '#142340',
    textAlign: RTL_LABEL_ALIGN
  },
  meta: {
    fontSize: 11,
    lineHeight: 17,
    color: '#6C82A5',
    textAlign: RTL_LABEL_ALIGN,
    marginTop: 3
  },
  detail: {
    flex: 1,
    fontSize: 13,
    lineHeight: 21,
    color: '#4F6587',
    textAlign: RTL_LABEL_ALIGN
  },
  muted: {
    color: '#8292AC'
  },
  yellowCard: {
    backgroundColor: '#FFFBF1',
    borderColor: '#FBE2A0'
  },
  redCard: {
    backgroundColor: '#FFF6F5',
    borderColor: '#F7CECA'
  },
  status: {
    fontSize: 11,
    lineHeight: 17,
    color: '#687C9E',
    fontWeight: '700',
    marginTop: 3
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 7
  },
  validity: {
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 17,
    color: '#6C82A5',
    textAlign: RTL_LABEL_ALIGN
  },
  revoke: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    minHeight: 36,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: '#FCEDEA',
    marginTop: 8
  },
  revokeText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
    color: colors.danger
  },
  rail: {
    width: 38,
    alignItems: 'center',
    paddingTop: 19
  },
  railLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1.5,
    backgroundColor: '#C9DEFA'
  },
  node: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFF0ED',
    padding: 13,
    borderRadius: 14,
    margin: 12
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 20,
    color: '#A33C24',
    textAlign: RTL_LABEL_ALIGN
  },
  limit: {
    fontSize: 11,
    lineHeight: 17,
    color: '#6C82A5',
    textAlign: RTL_LABEL_ALIGN,
    marginBottom: 10
  }
});
