import { observeCaughtError } from '../../utils/errorObservation';
import { socialPlayersService } from '@/services/socialPlayersService';
// StatisticsScreen — a dedicated page that gathers the player's numbers and
// their "people" superlatives (most played with, winning duo, biggest
// victim, nemesis). Derived by playerStatsService with history enrichment; names for
// the relational cards are resolved here.

import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { captureRef } from 'react-native-view-shot';
import { ScrollSurface } from '@/components/ScrollSurface';
import { toast } from '@/components/Toast';
import { PersonalStatisticsCard, PersonalStatisticsWelcome, StatisticsAction, StatisticsBrand } from '@/components/stats/PersonalStatisticsCard';
import { Button } from '@/components/Button';
import { logError } from '@/services/errorLog';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { userService } from '@/services';
import {
  playerStatsService,
  type NamedStat,
  type PlayerStatsSummary,
} from '@/services/playerStatsService';
import { useUserStore } from '@/store/userStore';
import { colors, spacing, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { User } from '@/types';

type Resolved = Pick<User, 'id' | 'name' | 'avatarId' | 'photoUrl'>;

export function StatisticsScreen() {
  const nav = useNavigation<any>();
  const route = useRoute();
  const shareRef = useRef<View>(null);
  const sharingRef = useRef(false);
  const [sharing, setSharing] = useState(false);
  const localUser = useUserStore((s) => s.currentUser);
  const requestedId = (route.params as { userId?: string } | undefined)?.userId;
  const targetId = requestedId || localUser?.id;
  const otherPlayer = !!targetId && targetId !== localUser?.id;
  const [targetUser, setTargetUser] = useState<User | null>(null);
  const [restricted, setRestricted] = useState(false);
  const [stats, setStats] = useState<PlayerStatsSummary | null>(null);
  const [people, setPeople] = useState<Record<string, Resolved>>({});
  const [pen, setPen] = useState<{
    penTaken: number;
    penScored: number;
    penInPlayTaken?: number;
    penInPlayScored?: number;
    penFaced: number;
    penSaved: number;
    ownGoals: number;
    ties: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [highlightsLoading, setHighlightsLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const ownerKey = `${localUser?.id ?? ''}:${targetId ?? ''}`;
  const statsOwnerRef = useRef(ownerKey);
  useFocusEffect(React.useCallback(() => {
    const uid = targetId;
    if (statsOwnerRef.current !== ownerKey) {
      statsOwnerRef.current = ownerKey;
      setStats(null); setPen(null); setPeople({}); setFailed(false);
    }
    if (!uid) { setLoading(false); setHighlightsLoading(false); return; }
    let alive = true;
    setLoading(true);
    setFailed(false);
    setHighlightsLoading(true);
    setRestricted(false);
    if (otherPlayer) {
      // The existing full-statistics route rechecks access; no private user
      // read or owner-only query is issued for another player.
      setStats(null); setPen(null); setPeople({}); setTargetUser(null);
      if (!localUser || localUser.isGuest) { setRestricted(true); setLoading(false); setHighlightsLoading(false); return; }
      socialPlayersService.profile(uid).then(profile => {
        if (!alive) return;
        setTargetUser({ ...profile.player, createdAt: 0 });
        if (!profile.canSeeStatistics || !profile.statistics) { setRestricted(true); return; }
        setStats(profile.statistics.stats); setPen(profile.statistics.pen); setPeople(profile.statistics.people);
      }).catch((caughtErrorc41edd63bc: unknown) => {
    observeCaughtError(caughtErrorc41edd63bc, {"source":"src/screens/profile/StatisticsScreen.tsx","handler":"StatisticsScreen","site":"StatisticsScreen:c41edd63bc"}); if (alive) setFailed(true); }).finally(() => { if (alive) {setLoading(false);setHighlightsLoading(false);} });
      return () => { alive = false; };
    }

    // Names only need the base summary, not the full historical enrichment.
    // The mock service may return without onBase, so the final result also calls this.
    let peopleRequested = false;
    const resolvePeople = (summary: PlayerStatsSummary) => {
      if (!alive || peopleRequested) return;
      peopleRequested = true;
      const ids = Array.from(new Set([
        summary.mostPlayedWith, summary.mostWinsWith, summary.biggestVictim,
        summary.nemesis, summary.mostAssistedTo, summary.mostAssistedBy,
      ].filter((x): x is NamedStat => !!x).map(x => x.uid)));
      void Promise.all(ids.map(id => userService.getUserById(id).catch((error: unknown) => {
        if (alive) observeCaughtError(error, { source: 'src/screens/profile/StatisticsScreen.tsx', handler: 'resolvePeople', site: 'StatisticsScreen:people' });
        return null;
      }))).then(fetched => {
        if (!alive) return;
        const map: Record<string, Resolved> = {};
        fetched.forEach(u => { if (u) map[u.id] = u; });
        setPeople(map);
      });
    };

    // Goals are incremented SERVER-side (commitRoundStats), so the local store
    // copy lags. Fetch the fresh user doc for an accurate goal count + goals/
    // evening rather than trusting the (possibly stale) cached stats.
    userService
      .getUserById(uid)
      .then((fresh) => {
        if (!alive) return null;
        // Penalty-shootout stats (server-maintained) — captured for the tiles.
        const st = fresh?.stats;
        setPen(
          st
            ? {
                penTaken: st.penTaken ?? 0,
                penScored: st.penScored ?? 0,
                penInPlayTaken: st.penInPlayTaken ?? 0,
                penInPlayScored: st.penInPlayScored ?? 0,
                penFaced: st.penFaced ?? 0,
                penSaved: st.penSaved ?? 0,
                ownGoals: st.ownGoals ?? 0,
                ties: st.ties ?? 0,
              }
            : null,
        );
        return playerStatsService.compute(uid, {
          goals: fresh?.stats?.goals ?? localUser?.stats?.goals ?? 0,
          assists: fresh?.stats?.assists ?? localUser?.stats?.assists ?? 0,
          isCurrent: () => alive,
          onBase: (base) => {
            if (!alive) return;
            setStats(base);
            setLoading(false);
            resolvePeople(base);
          },
          onHighlights: (highlights) => {
            if (alive) setStats(base => base ? { ...base, highlights } : base);
          },
        });
      })
      .then((s) => {
        if (!alive || !s) return;
        setStats(s);
        resolvePeople(s);
      })
      .catch((err) => {
        if (!alive) return;
    observeCaughtError(err, {"source":"src/screens/profile/StatisticsScreen.tsx","handler":"StatisticsScreen","site":"StatisticsScreen:e4da6c2a46"});
        if (alive) { setFailed(true); logError('loadStatistics', err, { userId: uid }); }
      })
      .finally(() => {
        if (alive) { setLoading(false); setHighlightsLoading(false); }
      });
    return () => {
      alive = false;
    };
    // assists must be a dep too — the effect reads it, so an assists-only
    // server bump (no goal change) otherwise left the assist tile stale.
  }, [localUser?.id, targetId, ownerKey, otherPlayer, localUser?.isGuest, localUser?.stats?.goals, localUser?.stats?.assists, reloadTick]));

  const qaPreview = __DEV__ && process.env.EXPO_PUBLIC_QA_ROUTES === '1' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1'
    ? (route.params as { qaStatisticsPreview?: 'full' | 'empty' } | undefined)?.qaStatisticsPreview : undefined;
  const fixture = qaPreview === 'full' ? (require('@/dev/personalStatisticsFixture') as typeof import('@/dev/personalStatisticsFixture')).personalStatisticsFixture : null;
  // Effects run after render: never paint a previous owner's numbers next to
  // the new account's name, even for the first frame after an auth change.
  const ownsStats = statsOwnerRef.current === ownerKey;
  const viewStats = fixture?.stats ?? (ownsStats ? stats : null);
  const viewPen = fixture?.pen ?? (ownsStats ? pen : null);
  const viewPeople = fixture?.people ?? (ownsStats ? people : {});
  const viewUser = fixture?.user ?? (otherPlayer ? targetUser : localUser);
  const hasData = qaPreview === 'empty' ? false : !!viewStats && (viewStats.attendedGames > 0 || viewStats.goals > 0 || viewStats.assists > 0 || !!viewPen && (viewPen.penTaken > 0 || viewPen.penFaced > 0 || viewPen.ownGoals > 0));

  const onShare = async () => {
    if (!shareRef.current || sharingRef.current) return;
    sharingRef.current = true;
    setSharing(true);
    try {
      const uri = await captureRef(shareRef, { format: 'png', quality: 1, result: 'tmpfile' });
      // Lazy load for older development shells; release binaries include the module.
      const Sharing = require('expo-sharing') as typeof import('expo-sharing');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'הכדורגל שלי' });
      } else toast.error(he.summaryShareUnavailable);
    } catch (err) {
    observeCaughtError(err, {"source":"src/screens/profile/StatisticsScreen.tsx","handler":"onShare","site":"StatisticsScreen:11ba404ae0"});
      logError('sharePersonalStatistics', err);
      toast.error(he.summaryShareFailed);
    } finally {
      sharingRef.current = false;
      setSharing(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="חזרה" onPress={() => nav.goBack()} hitSlop={10} style={styles.back}>
          <Ionicons name="chevron-forward" size={25} color="#111B40" />
        </Pressable>
        <Text style={styles.title}>{otherPlayer ? 'סטטיסטיקת שחקן' : 'הכדורגל שלי'}</Text>
        <StatisticsBrand />
      </View>
      {(!ownsStats || loading && !stats) && !qaPreview ? (
        <View style={styles.center}><SoccerBallLoader size={40} /></View>
      ) : restricted ? <View style={styles.center}><Ionicons name="shield-checkmark-outline" size={40} color="#2563EB"/><Text style={{color:colors.textMuted,textAlign:'center'}}>הסטטיסטיקה אינה זמינה לך לפי הגדרות הפרטיות של השחקן.</Text></View> : failed && !hasData && !qaPreview ? (
        <View style={styles.center}>
          <Text style={{ color: colors.textMuted }}>לא ניתן לטעון את הסטטיסטיקה כרגע.</Text>
          <Button title={he.retry} variant="outline" onPress={() => setReloadTick((t) => t + 1)} />
        </View>
      ) : (
        <ScrollSurface contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {failed && !qaPreview ? <View><Text style={{ color: colors.textMuted }}>לא ניתן לרענן את הסטטיסטיקה כרגע. הנתונים הקודמים מוצגים.</Text><Button title={he.retry} variant="outline" onPress={() => setReloadTick((t) => t + 1)} /></View> : null}
          {hasData && viewStats ? <>
            {!qaPreview && viewStats.highlights?.incomplete && !highlightsLoading ? <View><Text style={{color:colors.textMuted}}>חלק מנתוני המחזורים לא נטענו. הנתונים הזמינים מוצגים.</Text><Button title={he.retry} variant="outline" onPress={() => setReloadTick(t=>t+1)} /></View> : null}
            <View ref={shareRef} collapsable={false} style={styles.shareCard}>
              <PersonalStatisticsCard isOwn={!otherPlayer} user={viewUser ?? null} stats={viewStats} people={viewPeople} pen={viewPen} highlightsLoading={!qaPreview && highlightsLoading} />
            </View>
            {!otherPlayer ? <StatisticsAction title={sharing ? 'מכין את הכרטיס…' : 'שתף את הכרטיס שלי'} icon="share-social-outline" disabled={sharing} onPress={() => void onShare()} /> : null}
          </> : otherPlayer ? <View style={styles.center}><Ionicons name="stats-chart-outline" size={36} color="#2563EB"/><Text style={{color:colors.textMuted}}>עדיין אין לשחקן נתונים מתועדים.</Text></View> : <PersonalStatisticsWelcome onFind={() => nav.getParent()?.navigate('GameTab', { screen: 'GamesList' })} />}
        </ScrollSurface>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F4F7FB' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#FFF' },
  back: { minHeight: 40, minWidth: 32, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 21, fontWeight: '800', color: '#111B40', textAlign: RTL_LABEL_ALIGN },
  content: { padding: 16, gap: 12, paddingBottom: 28 },
  shareCard: { backgroundColor: '#F4F7FB', gap: 12 },
  shareBrand: { alignItems: 'center', paddingVertical: 8 },
});
