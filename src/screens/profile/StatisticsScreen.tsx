// StatisticsScreen — a dedicated page that gathers the player's numbers and
// their "people" superlatives (most played with, winning duo, biggest
// victim, nemesis). Derived by playerStatsService with history enrichment; names for
// the relational cards are resolved here.

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useNavigation, useRoute } from '@react-navigation/native';
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
  const [stats, setStats] = useState<PlayerStatsSummary | null>(null);
  const [people, setPeople] = useState<Record<string, Resolved>>({});
  const [pen, setPen] = useState<{
    penTaken: number;
    penScored: number;
    penFaced: number;
    penSaved: number;
    ownGoals: number;
    ties: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [highlightsLoading, setHighlightsLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const statsOwnerRef = useRef(localUser?.id);

  useEffect(() => {
    const uid = localUser?.id;
    if (statsOwnerRef.current !== uid) {
      statsOwnerRef.current = uid;
      setStats(null); setPen(null); setPeople({}); setFailed(false);
    }
    if (!uid) { setLoading(false); setHighlightsLoading(false); return; }
    let alive = true;
    setLoading(true);
    setFailed(false);
    setHighlightsLoading(true);
    // Goals are incremented SERVER-side (commitRoundStats), so the local store
    // copy lags. Fetch the fresh user doc for an accurate goal count + goals/
    // evening rather than trusting the (possibly stale) cached stats.
    userService
      .getUserById(uid)
      .then((fresh) => {
        if (!alive) throw new Error('statistics request superseded');
        // Penalty-shootout stats (server-maintained) — captured for the tiles.
        const st = fresh?.stats;
        setPen(
          st
            ? {
                penTaken: st.penTaken ?? 0,
                penScored: st.penScored ?? 0,
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
          },
          onHighlights: (highlights) => {
            if (alive) setStats(base => base ? { ...base, highlights } : base);
          },
        });
      })
      .then(async (s) => {
        if (!alive) return;
        setStats(s);
        // Resolve the (few) distinct uids the named cards reference.
        const ids = Array.from(
          new Set(
            [
              s.mostPlayedWith,
              s.mostWinsWith,
              s.biggestVictim,
              s.nemesis,
              s.mostAssistedTo,
              s.mostAssistedBy,
            ]
              .filter((x): x is NamedStat => !!x)
              .map((x) => x.uid),
          ),
        );
        const fetched = await Promise.all(
          ids.map((id) => userService.getUserById(id).catch(() => null)),
        );
        if (!alive) return;
        const map: Record<string, Resolved> = {};
        fetched.forEach((u) => {
          if (u) map[u.id] = u;
        });
        setPeople(map);
      })
      .catch((err) => {
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
  }, [localUser?.id, localUser?.stats?.goals, localUser?.stats?.assists, reloadTick]);

  const qaPreview = __DEV__ && process.env.EXPO_PUBLIC_QA_ROUTES === '1' && process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK === '1'
    ? (route.params as { qaStatisticsPreview?: 'full' | 'empty' } | undefined)?.qaStatisticsPreview : undefined;
  const fixture = qaPreview === 'full' ? (require('@/dev/personalStatisticsFixture') as typeof import('@/dev/personalStatisticsFixture')).personalStatisticsFixture : null;
  // Effects run after render: never paint a previous owner's numbers next to
  // the new account's name, even for the first frame after an auth change.
  const ownsStats = statsOwnerRef.current === localUser?.id;
  const viewStats = fixture?.stats ?? (ownsStats ? stats : null);
  const viewPen = fixture?.pen ?? (ownsStats ? pen : null);
  const viewPeople = fixture?.people ?? (ownsStats ? people : {});
  const viewUser = fixture?.user ?? localUser;
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
        <Text style={styles.title}>הכדורגל שלי</Text>
        <StatisticsBrand />
      </View>
      {(!ownsStats || loading && !stats) && !qaPreview ? (
        <View style={styles.center}><SoccerBallLoader size={40} /></View>
      ) : failed && !hasData && !qaPreview ? (
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
              <PersonalStatisticsCard user={viewUser ?? null} stats={viewStats} people={viewPeople} pen={viewPen} highlightsLoading={!qaPreview && highlightsLoading} />
              <View style={styles.shareBrand}><StatisticsBrand /></View>
            </View>
            <StatisticsAction title={sharing ? 'מכין את הכרטיס…' : 'שתף את הכרטיס שלי'} icon="share-social-outline" disabled={sharing} onPress={() => void onShare()} />
          </> : <PersonalStatisticsWelcome onFind={() => nav.getParent()?.navigate('GameTab', { screen: 'GamesList' })} />}
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
