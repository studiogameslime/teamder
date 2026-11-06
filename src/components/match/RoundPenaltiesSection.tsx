import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { gameService } from '@/services';
import { useUserStore } from '@/store/userStore';
import { observedRejection } from '@/utils/errorObservation';
import type { RoundHistoryDoc } from '@/utils/eveningStats';
import { eveningPenaltyAttempts } from '@/utils/roundPenalties';
import { colors, RTL_LABEL_ALIGN } from '@/theme';
import { TabSectionTitle } from './tabs/MatchTabShell';
import { RoundPenaltiesCard, type RoundPenaltiesCardProps } from './RoundPenaltiesCard';

export function RoundPenaltiesSection({ gameId, refreshKey, expectedRounds, expectedShootouts, userOf }: {
  gameId: string; refreshKey?: number; expectedRounds?: number; expectedShootouts?: number;
  userOf: RoundPenaltiesCardProps['userOf'];
}) {
  const viewer = useUserStore(state => state.currentUser?.id);
  const owner = JSON.stringify([viewer, gameId]);
  const [state, setState] = useState<{ owner: string; rounds: RoundHistoryDoc[] | null; status: 'loading' | 'ready' | 'error' }>({ owner, rounds: null, status: 'loading' });
  const [retry, setRetry] = useState(0);
  useFocusEffect(useCallback(() => {
    let alive = true;
    const current = () => alive && useUserStore.getState().currentUser?.id === viewer;
    setState(previous => ({ owner, rounds: previous.owner === owner ? previous.rounds : null, status: 'loading' }));
    if (viewer && gameId) {
      gameService.getRoundHistory(gameId).then(rounds => {
        if (current()) setState({ owner, rounds, status: 'ready' });
      }).catch(observedRejection(() => {
        if (current()) setState(previous => ({ ...previous, status: 'error' }));
      }, { source: 'src/components/match/RoundPenaltiesSection.tsx', handler: 'RoundPenaltiesSection', site: 'roundPenalties:history' }));
    }
    return () => { alive = false; };
  }, [owner, viewer, gameId, refreshKey, retry]));
  const valid = state.owner === owner;
  const rounds = valid ? state.rounds : null;
  const status = valid ? state.status : 'loading';
  const attempts = rounds ? eveningPenaltyAttempts(rounds) : [];
  const partial = !!rounds && ((expectedRounds ?? 0) > rounds.length || (expectedShootouts ?? 0) > rounds.filter(r => r.penalties?.length).length);
  return <View style={s.section}>
    <TabSectionTitle icon="football-outline" text="פנדלים במחזור" />
    {status !== 'ready' ? <View style={s.notice} accessibilityLiveRegion="polite">
      {status === 'loading' ? <ActivityIndicator color={colors.primary} /> : null}
      <Text style={s.copy}>{status === 'loading' ? rounds ? 'מעדכנים את פירוט הפנדלים...' : 'טוענים את פירוט הפנדלים...' : rounds ? 'לא הצלחנו לעדכן. הפירוט הקודם נשאר מוצג.' : 'לא הצלחנו לטעון את פירוט הפנדלים.'}</Text>
      {status === 'error' ? <Pressable accessibilityRole="button" onPress={() => setRetry(n => n + 1)} style={s.retry}><Text style={s.retryText}>ניסיון חוזר</Text></Pressable> : null}
    </View> : null}
    {rounds ? <RoundPenaltiesCard key={owner} attempts={attempts} hasHistory={rounds.length > 0} partial={partial} userOf={userOf} /> : null}
  </View>;
}

const s = StyleSheet.create({
  section: { gap: 10 }, notice: { padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, gap: 8, backgroundColor: colors.surface },
  copy: { fontSize: 13, color: colors.textMuted, lineHeight: 20, textAlign: RTL_LABEL_ALIGN },
  retry: { minHeight: 44, justifyContent: 'center' }, retryText: { color: colors.primary, fontSize: 13, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
});
