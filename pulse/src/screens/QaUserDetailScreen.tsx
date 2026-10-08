// QaUserDetailScreen — everything one QA user hit: their reports (feedback)
// + the errors attributed to them. Reached from the QA segment of the Dev Inbox.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius } from '../theme';
import { Card, Empty, Screen, SectionHeader } from '../components/ui';
import { ErrorItem } from './ErrorsScreen';
import { userActivity, type QaUserActivity } from '../services/qaService';
import { screenHe } from '../services/screenNames';
import type { ReportItem, ReportStatus } from '../services/reportsService';
import type { ErrorsStackParams } from '../navigation/ErrorsStack';

const dataUri = (b64: string) => `data:image/jpeg;base64,${b64}`;
const STATUS_META: Record<ReportStatus, { label: string; color: string }> = {
  new: { label: 'חדש', color: colors.primary },
  reviewed: { label: 'נבדק', color: colors.amber },
  done: { label: 'טופל', color: colors.green },
};

function timeHe(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} · ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function ReportCard({ it, onZoom }: { it: ReportItem; onZoom: (b64: string) => void }) {
  const sm = STATUS_META[it.status];
  const isBug = it.type === 'bug';
  return (
    <Card style={s.item}>
      <View style={s.head}>
        <View style={[s.kindTag, { backgroundColor: (isBug ? colors.red : colors.primary) + '22' }]}>
          <Ionicons name={isBug ? 'bug' : 'bulb'} size={12} color={isBug ? colors.red : colors.primary} />
          <Text style={[s.kindTxt, { color: isBug ? colors.red : colors.primary }]}>
            {isBug ? 'באג' : 'הצעה'}
          </Text>
        </View>
        <View style={{ flex: 1 }} />
        <View style={[s.statusPill, { borderColor: sm.color }]}>
          <View style={[s.statusDot, { backgroundColor: sm.color }]} />
          <Text style={[s.statusTxt, { color: sm.color }]}>{sm.label}</Text>
        </View>
      </View>
      <Text style={s.meta}>
        {[it.screen ? screenHe(it.screen) : null, it.appVersion, it.platform, timeHe(it.createdAt)]
          .filter(Boolean)
          .join('  ·  ')}
      </Text>
      {it.message ? <Text style={s.message}>{it.message}</Text> : null}
      {it.image ? (
        <Pressable style={s.shotWrap} onPress={() => onZoom(it.image!)}>
          <Image source={{ uri: dataUri(it.image) }} style={s.shot} resizeMode="cover" />
        </Pressable>
      ) : null}
    </Card>
  );
}

export function QaUserDetailScreen() {
  const nav = useNavigation<NativeStackNavigationProp<ErrorsStackParams, 'QaUser'>>();
  const route = useRoute<RouteProp<ErrorsStackParams, 'QaUser'>>();
  const { userId, userName } = route.params;

  const [data, setData] = useState<QaUserActivity>({ reports: [], errors: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await userActivity(userId));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <Screen
      title={userName || 'משתמש QA'}
      subtitle="כל הדיווחים והשגיאות של המשתמש"
      onBack={() => (nav.canGoBack() ? nav.goBack() : nav.navigate('DevInbox'))}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
          tintColor={colors.primary}
        />
      }
    >
      {loading ? (
        <View style={{ paddingVertical: 40 }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <>
          <SectionHeader>דיווחים ({data.reports.length})</SectionHeader>
          {data.reports.length === 0 ? (
            <Empty text="אין דיווחים" />
          ) : (
            data.reports.map((it) => (
              <ReportCard key={it.id} it={it} onZoom={setZoom} />
            ))
          )}

          <SectionHeader>שגיאות ({data.errors.length})</SectionHeader>
          {data.errors.length === 0 ? (
            <Empty text="אין שגיאות" />
          ) : (
            data.errors.map((e) => (
              <Pressable key={e.id} onPress={() => nav.navigate('ErrorDetail', { id: e.id })}>
                <ErrorItem e={e} />
              </Pressable>
            ))
          )}
        </>
      )}

      <Modal visible={!!zoom} transparent animationType="fade" onRequestClose={() => setZoom(null)}>
        <Pressable style={s.zoomBackdrop} onPress={() => setZoom(null)}>
          {zoom ? <Image source={{ uri: dataUri(zoom) }} style={s.zoomImg} resizeMode="contain" /> : null}
          <View style={s.zoomClose}>
            <Ionicons name="close" size={26} color="#fff" />
          </View>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const s = StyleSheet.create({
  item: { gap: 8, marginBottom: 8 },
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  kindTag: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.sm },
  kindTxt: { ...font.small, fontWeight: '800' },
  statusPill: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusTxt: { ...font.small, fontWeight: '700' },
  meta: { ...font.small, color: colors.textMuted, textAlign: 'right' },
  message: { ...font.body, color: colors.text, textAlign: 'right', lineHeight: 21 },
  shotWrap: { borderRadius: radius.md, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
  shot: { width: '100%', height: 200 },
  zoomBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  zoomImg: { width: '94%', height: '82%' },
  zoomClose: { position: 'absolute', top: 48, right: 20, width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
});
