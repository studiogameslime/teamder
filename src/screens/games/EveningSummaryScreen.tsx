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
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useRoute } from '@react-navigation/native';
import { captureRef } from 'react-native-view-shot';

import { ScreenHeader } from '@/components/ScreenHeader';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { EveningSummaryCard } from '@/components/summary/EveningSummaryCard';
import {
  eveningSummaryService,
  type EveningSummaryModel,
} from '@/services/eveningSummaryService';
import { physicalSyncService } from '@/services/physicalSyncService';
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

  const [model, setModel] = useState<EveningSummaryModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      // Best-effort: ingest this device's wearable session first (a fast no-op
      // when there's no watch / in mock), so the model picks up the physical
      // panel + heatmap on this same load.
      await physicalSyncService.syncForGame(gameId).catch(() => false);
      const m = await eveningSummaryService.getEveningSummary(
        gameId,
        currentUser?.id ?? '',
        currentUser?.name,
      );
      if (!alive) return;
      setModel(m);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [gameId, currentUser?.id, currentUser?.name]);

  async function onShare() {
    if (!cardRef.current || sharing) return;
    setSharing(true);
    try {
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
      <ScreenHeader title={he.summaryTitle} />
      {loading ? (
        <View style={styles.center}>
          <SoccerBallLoader />
        </View>
      ) : !model || noPlay ? (
        <View style={styles.center}>
          <Text style={styles.empty}>
            {noPlay ? he.summaryNoPlay : he.summaryUnavailable}
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <EveningSummaryCard ref={cardRef} model={model} />
          <Pressable
            style={({ pressed }) => [styles.shareBtn, pressed && { opacity: 0.9 }]}
            onPress={onShare}
            disabled={sharing}
          >
            {sharing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.shareTxt}>{he.summaryShareCta}</Text>
            )}
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { ...typography.body, color: colors.textMuted },
  scroll: { padding: spacing.lg, gap: spacing.lg },
  shareBtn: {
    backgroundColor: '#1E40AF',
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
