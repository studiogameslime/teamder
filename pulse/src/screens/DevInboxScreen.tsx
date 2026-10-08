// DevInboxScreen — "תיבת פיתוח": one screen unifying the three developer
// streams behind a segmented control: שגיאות (errors+feedback), פיצרים
// (the idea/bug inbox), and דיווחים (user-submitted reports). Replaces the
// three separate screens. All three bodies stay mounted (hidden when inactive)
// so switching segments keeps their state and doesn't refetch.

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, font, radius } from '../theme';
import { ErrorsBody } from './ErrorsScreen';
import { FeaturesBody } from './FeaturesScreen';
import { ReportsBody } from './ReportsScreen';
import { QaUsersBody } from './QaUsersScreen';

type Seg = 'errors' | 'features' | 'reports' | 'qa';
const SEGS: { key: Seg; label: string }[] = [
  { key: 'errors', label: 'שגיאות' },
  { key: 'features', label: 'פיצרים' },
  { key: 'reports', label: 'דיווחים' },
  { key: 'qa', label: 'QA' },
];

export function DevInboxScreen() {
  const [seg, setSeg] = useState<Seg>('errors');
  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <View style={st.header}>
        <Text style={font.h1}>תיבת פיתוח</Text>
      </View>

      <View style={st.segWrap}>
        {SEGS.map((s) => {
          const on = seg === s.key;
          return (
            <Pressable
              key={s.key}
              onPress={() => setSeg(s.key)}
              style={[st.seg, on && st.segOn]}
            >
              <Text style={[st.segTxt, on && st.segTxtOn]}>{s.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={st.body}>
        <View style={[st.page, seg !== 'errors' && st.hidden]}>
          <ErrorsBody />
        </View>
        <View style={[st.page, seg !== 'features' && st.hidden]}>
          <FeaturesBody />
        </View>
        <View style={[st.page, seg !== 'reports' && st.hidden]}>
          <ReportsBody />
        </View>
        <View style={[st.page, seg !== 'qa' && st.hidden]}>
          <QaUsersBody />
        </View>
      </View>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 4 },
  segWrap: {
    flexDirection: 'row-reverse',
    gap: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 4,
    marginHorizontal: 14,
    marginBottom: 6,
  },
  seg: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: radius.sm,
  },
  segOn: { backgroundColor: colors.primary },
  segTxt: { ...font.small, color: colors.textSoft, fontWeight: '700' },
  segTxtOn: { color: '#fff' },
  body: { flex: 1 },
  page: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  hidden: { display: 'none' },
});
