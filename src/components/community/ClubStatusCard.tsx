import React, { forwardRef, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ClubStatsAwards, ClubStatsSummary } from './ClubStatsDashboard';
import { captureRef, releaseCapture } from 'react-native-view-shot';
import { SafeModal } from '@/components/SafeModal';
import { Button } from '@/components/Button';
import { appAlert } from '@/components/AppDialog';
import { RTL_LABEL_ALIGN } from '@/theme';
import { recordDiagnostic } from '@/services/diagnosticJournal';
import type { User } from '@/types';

export interface ClubStatusLeader {
  title: string; user: Pick<User, 'id' | 'name' | 'avatarId' | 'photoUrl'>;
  value: number; unit: string; suffix?: string;
}
export interface ClubStatusData {
  clubName: string; scope: string;
  goals: number; assists: number; games: number; evenings: number;
  leaders: ClubStatusLeader[];
}

/** The same static, self-contained composition is shown and captured. */
export const ClubStatusCard = forwardRef<View, ClubStatusData>(function ClubStatusCard(data, ref) {
  const date = `\u2066${new Date().toLocaleDateString('he-IL')}\u2069`;
  return <View ref={ref} collapsable={false} style={s.card}>
    <View style={s.shareHeader}>
      <View style={s.topline}><Text style={s.kicker}>תמונת מצב המועדון</Text><Text style={s.brand}>{'\u2066TEAMDER\u2069'}</Text></View>
      <Text style={s.clubName}>{data.clubName}</Text><Text style={s.scope}>{data.scope}</Text>
    </View>
    <View style={s.shareBody}>
      <ClubStatsSummary goals={data.goals} assists={data.assists} games={data.games} evenings={data.evenings} />
      {data.leaders.length ? <><Text style={s.shareHeading}>תארי המועדון</Text><ClubStatsAwards leaders={data.leaders} /></> : null}
      <View style={s.footer}><Text style={s.shareFooter}>כדורגל של חברים</Text><Text style={s.shareFooter}>{date}</Text></View>
    </View>
  </View>;
});

export function ClubStatusOverview(data: ClubStatusData & { compact?: boolean }) {
  const [preview, setPreview] = useState(false);
  const [sharing, setSharing] = useState(false);
  const busy = useRef(false);
  const cardRef = useRef<View>(null);
  const openerRef = useRef<View>(null);
  const share = async () => {
    if (busy.current || !cardRef.current) return;
    busy.current = true;
    setSharing(true);
    let uri: string | undefined;
    try {
      const Sharing = require('expo-sharing') as typeof import('expo-sharing');
      if (!await Sharing.isAvailableAsync()) {
        appAlert('שיתוף תמונה', 'שיתוף תמונות אינו זמין במכשיר הזה. אפשר לצלם את הכרטיס ישירות.');
        return;
      }
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      uri = await captureRef(cardRef, { format: 'png', quality: 1, result: 'tmpfile', fileName: 'club-status' });
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'מצב המועדון' });
    } catch {
      appAlert('לא ניתן לשתף כרגע', 'אפשר לנסות שוב או לצלם את הכרטיס ישירות.');
    } finally {
      if (uri) releaseCapture(uri);
      busy.current = false;
      setSharing(false);
    }
  };
  return <>
    {data.compact ? null : <ClubStatusCard {...data} />}
    <Pressable ref={openerRef} accessibilityRole="button" accessibilityLabel="פתיחת כרטיס המועדון לצילום ושיתוף"
      onPressIn={()=>{recordDiagnostic('press','club_share_in',{surface:'club_stats_share'});openerRef.current?.measureInWindow((x,y,width,height)=>recordDiagnostic('press','club_share_measure',{x,y,width,height}));}}
      onPressOut={()=>recordDiagnostic('press','club_share_out',{surface:'club_stats_share'})}
      onPress={() => {recordDiagnostic('press','club_share_open',{surface:'club_stats_share'});setPreview(true);}} style={[s.previewButton, data.compact && { backgroundColor: 'transparent', padding: 9, minHeight: 44, minWidth: 44 }]}>
      <Ionicons name="share-social-outline" size={17} color={data.compact ? '#2463F5' : '#FFFFFF'} />{data.compact ? null : <Text style={s.previewButtonText}>כרטיס לצילום ולשיתוף</Text>}
    </Pressable>
    <SafeModal visible={preview} animationType="slide" onRequestClose={() => { if (!busy.current) setPreview(false); }}>
      <View style={s.previewRoot}>
        <View style={s.previewHeader}>
          <Text style={s.previewTitle}>כרטיס המועדון</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="סגירת כרטיס המועדון" disabled={sharing} onPress={() => setPreview(false)} hitSlop={12}><Ionicons name="close" size={24} color="#172335" /></Pressable>
        </View>
        <ScrollView contentContainerStyle={s.previewContent} showsVerticalScrollIndicator={false}>
          <View style={s.previewCard}><ClubStatusCard ref={cardRef} {...data} /></View>
        </ScrollView>
        <View style={s.previewActions}><Button title="שיתוף תמונה" iconLeft="share-outline" fullWidth loading={sharing} disabled={sharing} onPress={share} /></View>
      </View>
    </SafeModal>
  </>;
}

const s = StyleSheet.create({
  card: { backgroundColor: '#F7FAFC', borderRadius: 22, overflow: 'hidden' },
  shareHeader: { padding: 18, gap: 8, backgroundColor: '#FFFFFF' },
  shareBody: { padding: 12, gap: 14 },
  shareHeading: { color: '#13213F', fontSize: 15, fontWeight: '900', textAlign: RTL_LABEL_ALIGN },
  shareFooter: { color: '#65756E', fontSize: 10, fontWeight: '600' },
  topline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 3 },
  kicker: { fontSize: 10, fontWeight: '800', color: '#687797' },
  brand: { fontSize: 11, fontWeight: '900', color: '#2463F5', letterSpacing: 1.6 },
  clubName: { fontSize: 25, fontWeight: '900', color: '#13213F', textAlign: RTL_LABEL_ALIGN },
  scope: { fontSize: 12, fontWeight: '700', color: '#687797', textAlign: RTL_LABEL_ALIGN },
  footer: { flexDirection: 'row', justifyContent: 'space-between' },
  previewButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 13, borderRadius: 12, backgroundColor: '#143E2E' },
  previewButtonText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  previewRoot: { flex: 1, backgroundColor: '#F7FAFC' },
  previewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  previewTitle: { fontSize: 16, fontWeight: '800', color: '#172335' },
  previewContent: { flexGrow: 1, justifyContent: 'center', padding: 16 },
  previewCard: { width: '100%', maxWidth: 560, alignSelf: 'center' },
  previewActions: { padding: 16 },
});
