import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';
import { RTL_LABEL_ALIGN } from '@/theme/rtl';
import { getMyPersonalActivity, flushPersonalActivity } from '@/services/personalActivityService';
import { useUserStore } from '@/store/userStore';
import { isStaleSession } from '@/services/staleSession';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '@/navigation/ProfileStack';
import { MyActivityRoundCard } from '@/components/activity/MyActivityRoundCard';
import { caughtErrorOrigin, observeCaughtError } from '@/utils/errorObservation';

export interface PersonalActivitySummaryView {
  gameId: string; eligibleMs: number; measuredMs: number; coverageRatio: number | null;
  distanceM: number | null; steps: number | null; calories: number | null;
  avgHeartRateBpm: number | null; maxHeartRateBpm: number | null;
  heartRateSamples: number; excludedBoundarySamples: number;
  coverageMs?: Record<string, number>;
}
export type PersonalActivityViewState =
  | { status: 'loading' | 'unavailable' | 'processing' | 'error'; summary?: null }
  | { status: 'available'; summary: PersonalActivitySummaryView };

const minutes = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
/** Private content lives outside the football card's captureRef. */
export function PersonalActivityContent({ state, onRefresh, onOpenActivity, refreshing = false, refreshError = false }: {
  state: PersonalActivityViewState; onRefresh: () => void; onOpenActivity?: () => void; refreshing?: boolean; refreshError?: boolean;
}) {
  const summary = state.status === 'available' ? state.summary : null;
  return <View style={styles.wrapper}>
    <MyActivityRoundCard status={state.status === 'unavailable' ? 'empty' : state.status}
      metrics={summary ? { recordingMs: summary.measuredMs, distanceM: summary.distanceM, steps: summary.steps,
        calories: summary.calories, avgHeartRateBpm: summary.avgHeartRateBpm, maxHeartRateBpm: summary.maxHeartRateBpm } : null}
      sourceLabel="שירותי הבריאות בשעון" periodLabel="סיכום המחזור האישי" durationLabel="זמן שנמדד במחזור"
      refreshing={refreshing} onRefresh={onRefresh} onPress={onOpenActivity} />
    <Text style={styles.detail}>מהשעון שלך, רק כשהטיימר רץ ואתה בקבוצה שמשחקת.</Text>
    {summary ? <>
      <Text style={styles.detail}>זמן משחק אישי ידוע: {'\u2066'}{minutes(summary.eligibleMs)}{'\u2069'}</Text>
      <Text style={styles.detail}>{summary.coverageRatio == null
        ? summary.eligibleMs > 0 ? 'אין מספיק מדידת משך לחישוב הכיסוי.' : 'אין עדיין זמן משחק אישי ידוע לחישוב הכיסוי.'
        : `כיסוי המדידה: ${Math.round(summary.coverageRatio * 100)} אחוזים. המדדים מתייחסים לחלק שנמדד בלבד.`}</Text>
      {(['distanceM', 'steps', 'calories'] as const).map(key => summary[key] !== null && summary.coverageMs?.[key] !== undefined
        ? <Text key={key} style={styles.detail}>{({ distanceM: 'מרחק', steps: 'צעדים', calories: 'קלוריות' })[key]} נמדד במשך {'\u2066'}{minutes(summary.coverageMs[key])}{'\u2069'}</Text> : null)}
      {summary.heartRateSamples > 0 ? <Text style={styles.detail}>הדופק הממוצע מחושב מדגימות הדופק שאושרו.</Text> : null}
      {summary.excludedBoundarySamples > 0 ? <Text style={styles.detail}>דגימות שחצו חילוף, הפסקה או פער בזמן לא נכללו. לא בוצעה השלמה משוערת.</Text> : null}
    </> : null}
    {refreshError ? <Text accessibilityRole="alert" style={styles.detail}>הרענון לא הושלם. המדידה המוצגת היא העדכון האחרון שנטען.</Text> : null}
  </View>;
}

export function PersonalActivityPanel({ gameId, userId }: { gameId: string; userId: string }) {
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const currentUser = useUserStore(s => s.currentUser);
  const key = `${userId}:${gameId}`;
  const [record, setRecord] = useState<{ key: string; state: PersonalActivityViewState; refreshing: boolean; refreshError: boolean }>(
    { key, state: { status: 'loading' }, refreshing: false, refreshError: false });
  const [revision, setRevision] = useState(0);
  const enabled = Platform.OS === 'android' && !!userId && currentUser?.id === userId && !currentUser.isGuest;
  const refresh = useCallback(() => setRevision(n => n + 1), []);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let latestRead = 0;
    setRecord(previous => ({ key, state: previous.key === key ? previous.state : { status: 'loading' }, refreshing: true, refreshError: false }));
    const read = async () => {
      const request = ++latestRead;
      try {
        const result = await getMyPersonalActivity(gameId, userId);
        if (!alive || request !== latestRead) return;
        setRecord(previous => {
          if (result.status !== 'available' && previous.key === key && previous.state.status === 'available') {
            return { key, state: previous.state, refreshing: false, refreshError: true };
          }
          return { key, state: result.status === 'available' && result.summary
            ? { status: 'available', summary: result.summary }
            : { status: result.status === 'processing' ? 'processing' : 'unavailable' }, refreshing: false, refreshError: false };
        });
      } catch (error) {
        if (!alive || request !== latestRead || isStaleSession(error) || useUserStore.getState().currentUser?.id !== userId) return;
        if (!caughtErrorOrigin(error)) observeCaughtError(new Error('Personal activity summary read failed'), {
          source: 'src/components/summary/PersonalActivityPanel.tsx', handler: 'read', site: 'personalActivity:summary-read',
        });
        setRecord(previous => ({ key, state: previous.key === key && previous.state.status === 'available'
          ? previous.state : { status: 'error' }, refreshing: false,
          refreshError: previous.key === key && previous.state.status === 'available' }));
      }
    };
    // Upload and read are independent. Only a successful upload needs a second read.
    void read();
    void flushPersonalActivity(userId).then(result => {
      if (alive && result.uploaded > 0) void read();
    }).catch(error => {
      if (!alive || isStaleSession(error) || useUserStore.getState().currentUser?.id !== userId) return;
      if (!caughtErrorOrigin(error)) observeCaughtError(new Error('Personal activity upload refresh failed'), {
        source: 'src/components/summary/PersonalActivityPanel.tsx', handler: 'flushRefresh', site: 'personalActivity:summary-flush',
      });
      // Durable inbox remains queued; the independent read decides the display.
    });
    const subscription = AppState.addEventListener('change', next => { if (next === 'active') refresh(); });
    const timer = setInterval(refresh, 30_000);
    return () => { alive = false; subscription.remove(); clearInterval(timer); };
  }, [gameId, userId, revision, key, refresh, enabled]);
  if (!enabled) return null;
  return <PersonalActivityContent state={record.key === key ? record.state : { status: 'loading' }}
    refreshing={record.key === key && record.refreshing} refreshError={record.key === key && record.refreshError} onRefresh={refresh} onOpenActivity={() => navigation.navigate('MyActivity')} />;
}

const styles = StyleSheet.create({
  wrapper: { gap: 8 },
  detail: { paddingHorizontal: 4, color: '#63778C', fontSize: 11, lineHeight: 18, textAlign: RTL_LABEL_ALIGN },
});
