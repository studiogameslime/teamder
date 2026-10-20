import { overlaySurfaces, overlayTheme } from '@/theme/overlays';
// What switching seasons on will do, spelled out before it happens.
//
// This is the last screen before an irreversible change to a club's whole
// history: everything it has ever played becomes the season being opened, and
// depending on one chip above, that season either carries on or is sealed on
// the spot with its champions handed out permanently. Which season that is
// arrives as a prop — it is 1 only for a club that has never closed one.
//
// Every line is derived from the SAME `ActivationPlan` the settings screen
// validated and the server recomputes before acting. Nothing here is written
// prose about what usually happens — if the plan says 18/24 with six to go,
// that is because those are the numbers that will be written.

import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeModal as Modal } from '@/components/SafeModal';

import { Button } from '@/components/Button';
import { formatCalendarDate } from '@/utils/seasonDates';
import type { ActivationPlan, Cadence } from '@/utils/seasonActivation';
import { colors, spacing, typography, radius, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      {/* Label first → rightmost under forceRTL, value trailing to its left. */}
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

export function SeasonConfirmSheet({
  visible,
  title,
  message,
  plan,
  cadence,
  months,
  rounds,
  seasonNo,
  reactivation = false,
  busy,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title?: string;
  message?: string;
  plan: ActivationPlan;
  cadence: Cadence;
  months: number;
  rounds: number;
  /**
   * The season this activation opens — and NOT 1.
   *
   * Every season line below was hardcoded to "עונה 1" and "עונה 2", while the
   * numbering continues across the feature being switched off and on again. A
   * club that had already played three seasons and switched them back on read
   * "עונה 1 תסתיים ועונה 2 תתחיל" on the last screen before its table was
   * archived and reset — a plan for two seasons it finished months ago.
   */
  seasonNo: number;
  reactivation?: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const selected = plan.historyChoice ?? (plan.sealsSeason1 ? 'sealNow' : 'continue');
  const explanation = selected === 'fresh' ? 'העונה תתחיל מהיום. הפעילות הקודמת תישמר בכל הזמנים, ללא תארי עונה.'
    : selected === 'sealNow' ? `התקופה הקודמת תיסגר כעונה ${seasonNo} עם ${plan.playedHistory} מחזורים ותארים. עונה ${seasonNo + 1} תתחיל מהיום. אין חלון תיקונים לתקופה שנסגרת כעת ואין פתיחה מחדש.`
    : `העונה תכלול ${plan.playedHistory} מחזורים מהתקופה הקודמת. היעד כולל את ההתקדמות שכבר נצברה.`;
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={() => { if (!busy) onCancel(); }}>
    <Pressable accessible={false} style={styles.backdrop} onPress={() => { if (!busy) onCancel(); }}>
      <Pressable accessible={false} accessibilityViewIsModal style={styles.sheet} onPress={() => undefined}>
        <View style={styles.heading}>
          <View style={styles.icon}><Ionicons name="trophy-outline" size={23} color="#1479FF" /></View>
          <View style={styles.headingText}><Text style={styles.eyebrow}>עונות במועדון</Text><Text style={styles.title}>{title ?? 'לפני שמפעילים עונות'}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="סגירה" disabled={busy} onPress={onCancel} hitSlop={8} style={styles.close}><Ionicons name="close" size={20} color={colors.textMuted} /></Pressable>
        </View>
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyInner}>
          {message ? message.split('\n\n').map((paragraph, index) => <View key={index} style={index === 0 ? styles.summary : undefined}><Text style={index === 0 ? styles.summaryText : styles.note}>{paragraph}</Text></View>) : <Text style={styles.note}>{explanation}</Text>}
          {!message ? <>
            <Row label="יעד העונה" value={cadence === 'date' ? `${months} חודשים` : `${rounds} מחזורים`} />
            {cadence === 'date' && plan.endsOn ? <Row label="יום הפעילות האחרון" value={formatCalendarDate(plan.endsOn)} /> : null}
            <Text style={styles.note}>בהשגת היעד, לאחר לפחות חמישה מחזורים תקינים, ייפתח חלון תיקונים של 24 שעות. התארים יפורסמו רק כשהעונה תיסגר.</Text>
          </> : null}
          {busy ? <Text accessibilityLiveRegion="polite" style={styles.note}>הפעולה מתבצעת… הנתונים נשמרים. אין צורך ללחוץ שוב.</Text> : null}
        </ScrollView>
        <View style={[styles.actions, !!message && styles.actionRow]}>
          <View style={message ? styles.actionCell : undefined}><Button title={message ? 'אישור וסיום' : 'אישור והפעלת עונות'} style={styles.primaryButton} fullWidth loading={busy} disabled={busy || (!message && !plan.ok)} onPress={onConfirm} /></View>
          <View style={message ? styles.actionCell : undefined}><Button title="חזרה לעריכה" variant="secondary" style={styles.secondaryButton} fullWidth disabled={busy} onPress={onCancel} /></View>
        </View>
      </Pressable>
    </Pressable>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: overlayTheme.backdrop,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheet: { ...overlaySurfaces.dialog,
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    padding: 20,
    gap: 16,
  },
  title: { ...typography.h3, color: colors.text, textAlign: RTL_LABEL_ALIGN },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headingText: { flex: 1, gap: 2 },
  eyebrow: { fontSize: 11, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  icon: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#EDF5FF', alignItems: 'center', justifyContent: 'center' },
  close: { width: 30, height: 30, borderRadius: 10, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  summary: { padding: 12, backgroundColor: '#F3F8FF', borderRadius: 12, borderWidth: 1, borderColor: '#E3EDFB' },
  summaryText: { fontSize: 13, lineHeight: 19, fontWeight: '700', color: colors.text, textAlign: RTL_LABEL_ALIGN },
  body: { flexGrow: 0, flexShrink: 1 },
  bodyInner: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  label: {
    ...typography.caption,
    color: colors.textMuted,
    // `flex: 1` means flexBasis 0, so the label got only what the value left
    // over — and the value, being the bold half, took nearly all of it. On the
    // sheet a club approves before an irreversible change, the Hebrew labels
    // collapsed to about twenty pixels and stacked one character per line.
    // Both halves share, and the label keeps enough to read.
    flexShrink: 1,
    flexGrow: 1,
    flexBasis: 'auto',
    textAlign: RTL_LABEL_ALIGN,
  },
  value: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    flexShrink: 0,
    textAlign: RTL_LABEL_ALIGN,
  },
  note: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    lineHeight: 18,
    paddingTop: spacing.xs,
  },
  actions: { gap: 8, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.border },
  actionRow: { flexDirection: 'row' },
  actionCell: { flexGrow: 1, flexBasis: 0 },
  primaryButton: { minHeight: 48, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 8, backgroundColor: '#1479FF', borderColor: '#1479FF' },
  secondaryButton: { minHeight: 48, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 8, backgroundColor: colors.surfaceMuted, borderColor: colors.border },
  restartNotice: {padding:spacing.md,borderRadius:radius.md,backgroundColor:'#EFF6FF',gap:spacing.xs},
  restartTitle: {...typography.bodyBold,color:colors.primary,textAlign:RTL_LABEL_ALIGN},
});
