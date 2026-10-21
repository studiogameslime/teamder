import { observeCaughtError } from '../../utils/errorObservation';
// One cabinet for frozen season awards and tiered personal milestones.
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { ScreenHeader } from '@/components/ScreenHeader';
import { UserAvatar } from '@/components/UserAvatar';
import { SeasonTitlesShelf } from '@/components/profile/SeasonTitlesShelf';
import { AchievementTile, AchievementDetail } from '@/components/profile/AchievementCabinetCards';
import { AchievementCelebration } from '@/components/AchievementCelebration';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { achievementsService, type NewlyUnlocked } from '@/services/achievementsService';
import { seasonTitlesService, type HeldSeasonTitle } from '@/services/seasonTitlesService';
import { userService } from '@/services';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { logError } from '@/services/errorLog';
import { colors, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import type { User, UserAchievementState } from '@/types';

export function AchievementsScreen() {
  const [tab, setTab] = useState<'season' | 'personal'>('season');
  const [titleAttempt, setTitleAttempt] = useState(0);
  const [titleState, setTitleState] = useState<{ owner: string; items: HeldSeasonTitle[] | null; failed: boolean } | null>(null);
  const localUser = useUserStore((s) => s.currentUser);
  const groups = useGroupStore((s) => s.groups);
  const [user, setUser] = useState<User | null>(localUser);
  const [loading, setLoading] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Derived counters live alongside the user fetch. Null while
  // computing — once resolved they replace the (often stale) stored
  // counters for the unlock check. The persisted unlocked-id list
  // still wins, so a badge already earned stays earned.
  const [counters, setCounters] = useState<UserAchievementState | null>(null);
  // Set if deriveCounters fails — then we fall back to the stored counters
  // instead of waiting forever on the loader.
  const [deriveFailed, setDeriveFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  // Newly-reached tiers to celebrate (filled from persistDerivedUnlocks).
  const [celebrate, setCelebrate] = useState<NewlyUnlocked[]>([]);

  useEffect(() => {
    if (!localUser?.id) return;
    let alive = true;
    const owner = localUser.id;
    setTitleState(null);
    seasonTitlesService.list(owner).then(items => {
      if (alive) setTitleState({ owner, items, failed: false });
    }).catch(error => {
    observeCaughtError(error, {"source":"src/screens/profile/AchievementsScreen.tsx","handler":"AchievementsScreen","site":"AchievementsScreen:6e0dcfd637"});
      logError('seasonTitlesLoad', error, { userId: owner });
      if (alive) setTitleState({ owner, items: null, failed: true });
    });
    return () => { alive = false; };
  }, [localUser?.id, titleAttempt]);

  // Screen-level mount log so we can chart how often the achievements
  // page is opened (separate from the generic ScreenView signal).
  useEffect(() => {
    logEvent(AnalyticsEvent.AchievementsOpened);
  }, []);

  useEffect(() => {
    if (!localUser) return;
    let alive = true;
    setUser(localUser);
    setCounters(null);
    setActiveId(null);
    setCelebrate([]);
    setLoading(true);
    userService
      .getUserById(localUser.id)
      .then((u) => {
        if (alive && u) setUser(u);
      })
      .catch((caughtErrordd6b4a8cbd: unknown) => {
    observeCaughtError(caughtErrordd6b4a8cbd, {"source":"src/screens/profile/AchievementsScreen.tsx","handler":"AchievementsScreen","site":"AchievementsScreen:dd6b4a8cbd"});
        // Keep showing the cached store value on transient failure.
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [localUser?.id]);

  useEffect(() => {
    if (!localUser) return;
    let alive = true;
    setDeriveFailed(false);
    achievementsService
      .deriveCounters(localUser.id, {
        groups,
        friendsCount: localUser.friends?.length ?? 0,
        goals: localUser.stats?.goals ?? 0,
        assists: localUser.stats?.assists ?? 0,
        cleanSheets: localUser.stats?.cleanSheets ?? 0,
      })
      .then(async (c) => {
        if (!alive) return;
        setCounters(c);
        // Reconcile the persisted unlocked list with the new truth and
        // celebrate any tiers that were just crossed.
        const fresh = await achievementsService.persistDerivedUnlocks(
          localUser.id,
          c,
        );
        if (alive && fresh.length) setCelebrate(fresh);
      })
      .catch((caughtError7579262712: unknown) => {
    observeCaughtError(caughtError7579262712, {"source":"src/screens/profile/AchievementsScreen.tsx","handler":"AchievementsScreen","site":"AchievementsScreen:7579262712"});
        // Derivation failed → fall back to the stored counters via
        // achievementsService.list as a last resort (flag so the loader
        // doesn't spin forever).
        if (alive) setDeriveFailed(true);
      });
    return () => {
      alive = false;
    };
    // groups is included so adding/leaving a community refreshes the
    // teams* metrics on the next render.
  }, [localUser?.id, groups, reloadTick, localUser?.friends?.length, localUser?.stats?.goals, localUser?.stats?.assists, localUser?.stats?.cleanSheets]);

  const titles = titleState?.owner === localUser?.id ? titleState : null;
  const ready = !!counters || deriveFailed;
  const items = user && user.id === localUser?.id && ready
    ? counters ? achievementsService.listFromCounters(user, counters) : achievementsService.list(user)
    : [];
  // Stable positions follow the approved sketch, including locked categories.
  // Unlocks, tiers and progress still come only from the existing service.
  const order = ['goals', 'assists', 'games', 'cleanSheets', 'partner', 'duo', 'distinctPlayers', 'friends', 'communities', 'invites', 'coaching', 'founder'];
  const ordered = [...items].sort((a, b) => order.indexOf(a.def.id) - order.indexOf(b.def.id));
  const unlockedCount = items.filter(item => item.unlocked).length;
  const goldCount = items.filter(item => item.currentTier?.tier === 'gold').length;
  const active = items.find(item => item.def.id === activeId) ?? null;

  if (!localUser) return <SafeAreaView style={styles.root} edges={['top']}><ScreenHeader title="ארון התארים שלי" /><Text style={styles.note}>יש להתחבר כדי לראות את התארים שלך.</Text></SafeAreaView>;
  return <SafeAreaView style={styles.root} edges={['top']}>
    <ScreenHeader title="ארון התארים שלי" />
    <ScrollView key={tab} contentContainerStyle={styles.content}>
      <View style={styles.identity}>
        <UserAvatar user={localUser} size={43} />
        <View style={{ flex: 1, gap: 2 }}><Text style={styles.name}>{localUser.name}</Text><Text style={styles.tagline}>ההישגים שלך, לאורך הדרך</Text></View>
        <View style={styles.counter}><Text style={styles.total}>{titles?.items ? titles.items.length : '—'}</Text><Text style={styles.counterLabel}>תארי עונה</Text></View>
        <View style={styles.counter}><Text style={styles.total}>{ready ? unlockedCount : '—'}</Text><Text style={styles.counterLabel}>הישגים שנפתחו</Text></View>
      </View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {([['season', 'תארי עונה'], ['personal', 'הישגים אישיים']] as const).map(([key, label]) => <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} style={[styles.tab, tab === key && styles.selectedTab]} onPress={() => setTab(key)}>
          <Text style={[styles.tabText, tab === key && styles.selectedText]}>{label}</Text>
        </Pressable>)}
      </View>
      {tab === 'season' ? <>
        {titles?.failed ? <View style={styles.notice}><Text style={styles.note}>טעינת תארי העונה לא הצליחה.</Text><Button title={he.retry} variant="outline" onPress={() => setTitleAttempt(value => value + 1)} /></View>
          : titles?.items ? <SeasonTitlesShelf key={localUser.id} titles={titles.items} /> : <View style={styles.wait}><SoccerBallLoader size={30} /></View>}
      </> : <>
        <View style={{ gap: 2 }}><Text style={styles.sectionTitle}>ההישגים האישיים</Text><Text style={styles.note}>{ready ? `${unlockedCount} מתוך ${items.length} סוגים נפתחו · ${goldCount} בדרגת זהב` : 'טוענים את ההישגים שלך…'}</Text></View>
        {deriveFailed ? <View style={styles.notice}><Text style={styles.note}>העדכון לא הצליח. ההישגים השמורים שלך מוצגים כאן.</Text><Button title={he.retry} variant="outline" onPress={() => setReloadTick(value => value + 1)} /></View> : null}
        {ready ? <View style={styles.grid}>{ordered.map(item => <AchievementTile key={item.def.id} item={item} unavailable={deriveFailed} onPress={() => setActiveId(item.def.id)} />)}</View> : <View style={styles.wait}><SoccerBallLoader size={30} /></View>}
        {loading ? <SoccerBallLoader size={18} /> : null}
      </>}
    </ScrollView>
    <AchievementDetail item={active} unavailable={deriveFailed} onClose={() => setActiveId(null)} />
    {celebrate.length ? <AchievementCelebration items={celebrate} onDone={() => setCelebrate([])} /> : null}
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2F8FF' },
  content: { padding: 12, gap: 12, paddingBottom: 28 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  name: { color: colors.text, fontSize: 16, lineHeight: 21, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  tagline: { color: colors.textMuted, fontSize: 10, lineHeight: 14, textAlign: RTL_LABEL_ALIGN },
  counter: { alignItems: 'center', gap: 2, maxWidth: 66 },
  total: { color: colors.text, fontSize: 19, lineHeight: 23, fontWeight: '800' },
  counterLabel: { color: colors.textMuted, fontSize: 9, lineHeight: 12, textAlign: 'center' },
  tabs: { flexDirection: 'row', borderWidth: 1, borderColor: '#DDEAFB', borderRadius: 12, backgroundColor: colors.surface, padding: 2 },
  tab: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  selectedTab: { backgroundColor: '#1479FF' },
  tabText: { color: '#425F8C', fontSize: 13, lineHeight: 18, fontWeight: '700' },
  selectedText: { color: '#FFF' },
  sectionTitle: { color: colors.text, fontSize: 17, lineHeight: 23, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  note: { color: colors.textMuted, fontSize: 11, lineHeight: 17, textAlign: RTL_LABEL_ALIGN },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'space-between' },
  notice: { backgroundColor: colors.surface, padding: 12, gap: 8, borderRadius: 12 },
  wait: { minHeight: 130, justifyContent: 'center', alignItems: 'center' },
});
