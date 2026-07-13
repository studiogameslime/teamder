// PlayerCompareScreen — head-to-head comparison between the viewer and another
// player in a community. Renders the shareable PlayerCompareCard + a Share
// button that captures it to a PNG (same flow as the evening summary).

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
import { PlayerCompareCard } from '@/components/compare/PlayerCompareCard';
import {
  playerCompareService,
  type ComparisonModel,
} from '@/services/playerCompareService';
import { useUserStore } from '@/store/userStore';
import { toast } from '@/components/Toast';
import { logEvent, AnalyticsEvent } from '@/services/analyticsService';
import { logError } from '@/services/errorLog';
import { colors, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import type { GameStackParamList } from '@/navigation/GameStack';

type Params = RouteProp<GameStackParamList, 'PlayerCompare'>;

export function PlayerCompareScreen() {
  const { groupId, otherUid } = useRoute<Params>().params;
  const currentUser = useUserStore((s) => s.currentUser);
  const cardRef = useRef<View>(null);

  const [model, setModel] = useState<ComparisonModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      const m = await playerCompareService.getComparison(
        groupId,
        currentUser?.id ?? '',
        otherUid,
      );
      if (!alive) return;
      setModel(m);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [groupId, otherUid, currentUser?.id]);

  async function onShare() {
    if (!cardRef.current || sharing) return;
    setSharing(true);
    try {
      const uri = await captureRef(cardRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      });
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      const Sharing = require('expo-sharing') as typeof import('expo-sharing');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          dialogTitle: he.compareShareTitle,
        });
        logEvent(AnalyticsEvent.SummaryShared, { compare: otherUid });
      } else {
        toast.error(he.summaryShareUnavailable);
      }
    } catch (err) {
      logError('sharePlayerCompare', err, { groupId, otherUid });
      toast.error(he.summaryShareFailed);
    } finally {
      setSharing(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={he.compareTitle} />
      {loading ? (
        <View style={styles.center}>
          <SoccerBallLoader />
        </View>
      ) : !model ? (
        <View style={styles.center}>
          <Text style={styles.empty}>{he.compareUnavailable}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <PlayerCompareCard ref={cardRef} model={model} />
          <Pressable
            style={({ pressed }) => [styles.shareBtn, pressed && { opacity: 0.9 }]}
            onPress={onShare}
            disabled={sharing}
          >
            {sharing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.shareTxt}>{he.compareShareCta}</Text>
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
  },
  shareTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
