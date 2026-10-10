import { ScrollSurface } from '@/components/ScrollSurface';
// EveningSummaryScreen — shows the shareable "סיכום הערב" card for the
// current user in a finished game, with a Share button that captures the
// card to a PNG and hands it to the OS share sheet (expo-sharing).
//
// Reached from: the finished-game MatchDetails ("שתף סיכום ערב" CTA) and,
// later, right after the final whistle on the live screen.

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useRoute } from '@react-navigation/native';
import { captureRef } from 'react-native-view-shot';
import { Ionicons } from '@expo/vector-icons';

import { ScreenHeader } from '@/components/ScreenHeader';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { EveningSummaryCard } from '@/components/summary/EveningSummaryCard';
import { EveningScoreInfoSheet } from '@/components/summary/EveningScoreInfoSheet';
import {
  eveningSummaryService,
  type EveningSummaryModel,
} from '@/services/eveningSummaryService';
import { useUserStore } from '@/store/userStore';
import { toast } from '@/components/Toast';
import { logEvent, AnalyticsEvent } from '@/services/analyticsService';
import { logError } from '@/services/errorLog';
import { colors, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import type { GameStackParamList } from '@/navigation/GameStack';

type Params = RouteProp<GameStackParamList, 'EveningSummary'>;

export function EveningSummaryScreen() {
  const { gameId } = useRoute<Params>().params;
  const currentUser = useUserStore((s) => s.currentUser);
  const cardRef = useRef<View>(null);
  const summaryOwner = `${gameId}:${currentUser?.id ?? ''}`;
  const loadedOwner = useRef(summaryOwner);
  const ownsSummary = loadedOwner.current === summaryOwner;

  const [model, setModel] = useState<EveningSummaryModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [scoreInfoVisible, setScoreInfoVisible] = useState(false);

  useEffect(() => {
    let alive = true;
    loadedOwner.current = summaryOwner;
    setScoreInfoVisible(false);
    setLoading(true);
    setFailed(false);
    setModel(null);
    (async () => {
      // Physical/Health-Connect ingestion was removed — the feature is disabled
      // (no wearable data path). The summary is goals/assists/result only now.
      const m = await eveningSummaryService.getEveningSummary(
        gameId,
        currentUser?.id ?? '',
        currentUser?.name,
      );
      if (!alive) return;
      setModel(m);
      if (m) {
        logEvent(AnalyticsEvent.EveningSummaryOpened, {
          gameId,
          rounds: m.rounds,
          goals: m.goals,
          assists: m.assists,
          wins: m.wins,
          noPlay:
            m.rounds === 0 &&
            m.wins === 0 &&
            m.losses === 0 &&
            m.goals === 0 &&
            m.assists === 0,
        });
      }
      setLoading(false);
      // Optional history must not block the basic summary. Ignore stale replies.
      if (m && m.rounds > 0) {
        const personalRecords = await eveningSummaryService.getPersonalRecords(m);
        if (alive) setModel({ ...m, personalRecords });
      }
    })().catch((error) => {
      if (!alive) return;
      logError('loadEveningSummary', error, { gameId });
      setFailed(true);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [gameId, currentUser?.id, currentUser?.name, retryTick]);

  async function onShare() {
    if (!ownsSummary || loading || !cardRef.current || sharing) return;
    setSharing(true);
    try {
      // Let the capture-only layout commit: all highlights, no interactive controls.
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const uri = await captureRef(cardRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      });
      // Lazy-require the native module so the screen (and app) still loads on a
      // binary that predates expo-sharing — the require only runs on share tap.
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      const Sharing = require('expo-sharing') as typeof import('expo-sharing');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          dialogTitle: he.summaryShareTitle,
        });
        logEvent(AnalyticsEvent.SummaryShared, { gameId });
      } else {
        toast.error(he.summaryShareUnavailable);
      }
    } catch (err) {
      logError('shareEveningSummary', err, { gameId });
      toast.error(he.summaryShareFailed);
    } finally {
      setSharing(false);
    }
  }

  // The player registered but never actually took the field (winner-stays: sat
  // out every mini-game, or the evening ended with no rounds). A fabricated 6.0
  // "score" is confusing ("על מה קיבלתי 6?"), so show a plain no-play message.
  const noPlay =
    !!model &&
    model.rounds === 0 &&
    model.wins === 0 &&
    model.losses === 0 &&
    model.goals === 0 &&
    model.assists === 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="הסיכום שלי" />
      {!ownsSummary || loading ? (
        <View style={styles.center}>
          <SoccerBallLoader />
        </View>
      ) : failed ? (
        <View style={styles.center}>
          <Text style={styles.empty}>לא ניתן לטעון את הסיכום כרגע.</Text>
          <Pressable accessibilityRole="button" onPress={() => setRetryTick((n) => n + 1)} style={styles.shareBtn}>
            <Text style={styles.shareTxt}>נסה שוב</Text>
          </Pressable>
        </View>
      ) : !model || noPlay ? (
        <View style={styles.center}>
          <Text style={styles.empty}>
            {noPlay ? he.summaryNoPlay : he.summaryUnavailable}
          </Text>
        </View>
      ) : (
        <ScrollSurface contentContainerStyle={styles.scroll}>
          <EveningSummaryCard key={`${model.gameId}:${model.uid}`} ref={cardRef} model={model} user={currentUser} captureMode={sharing}
            onScoreInfo={() => setScoreInfoVisible(true)}
          />
          <Pressable
            style={({ pressed }) => [styles.shareBtn, pressed && { opacity: 0.9 }]}
            onPress={onShare}
            disabled={sharing}
            accessibilityRole="button"
            accessibilityLabel="שתף את הסיכום"
          >
            {sharing ? (
              <ActivityIndicator color="#fff" />
            ) : (
            <><Text style={styles.shareTxt}>שתף את הסיכום</Text><Ionicons name="share-outline" size={22} color="#FFFFFF" /></>
            )}
          </Pressable>
        </ScrollSurface>
      )}
      <EveningScoreInfoSheet visible={ownsSummary && scoreInfoVisible} onClose={() => setScoreInfoVisible(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F9FD' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { ...typography.body, color: colors.textMuted },
  scroll: { padding: 16, gap: 16, paddingBottom: 28 },
  shareBtn: {
    backgroundColor: '#2469F4',
    flexDirection: 'row',
    gap: 9,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1E40AF',
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  shareTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
