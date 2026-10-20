import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, FlatList, RefreshControl, ScrollView, StyleSheet } from 'react-native';
import Animated, { FadeOut, LinearTransition } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Line, Rect } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/EmptyState';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { Avatar } from '@/components/Avatar';
import { SafeModal } from '@/components/SafeModal';
import { appAlert } from '@/components/AppDialog';
import { toast } from '@/components/Toast';
import { useReducedMotion } from '@/hooks/animations/useReducedMotion';
import { successHaptic } from '@/utils/haptics';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { friendsService } from '@/services/friendsService';
import { groupService } from '@/services/groupService';
import { gameService } from '@/services/gameService';
import { getInboxRequests, approveAllFriends, approveAllForGroup, approveAllForGame, type InboxRequests } from '@/services/requestsService';
import { requestInboxRows, type InboxRow } from '@/utils/requestInboxView';
import { logError } from '@/services/errorLog';
import { colors, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
const EMPTY: InboxRequests = {
  friends: [],
  communities: [],
  games: [],
  total: 0
};
export function RequestsScreen() {
  const nav = useNavigation<any>();
  const route = useRoute();
  const initialGroupId = (route.params as {
    groupId?: string;
  } | undefined)?.groupId;
  const me = useUserStore(s => s.currentUser);
  const groups = useGroupStore(s => s.groups);
  const [groupId, setGroupId] = useState(initialGroupId);
  const [byName, setByName] = useState(false);
  const [picker, setPicker] = useState<'club' | 'sort' | null>(null);
  const [data, setData] = useState<InboxRequests>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const actionLock = useRef(false);
  const loadVersion = useRef(0);
  useEffect(() => {
    setGroupId(initialGroupId);
  }, [initialGroupId, route.key]);
  const load = useCallback(async () => {
    if (!me) return;
    const version = ++loadVersion.current;
    try {
      const next = await getInboxRequests(me.id);
      if (version !== loadVersion.current) return;
      setData(next);
      setLoadFailed(false);
    } catch (err) {
      if (version !== loadVersion.current) return;
      setLoadFailed(true);
      logError('RequestsScreen.load', err, {
        uid: me.id
      });
    } finally {
      if (version === loadVersion.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [me?.id]);
  useFocusEffect(useCallback(() => {
    void load();
    return () => {
      loadVersion.current += 1;
    };
  }, [load]));
  const rows = useMemo(() => requestInboxRows(data, groupId, byName), [data, groupId, byName]);
  const clubs = useMemo(() => {
    const map = new Map(groups.filter(g => me && g.adminIds.includes(me.id)).map(g => [g.id, g.name]));
    data.communities.forEach(({
      group
    }) => map.set(group.id, group.name));
    // A managed round can belong to a club the organizer does not administer.
    data.games.forEach(({
      game
    }) => {
      if (game.groupId && !map.has(game.groupId)) map.set(game.groupId, groups.find(g => g.id === game.groupId)?.name ?? 'מועדון המחזור');
    });
    if (groupId && !map.has(groupId)) map.set(groupId, 'המועדון שנבחר');
    return [...map].map(([id, name]) => ({
      id,
      name
    }));
  }, [groups, data, me?.id, groupId]);
  const selectedClub = clubs.find(c => c.id === groupId)?.name;
  const act = async (row: InboxRow, approve: boolean) => {
    if (!me || actionLock.current) return;
    actionLock.current = true;
    setBusy(row.key);
    try {
      if (row.kind === 'friend') {
        if (approve) await friendsService.acceptRequest(row.userId, me.id);else await friendsService.declineRequest(row.userId, me.id);
      } else if (row.kind === 'club') {
        const store = useGroupStore.getState();
        if (store.groups.some(g => g.id === row.targetId)) {
          // Keep the existing club flow's cache, analytics and achievements.
          if (approve) await store.approveMember(row.targetId, row.userId);
          else await store.rejectMember(row.targetId, row.userId);
        } else {
          // The inbox can load a club before the store has hydrated it.
          if (approve) await groupService.approveMember(row.targetId, row.userId);
          else await groupService.rejectMember(row.targetId, row.userId);
        }
      } else if (approve) {
        const result = await gameService.approveGameJoin(row.targetId, row.userId);
        if (result?.bucket === 'waitlist') toast.info(he.requestsApprovedToWaitlist);
      } else await gameService.rejectGameJoin(row.targetId, row.userId);
      successHaptic();
      await load();
    } catch (err) {
      logError('RequestsScreen.act', err, {
        key: row.key
      });
      const full = (err as {
        code?: string;
      })?.code === 'GROUP_FULL';
      appAlert(he.error, full ? he.toastApproveGroupFull : he.requestsActionFailed);
    } finally {
      actionLock.current = false;
      setBusy(null);
    }
  };
  // Preserve the existing per-target bulk action, with an explicit confirmation.
  const approveTarget = (row: InboxRow) => {
    const targetRows = rows.filter(r => r.kind === row.kind && r.targetId === row.targetId);
    appAlert(he.requestsApproveAllConfirmTitle, he.requestsApproveAllConfirmBody(targetRows.length), [{
      text: he.cancel,
      style: 'cancel'
    }, {
      text: he.requestsApproveAll,
      onPress: async () => {
        if (!me || actionLock.current) return;
        actionLock.current = true;
        setBusy(`all:${row.kind}:${row.targetId}`);
        try {
          const ids = targetRows.map(r => r.userId);
          const result = row.kind === 'friend' ? await approveAllFriends(me.id, data.friends) : row.kind === 'club' ? await approveAllForGroup(row.targetId, ids) : await approveAllForGame(row.targetId, ids);
          toast.success(result.failed ? he.requestsPartial(result.ok, result.failed) : he.requestsApprovedToast(result.ok));
          if (row.kind === 'club') await useGroupStore.getState().hydrate(me.id);
          await load();
        } catch (err) {
          logError('RequestsScreen.approveAll', err);
          appAlert(he.error, he.requestsActionFailed);
        } finally {
          actionLock.current = false;
          setBusy(null);
        }
      }
    }]);
  };
  const openProfile = (row: InboxRow) => nav.navigate('PlayerCard', {
    userId: row.userId,
    ...(row.groupId ? {
      groupId: row.groupId
    } : {})
  });
  if (!me) return null;
  return <SafeAreaView style={styles.safe} edges={['top']}>
    <ScreenHeader title="בקשות הצטרפות" />
    {loading ? <View style={styles.center}><SoccerBallLoader /></View> : <FlatList data={rows} keyExtractor={row => row.key} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => {
      setRefreshing(true);
      void load();
    }} tintColor={colors.primary} />} ListHeaderComponent={<>
        <LinearGradient colors={['#F0F7FF', '#E7F1FF']} start={{
        x: 1,
        y: 0
      }} end={{
        x: 0,
        y: 1
      }} style={styles.hero}>
          <View pointerEvents="none" style={styles.pitch}><Svg width={130} height={110} viewBox="0 0 130 110"><Rect x={5} y={5} width={120} height={100} rx={5} fill="none" stroke="#C4DCFF" /><Line x1={5} y1={55} x2={125} y2={55} stroke="#C4DCFF" /><Circle cx={65} cy={55} r={18} fill="none" stroke="#C4DCFF" /><Rect x={38} y={5} width={54} height={18} fill="none" stroke="#C4DCFF" /></Svg></View>
          <Text style={styles.heroTitle}>נכנסים לקבוצה</Text>
          <Text style={styles.heroHint}>מאשרים שחקנים וממשיכים לשחק יחד</Text>
          <View style={styles.count}><Ionicons name="time-outline" size={15} color="#97580C" /><Text style={styles.countText}>{rows.length} בקשות ממתינות{loadFailed ? ' · טרם עודכנו' : ''}</Text></View>
        </LinearGradient>
        <View style={styles.filters}>
          <Pressable accessibilityRole="button" accessibilityLabel="סינון לפי מועדון" onPress={() => setPicker('club')} style={[styles.filter, styles.clubFilter]}>
            <Ionicons name="shirt-outline" size={18} color={colors.primary} /><Text numberOfLines={1} style={styles.filterLabel}>{selectedClub ?? 'כל המועדונים'}</Text><Ionicons name="chevron-down" size={15} color={colors.primary} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="מיון בקשות" onPress={() => setPicker('sort')} style={styles.filter}>
            <Ionicons name="swap-vertical-outline" size={18} color={colors.primary} /><Text numberOfLines={1} style={styles.filterLabel}>{byName ? 'לפי שם השחקן' : 'סדר הרשימה'}</Text><Ionicons name="chevron-down" size={15} color={colors.primary} />
          </Pressable>
        </View>
        {loadFailed ? <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.error}><Text style={styles.errorText}>לא ניתן לעדכן את הבקשות. לחצו לניסיון חוזר</Text></Pressable> : null}
      </>} ListEmptyComponent={!loadFailed ? <EmptyState icon="checkmark-done-circle-outline" title={groupId ? 'אין בקשות ממתינות במועדון הזה' : he.requestsEmpty} hint={groupId ? 'אפשר לבחור מועדון אחר או להציג את כל המועדונים' : he.requestsEmptyHint} fill={false} /> : null} renderItem={({
      item,
      index
    }) => {
      const first = !byName && (index === 0 || rows[index - 1].kind !== item.kind || rows[index - 1].targetId !== item.targetId);
      const count = rows.filter(r => r.kind === item.kind && r.targetId === item.targetId).length;
      return <>
          {first && count > 1 ? <View style={styles.sectionHead}><Text numberOfLines={1} style={styles.sectionTitle}>{item.context}</Text><Pressable disabled={!!busy} onPress={() => approveTarget(item)} style={styles.bulk}><Text style={styles.bulkText}>{he.requestsApproveAll}</Text></Pressable></View> : null}
          <RequestCard row={item} busy={busy === item.key || busy === `all:${item.kind}:${item.targetId}`} disabled={!!busy} onProfile={() => openProfile(item)} onApprove={() => void act(item, true)} onDecline={() => void act(item, false)} />
        </>;
    }} ListFooterComponent={rows.length ? <View style={styles.footer}><Ionicons name="information-circle-outline" size={17} color="#6A7F9F" /><Text style={styles.footerText}>אפשר להיכנס לפרופיל לפני שמחליטים</Text></View> : null} />}
    <SafeModal visible={picker !== null} transparent animationType="fade" onRequestClose={() => setPicker(null)}>
      <View style={styles.modal}><Pressable accessibilityLabel="סגירה" style={StyleSheet.absoluteFill} onPress={() => setPicker(null)} />
        <View style={styles.sheet}><View style={styles.sheetHeader}><Text style={styles.sheetTitle}>{picker === 'club' ? 'בחירת מועדון' : 'מיון הבקשות'}</Text><Pressable accessibilityRole="button" accessibilityLabel="סגירה" onPress={() => setPicker(null)} style={styles.close}><Ionicons name="close" size={24} color={colors.text} /></Pressable></View>
          <ScrollView>{picker === 'club' ? [{
              id: undefined,
              name: 'כל המועדונים'
            }, ...clubs].map(club => <Pressable accessibilityRole="button" accessibilityState={{
              selected: groupId === club.id
            }} key={club.id ?? 'all'} style={styles.option} onPress={() => {
              setGroupId(club.id);
              setPicker(null);
            }}><Text style={styles.optionText}>{club.name}</Text>{groupId === club.id ? <Ionicons name="checkmark" size={22} color={colors.primary} /> : null}</Pressable>) : [false, true].map(value => <Pressable accessibilityRole="button" accessibilityState={{
              selected: byName === value
            }} key={String(value)} style={styles.option} onPress={() => {
              setByName(value);
              setPicker(null);
            }}><Text style={styles.optionText}>{value ? 'לפי שם השחקן' : 'סדר הרשימה המקורי'}</Text>{byName === value ? <Ionicons name="checkmark" size={22} color={colors.primary} /> : null}</Pressable>)}</ScrollView>
        </View>
      </View>
    </SafeModal>
  </SafeAreaView>;
}
function RequestCard({
  row,
  busy,
  disabled,
  onProfile,
  onApprove,
  onDecline
}: {
  row: InboxRow;
  busy: boolean;
  disabled: boolean;
  onProfile: () => void;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const reduced = useReducedMotion();
  const city = row.user?.availability?.homeCity;
  return <Animated.View collapsable={false} layout={LinearTransition.duration(reduced ? 0 : 220)} exiting={reduced ? undefined : FadeOut.duration(180)} style={styles.card}>
    <Pressable accessibilityRole="button" accessibilityLabel={`לפרופיל של ${row.user?.name ?? 'השחקן'}`} onPress={onProfile} style={styles.identity}>
      <Avatar avatarId={row.user?.avatarId} uri={row.user?.photoUrl} name={row.user?.name ?? '?'} size={42} />
      <View style={styles.identityText}><Text style={styles.name} numberOfLines={1}>{row.user?.name ?? he.friendsUnknownUser}</Text><View style={styles.contextRow}><Ionicons name={row.kind === 'friend' ? 'people-outline' : row.kind === 'club' ? 'shirt-outline' : 'football-outline'} size={13} color="#6A7F9F" /><Text style={styles.context} numberOfLines={1}>{row.context}{city ? ` · ${city}` : ''}</Text></View></View>
      {row.createdAt ? <Text style={styles.date}>{new Date(row.createdAt).toLocaleDateString('he-IL', {
          day: 'numeric',
          month: 'numeric'
        })}</Text> : null}
    </Pressable>
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" accessibilityLabel={`אישור ${row.user?.name ?? 'השחקן'}`} disabled={disabled} onPress={onApprove} style={[styles.approve, disabled && styles.disabled]}>{busy ? <ActivityIndicator color="white" size="small" /> : <Text style={styles.approveText}>{row.kind === 'friend' ? 'אישור חברות' : 'אישור הצטרפות'}</Text>}</Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`דחיית ${row.user?.name ?? 'השחקן'}`} disabled={disabled} onPress={onDecline} style={[styles.decline, disabled && styles.disabled]}><Text style={styles.declineText}>דחייה</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={onProfile} style={styles.profile}><Text style={styles.profileText}>לפרופיל</Text><Ionicons name="chevron-back" size={15} color={colors.primary} /></Pressable>
    </View>
  </Animated.View>;
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
  content: {
    paddingHorizontal: 16,
    paddingBottom: 28
  },
  hero: {
    borderRadius: 22,
    padding: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#D7E7FF',
    marginBottom: 12
  },
  pitch: {
    position: 'absolute',
    right: -12,
    top: -12,
    transform: [{
      rotate: '-18deg'
    }],
    opacity: 0.8
  },
  heroTitle: {
    fontSize: 23,
    fontWeight: '800',
    color: '#142340',
    textAlign: RTL_LABEL_ALIGN
  },
  heroHint: {
    fontSize: 13,
    lineHeight: 20,
    color: '#63789B',
    textAlign: RTL_LABEL_ALIGN,
    marginTop: 2
  },
  count: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFF2D7',
    borderColor: '#FFD68A',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
    marginTop: 10
  },
  countText: {
    fontSize: 12,
    color: '#875318',
    fontWeight: '600'
  },
  filters: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12
  },
  filter: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#DFE8F6',
    backgroundColor: 'white'
  },
  clubFilter: {
    backgroundColor: '#E7F1FF',
    borderColor: '#C5DDFF'
  },
  filterLabel: {
    flex: 1,
    color: '#274675',
    fontSize: 12,
    fontWeight: '600',
    textAlign: RTL_LABEL_ALIGN
  },
  card: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#E0E9F7',
    borderRadius: 19,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    marginBottom: 9,
    shadowColor: '#25497D',
    shadowOpacity: 0.045,
    shadowRadius: 7,
    shadowOffset: {
      width: 0,
      height: 3
    },
    elevation: 1
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    minHeight: 44
  },
  identityText: {
    flex: 1,
    minWidth: 0
  },
  name: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
    color: '#142340',
    textAlign: RTL_LABEL_ALIGN
  },
  contextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2
  },
  context: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: '#63789B',
    textAlign: RTL_LABEL_ALIGN
  },
  date: {
    fontSize: 11,
    color: '#6A7F9F'
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#EDF1F8',
    marginTop: 8,
    paddingTop: 6
  },
  profile: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 2
  },
  profileText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary
  },
  approve: {
    flex: 1,
    minHeight: 40,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#2463FF',
    alignItems: 'center',
    justifyContent: 'center'
  },
  approveText: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '700',
    color: 'white',
    textAlign: 'center'
  },
  decline: {
    minHeight: 40,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBDCFF',
    alignItems: 'center',
    justifyContent: 'center'
  },
  declineText: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.primary
  },
  disabled: {
    opacity: 0.5
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 5
  },
  sectionTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#63789B',
    textAlign: RTL_LABEL_ALIGN
  },
  bulk: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 5
  },
  bulkText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#EAF0F9',
    padding: 10,
    borderRadius: 13,
    marginTop: 3
  },
  footerText: {
    fontSize: 12,
    color: '#63789B',
    flexShrink: 1
  },
  error: {
    backgroundColor: '#FFF0ED',
    padding: 12,
    borderRadius: 12,
    marginBottom: 12
  },
  errorText: {
    fontSize: 14,
    color: '#A33C24',
    textAlign: RTL_LABEL_ALIGN
  },
  modal: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15,30,60,0.35)'
  },
  sheet: {
    backgroundColor: 'white',
    borderTopLeftRadius: 25,
    borderTopRightRadius: 25,
    padding: 20,
    paddingBottom: 30,
    maxHeight: '75%'
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8
  },
  sheetTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: '#142340',
    textAlign: RTL_LABEL_ALIGN
  },
  close: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center'
  },
  option: {
    minHeight: 52,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderColor: '#EDF1F8'
  },
  optionText: {
    flex: 1,
    fontSize: 16,
    color: '#274675',
    textAlign: RTL_LABEL_ALIGN
  }
});
