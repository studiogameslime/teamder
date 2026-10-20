import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { SeasonSummaryIcon } from '@/components/summary/SeasonSummaryIcon';
import { SafeModal } from '@/components/SafeModal';
import type { AchievementListItem } from '@/services/achievementsService';
import type { AchievementTier } from '@/types';
import { TIER_META } from '@/data/achievements';
import { colors, RTL_LABEL_ALIGN } from '@/theme';
import { overlaySurfaces, overlayTheme } from '@/theme/overlays';
import { he } from '@/i18n/he';

const BLUE = '#1479FF';
/** Shared presentation contract; the host retains its own eligibility rules. */
export interface AchievementDisplayItem extends Omit<AchievementListItem, 'def'> {
  def: Omit<AchievementListItem['def'], 'metric'>;
  unit?: 'percent';
}
const displayValue = (item: AchievementDisplayItem, value: number) => item.unit === 'percent' ? `${Number(value.toFixed(1))}%` : String(value);
const metal = { bronze: { ink: '#97431B', bg: '#FFE5D6' }, silver: { ink: '#51637C', bg: '#E9EEF5' }, gold: { ink: '#A76D00', bg: '#FFF0C3' } };
function AchievementGlyph({ id, size = 29 }: { id: string; size?: number }) {
  if (id === 'goals' || id === 'clubGoals' || id === 'assists') return <SeasonSummaryIcon name={id === 'assists' ? 'boot' : 'ball'} size={size} />;
  if (id === 'cleanSheets') return <View><SeasonSummaryIcon name="goal" size={size} /><Ionicons name="checkmark-circle" size={13} color="#06B6D4" style={{ position: 'absolute', bottom: -1, left: -1, backgroundColor: '#FFF', borderRadius: 7 }} /></View>;
  if (id === 'duo') return <View style={{ flexDirection: 'row', alignItems: 'center' }}><MaterialCommunityIcons name="tshirt-crew" size={22} color="#8055F5" style={{ marginEnd: -7 }} /><MaterialCommunityIcons name="tshirt-crew" size={22} color="#A278FF" /></View>;
  const glyphs: Record<string, [keyof typeof MaterialCommunityIcons.glyphMap, string]> = {
    games: ['calendar-month-outline', '#F26B3A'],
    partner: ['account-group', '#F5AA08'],
    distinctPlayers: ['account-multiple-plus', BLUE], friends: ['account-plus', BLUE],
    communities: ['shield-outline', BLUE], invites: ['send', BLUE],
    coaching: ['clipboard-account-outline', '#1899D5'], founder: ['flag', '#E9AA0B'],
    gameNights: ['calendar-month-outline', '#F26B3A'], members: ['account-group', '#8055F5'],
    ageYears: ['clock-outline', '#627A9E'], activeThisMonth: ['fire', '#F26B3A'], organization: ['shield-check-outline', '#13A36F'],
  };
  const [name, color] = glyphs[id] ?? ['star-outline', BLUE];
  return <MaterialCommunityIcons name={name} color={color} size={size} />;
}
function TierPill({ tier }: { tier: AchievementTier | null }) {
  const tone = tier ? metal[tier] : { ink: colors.textMuted, bg: '#EDF1F6' };
  return <View style={[styles.pill, { backgroundColor: tone.bg }]}><Text style={[styles.pillLabel, { color: tone.ink }]}>{tier ? TIER_META[tier].he : 'נעול'}</Text></View>;
}
function Progress({ value, target, complete = false }: { value: number; target: number; complete?: boolean }) {
  const percent = complete ? 100 : Math.round(Math.max(0, Math.min(1, value / Math.max(1, target))) * 100);
  return <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent }}>
    <View style={[styles.fill, { width: `${percent}%` }]} />
  </View>;
}
export function AchievementTile({ item, unavailable, onPress }: { item: AchievementDisplayItem; unavailable: boolean; onPress: () => void }) {
  const maxed = item.unlocked && !item.next;
  const text = unavailable ? 'ההתקדמות אינה זמינה' : maxed ? item.unit === 'percent' ? `${displayValue(item, item.value)} · הושלם` : item.def.oneOff ? 'הושלם' : 'הדרגה הגבוהה ביותר' : item.next ? `${displayValue(item, item.value)} מתוך ${displayValue(item, item.next.threshold)} ל${TIER_META[item.next.tier].he}` : 'טרם הושלם';
  return <Pressable accessibilityRole="button" accessibilityLabel={`${item.def.titleHe}, ${item.currentTier ? TIER_META[item.currentTier.tier].he : 'נעול'}, ${text}`} onPress={onPress} style={({ pressed }) => [styles.tile, pressed && { opacity: 0.75 }]}>
    <View style={styles.tileTop}>
      <View style={{ flex: 1, alignItems: 'flex-start', gap: 3 }}><Text style={styles.tileName}>{item.def.titleHe}</Text><TierPill tier={item.currentTier?.tier ?? null} /></View>
      <View style={[styles.iconTile, !item.unlocked && { opacity: 0.45 }]}><AchievementGlyph id={item.def.id} /></View>
    </View>
    <Text style={styles.tileProgress}>{text}</Text>
    {!unavailable ? <Progress value={item.value} target={item.next?.threshold ?? 1} complete={maxed} /> : null}
  </Pressable>;
}
export function AchievementDetail({ item, unavailable, onClose, context = 'personal' }: { item: AchievementDisplayItem | null; unavailable: boolean; onClose: () => void; context?: 'personal' | 'club' }) {
  return <SafeModal visible={!!item} transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="סגירת פירוט ההישג" />
      {item ? <View style={styles.sheet} accessibilityViewIsModal>
        <ScrollView contentContainerStyle={styles.sheetContent}>
          <View style={styles.detailHeader}>
            <View style={{ flex: 1, gap: 4, alignItems: 'flex-start' }}><Text style={styles.detailTitle}>{item.def.titleHe}</Text><TierPill tier={item.currentTier?.tier ?? null} /></View>
            <View style={styles.iconTile}><AchievementGlyph id={item.def.id} size={32} /></View>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="סגירה"><Ionicons name="close" size={22} color={colors.textMuted} /></Pressable>
          </View>
          {!unavailable && (!item.def.oneOff || item.unit === 'percent') ? <Text style={styles.tally}>{displayValue(item, item.value)} {item.def.nounHe}</Text> : null}
          <Text style={styles.explanation}>{item.def.howHe}</Text>
          <View style={styles.stages}>
            {item.def.tiers.map(step => {
              const reached = !!item.currentTier && item.currentTier.threshold >= step.threshold;
              return <View key={step.tier} style={[styles.stage, { backgroundColor: metal[step.tier].bg + '88', borderColor: metal[step.tier].bg }]}>
                <MaterialCommunityIcons name="crown-outline" color={metal[step.tier].ink} size={22} />
                <Text style={[styles.stageName, { color: metal[step.tier].ink }]}>{TIER_META[step.tier].he}</Text>
                <Text style={styles.stageThreshold}>{displayValue(item, step.threshold)} {item.def.nounHe}</Text>
                <Ionicons name={reached ? 'checkmark-circle' : 'ellipse-outline'} size={17} color={reached ? '#13A36F' : '#9AA9BE'} />
              </View>;
            })}
          </View>
          {unavailable ? <Text style={styles.explanation}>ההתקדמות העדכנית אינה זמינה כרגע.</Text> : <>
            <Progress value={item.value} target={item.next?.threshold ?? 1} complete={item.unlocked && !item.next} />
            <Text style={styles.explanation}>{item.next ? `עוד ${Number(Math.max(0, item.next.threshold - item.value).toFixed(1))} ${item.unit === 'percent' ? 'נקודות אחוז' : item.def.nounHe} לדרגת ${TIER_META[item.next.tier].he}` : item.def.oneOff ? 'הושלם' : he.achievementMaxed}</Text>
          </>}
          {context === 'club' ? <Text style={styles.meta}>הדרגה מחושבת מנתוני המועדון העדכניים</Text> : item.unlocked ? <Text style={styles.meta}>דרגה שכבר השגת נשמרת</Text> : <Text style={styles.meta}>{he.achievementsLockedHint}</Text>}
          {item.unlockedAt ? <Text style={styles.meta}>{he.achievementUnlockedAt(new Date(item.unlockedAt).toLocaleDateString('he-IL'))}</Text> : null}
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.done}><Text style={styles.doneText}>הבנתי</Text></Pressable>
        </ScrollView>
      </View> : null}
    </View>
  </SafeModal>;
}
const styles = StyleSheet.create({
  tile: { width: '49%', minHeight: 82, padding: 8, gap: 4, borderRadius: 12, borderWidth: 1, borderColor: '#DDEAFB', backgroundColor: colors.surface },
  tileTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tileName: { fontSize: 13, lineHeight: 18, fontWeight: '800', color: colors.text, textAlign: RTL_LABEL_ALIGN },
  pill: { alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 1 },
  pillLabel: { fontSize: 10, lineHeight: 14, fontWeight: '700' },
  iconTile: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EAF4FF' },
  tileProgress: { fontSize: 10, lineHeight: 14, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  track: { height: 5, borderRadius: 8, backgroundColor: '#E6EEF9', overflow: 'hidden', alignItems: 'flex-start', width: '100%' },
  fill: { height: '100%', borderRadius: 8, backgroundColor: BLUE },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: overlayTheme.backdrop },
  sheet: { ...overlaySurfaces.sheet, width: '100%', maxWidth: 520, alignSelf: 'center', maxHeight: '90%' },
  sheetContent: { padding: 18, gap: 15 },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  detailTitle: { fontSize: 21, lineHeight: 27, fontWeight: '800', color: colors.text, textAlign: RTL_LABEL_ALIGN },
  tally: { fontSize: 25, lineHeight: 32, fontWeight: '800', color: colors.text, textAlign: RTL_LABEL_ALIGN },
  explanation: { fontSize: 13, lineHeight: 19, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  stages: { flexDirection: 'row', gap: 7 },
  stage: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 9, gap: 5, alignItems: 'center' },
  stageName: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  stageThreshold: { fontSize: 11, lineHeight: 16, color: colors.text, textAlign: 'center' },
  meta: { fontSize: 11, lineHeight: 16, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  done: { minHeight: 44, backgroundColor: BLUE, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  doneText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
});
