// EveningSummaryCard — the shareable "סיכום המחזור" card, in the app's LIGHT
// palette so it belongs inside Teamder (which is light). Wrapped in a forwardRef
// View so the screen can hand the node to react-native-view-shot's captureRef.
//
// Every richer section renders only when its data exists on the model, so the
// SAME component gracefully covers phase-1 (score+result+goals), phase-2
// (contribution + held-the-pitch), phase-3 (physical panel) and phase-4
// (heatmap + DNA radar). A player with no wearable just sees the game sections.

import React, { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { EveningSummaryModel } from '@/services/eveningSummaryService';
import type { InsightTone } from '@/utils/eveningNarrative';

const C = {
  bg: '#F9FAFB',
  surface: '#FFFFFF',
  tint: '#F3F4F6',
  line: '#E9EBEF',
  line2: '#E5E7EB',
  ink: '#111827',
  muted: '#6B7280',
  muted2: '#9CA3AF',
  blue: '#2563EB',
  blueDeep: '#1E40AF',
  blueTint: '#EFF4FF',
  blueSoft: '#3B5BB5',
  green: '#16A34A',
  greenTint: '#ECFDF3',
  red: '#EF4444',
  gold: '#CA8A04',
  goldTint: '#FEF7E0',
  goldDeep: '#B45309',
  purple: '#7C3AED',
  purpleTint: '#F5F1FE',
  orange: '#EA580C',
  cyan: '#0891B2',
  cyanTint: '#E6F6FA',
};

// Per-tone colours for the adaptive insight strips.
const TONE_STYLES: Record<InsightTone, { bg: string; border: string; text: string }> = {
  gold: { bg: C.goldTint, border: '#FDE9AE', text: C.goldDeep },
  lime: { bg: C.greenTint, border: '#C7EFD6', text: C.green },
  blue: { bg: C.blueTint, border: '#CFE0FF', text: C.blueDeep },
  purple: { bg: C.purpleTint, border: '#E7DBFB', text: C.purple },
  rose: { bg: '#FFF1F2', border: '#FECDD3', text: '#E11D48' },
};

function initial(name: string): string {
  const t = (name || '').trim();
  return t ? Array.from(t)[0] : '⚽';
}


interface Props {
  model: EveningSummaryModel;
}

export const EveningSummaryCard = forwardRef<View, Props>(
  function EveningSummaryCard({ model }, ref) {
    // Header = the EVENING TOTAL mini-games (user request).
    const roundsMeta = model.totalKnown ? `${model.totalRounds}` : `${model.rounds}`;
    // Situational strips picked by this player's performance (replaces the old
    // fixed held-pitch + "worked hard" lines that everyone saw identically).
    const insights = model.insights ?? [];
    return (
      <View ref={ref} collapsable={false} style={styles.card}>
        {/* brand */}
        <View style={styles.brand}>
          <View style={styles.lockup}>
            <View style={styles.logo}>
              <Text style={styles.logoTxt}>⚽</Text>
            </View>
            <Text style={styles.brandName}>Teamder</Text>
          </View>
          <View style={styles.kicker}>
            <Text style={styles.kickerTxt}>סיכום המחזור</Text>
          </View>
        </View>

        {/* player */}
        <View style={styles.who}>
          <View style={styles.avatar}>
            <Text style={styles.avatarTxt}>{initial(model.playerName)}</Text>
          </View>
          <View style={styles.whoText}>
            <Text style={styles.playerName} numberOfLines={1}>
              {model.playerName}
            </Text>
            {/* Club name on its OWN line so a long name isn't truncated
               together with the counts (user report: "שם המועדון חתוך"). */}
            <Text style={styles.meta} numberOfLines={1}>
              {roundsMeta} משחקים · {model.dateLabel}
            </Text>
            <Text style={styles.metaClub} numberOfLines={1}>
              {model.communityName}
            </Text>
          </View>
        </View>

        {/* score hero */}
        <View style={styles.score}>
          <View style={styles.scoreNumCol}>
            <Text style={styles.scoreNum}>{model.score.toFixed(1)}</Text>
            {model.scoreDelta != null && model.scoreDelta !== 0 ? (
              <Text
                style={[
                  styles.scoreDelta,
                  { color: model.scoreDelta > 0 ? C.green : C.red },
                ]}
              >
                {model.scoreDelta > 0 ? '▲' : '▼'}{' '}
                {Math.abs(model.scoreDelta).toFixed(1)}
              </Text>
            ) : null}
          </View>
          <View style={styles.scoreText}>
            <Text style={styles.tier}>
              {model.title} {model.titleEmoji}
            </Text>
            <Text style={styles.scoreLabel}>ציון המחזור שלך</Text>
            <Text style={styles.scoreSub}>
              {model.scoreDelta != null && model.scoreDelta !== 0
                ? model.scoreDelta > 0
                  ? 'עלית מהמחזור הקודם 📈'
                  : 'קצת מתחת למחזור הקודם'
                : 'ניצחונות, גולים, בישולים ופנדלים'}
            </Text>
          </View>
        </View>

        {/* result band */}
        <View style={styles.result}>
          <View style={styles.resCell}>
            <Text style={[styles.resNum, { color: C.green }]}>{model.wins}</Text>
            <Text style={styles.resLabel}>ניצחונות</Text>
          </View>
          <View style={styles.resDivider} />
          <View style={styles.resCell}>
            <Text style={[styles.resNum, { color: C.red }]}>{model.losses}</Text>
            <Text style={styles.resLabel}>הפסדים</Text>
          </View>
          <View style={styles.resDivider} />
          <View style={styles.resCell}>
            <Text style={[styles.resNum, { color: C.ink }]}>
              {model.winRate}
              <Text style={styles.resPct}>%</Text>
            </Text>
            <Text style={styles.resLabel}>אחוז ניצחון</Text>
          </View>
        </View>

        {/* community-table standing + movement (computed end-of-evening) */}
        {model.rank != null ? (
          <View style={[styles.strip, styles.stripBlue]}>
            <Text style={styles.stripIco}>🏆</Text>
            <Text style={styles.stripTxt}>
              מקום <Text style={styles.stripBoldBlue}>{model.rank}</Text>
              {model.rankTotal ? ` מתוך ${model.rankTotal}` : ''} בטבלת המועדון
              {model.rankDelta != null && model.rankDelta !== 0 ? (
                <Text
                  style={{
                    color: model.rankDelta > 0 ? C.green : C.red,
                    fontWeight: '900',
                  }}
                >
                  {`  ${model.rankDelta > 0 ? '▲' : '▼'}${Math.abs(model.rankDelta)}`}
                </Text>
              ) : null}
            </Text>
          </View>
        ) : null}

        {/* goals + assists */}
        <View style={styles.grid}>
          <View style={styles.gTile}>
            <View style={[styles.chip, { backgroundColor: C.goldTint }]}>
              <Text style={styles.chipTxt}>⚽</Text>
            </View>
            <View>
              <Text style={[styles.gVal, { color: C.gold }]}>{model.goals}</Text>
              <Text style={styles.gCap}>גולים</Text>
            </View>
          </View>
          <View style={styles.gTile}>
            <View style={[styles.chip, { backgroundColor: C.purpleTint }]}>
              <Text style={styles.chipTxt}>🅰️</Text>
            </View>
            <View>
              <Text style={[styles.gVal, { color: C.purple }]}>{model.assists}</Text>
              <Text style={styles.gCap}>בישולים</Text>
            </View>
          </View>
        </View>

        {/* Adaptive insight strips — chosen by what THIS player did (goals,
            assists, wins, held-pitch, penalties, streaks…). Different players
            see different lines instead of the old fixed copy. */}
        {insights.map((ins, i) => {
          const t = TONE_STYLES[ins.tone];
          return (
            <View key={i} style={[styles.strip, { backgroundColor: t.bg, borderColor: t.border }]}>
              <Text style={styles.stripIco}>{ins.icon}</Text>
              <Text style={[styles.stripTxt, { color: t.text }]}>{ins.text}</Text>
            </View>
          );
        })}

      </View>
    );
  },
);

const CARD_SHADOW = {
  shadowColor: '#0F172A',
  shadowOpacity: 0.06,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderRadius: 28,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line2,
    padding: 18,
    gap: 12,
    ...CARD_SHADOW,
  },
  brand: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lockup: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  logo: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: C.blueDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoTxt: { fontSize: 15 },
  brandName: { color: C.ink, fontSize: 14, fontWeight: '800' },
  kicker: {
    backgroundColor: '#DBEAFE',
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: 999,
  },
  kickerTxt: { color: C.blueDeep, fontSize: 11, fontWeight: '800' },

  who: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 15,
    backgroundColor: '#DBEAFE',
    borderWidth: 1,
    borderColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarTxt: { color: C.blueDeep, fontSize: 20, fontWeight: '800' },
  whoText: { flex: 1 },
  playerName: { color: C.ink, fontSize: 21, fontWeight: '800' },
  meta: { color: C.muted, fontSize: 12, fontWeight: '600', marginTop: 4 },
  metaClub: { color: C.ink, fontSize: 12.5, fontWeight: '800', marginTop: 1 },

  score: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 16,
    borderRadius: 20,
    backgroundColor: C.goldTint,
    borderWidth: 1,
    borderColor: '#FDE9AE',
  },
  scoreNum: { color: C.gold, fontSize: 46, fontWeight: '800' },
  scoreText: { flex: 1 },
  tier: { color: C.goldDeep, fontSize: 17, fontWeight: '800' },
  scoreLabel: { color: C.blueDeep, fontSize: 12, fontWeight: '700', marginTop: 3 },
  scoreSub: { color: C.muted, fontSize: 10, fontWeight: '600', marginTop: 3 },

  result: {
    flexDirection: 'row',
    alignItems: 'stretch',
    padding: 14,
    borderRadius: 20,
    backgroundColor: C.tint,
    borderWidth: 1,
    borderColor: C.line,
  },
  resCell: { flex: 1, alignItems: 'center' },
  resDivider: { width: 1, backgroundColor: C.line2, marginVertical: 2 },
  resNum: { fontSize: 30, fontWeight: '800' },
  resPct: { fontSize: 15, color: C.muted, fontWeight: '700' },
  resLabel: { color: C.muted, fontSize: 11, fontWeight: '700', marginTop: 5 },

  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 13,
    borderWidth: 1,
  },
  stripGold: { backgroundColor: C.goldTint, borderColor: '#FDE9AE' },
  stripLime: { backgroundColor: C.greenTint, borderColor: '#C7EFD6' },
  stripBlue: { backgroundColor: C.blueTint, borderColor: '#D8E4FF' },
  stripIco: { fontSize: 20 },
  stripTxt: { flex: 1, color: C.ink, fontSize: 13, fontWeight: '700' },
  stripBoldGold: { color: C.goldDeep, fontWeight: '800' },
  stripBoldLime: { color: C.green, fontWeight: '800' },
  stripBoldBlue: { color: C.blueDeep, fontWeight: '900' },
  scoreNumCol: { alignItems: 'center', gap: 2 },
  scoreDelta: { fontSize: 14, fontWeight: '900' },

  contrib: {
    padding: 15,
    borderRadius: 20,
    backgroundColor: C.blueTint,
    borderWidth: 1,
    borderColor: '#D8E4FF',
  },
  contribTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  contribLabel: { color: C.blueDeep, fontSize: 13, fontWeight: '800' },
  contribBig: { color: C.blueDeep, fontSize: 30, fontWeight: '800' },
  contribPct: { color: C.muted, fontSize: 15 },
  bar: { height: 9, borderRadius: 99, backgroundColor: '#D8E4FF', marginTop: 11, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 99, backgroundColor: C.blue },
  contribSub: { color: '#5B6B8C', fontSize: 11, fontWeight: '600', marginTop: 9 },
  contribSubStrong: { color: C.blueDeep, fontWeight: '800' },

  grid: { flexDirection: 'row', gap: 11 },
  gTile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 13,
    borderRadius: 16,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line2,
    ...CARD_SHADOW,
  },
  chip: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  chipTxt: { fontSize: 18 },
  gVal: { fontSize: 24, fontWeight: '800' },
  gCap: { color: C.muted, fontSize: 11, fontWeight: '700', marginTop: 3 },

  watch: {
    padding: 15,
    borderRadius: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line2,
    ...CARD_SHADOW,
  },
  watchHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  watchTitle: { color: C.ink, fontSize: 14, fontWeight: '800' },
  wBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.cyanTint,
    borderWidth: 1,
    borderColor: '#C5EAF2',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  wDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.cyan },
  wBadgeTxt: { color: C.cyan, fontSize: 11, fontWeight: '800' },
  watchBody: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  wMetrics: { flex: 1, flexDirection: 'row', flexWrap: 'wrap' },
  wm: { width: '50%', paddingVertical: 6 },
  wmLabel: { color: C.muted, fontSize: 10, fontWeight: '700' },
  wmVal: { fontSize: 18, fontWeight: '800', marginTop: 2 },
  wmUnit: { color: C.muted, fontSize: 10, fontWeight: '700' },

  zones: { marginTop: 15 },
  zbar: { flexDirection: 'row', height: 14, borderRadius: 99, overflow: 'hidden', gap: 2 },
  zseg: { height: '100%' },
  zLegend: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  zl: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  zlDot: { width: 7, height: 7, borderRadius: 3 },
  zlTxt: { color: C.muted, fontSize: 9, fontWeight: '700' },

  wFoot: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.line,
  },
  wf: { alignItems: 'center' },
  wfVal: { color: C.ink, fontSize: 15, fontWeight: '800' },
  wfLabel: { color: C.muted, fontSize: 10, fontWeight: '700', marginTop: 2 },

  viz: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
    padding: 15,
    borderRadius: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line2,
    ...CARD_SHADOW,
  },
  vizText: { flex: 1 },
  vizTitle: { color: C.ink, fontSize: 13, fontWeight: '800' },
  vChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 },
  vChip: {
    backgroundColor: C.blueTint,
    borderWidth: 1,
    borderColor: '#D8E4FF',
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 999,
  },
  vChipTxt: { color: C.blueDeep, fontSize: 10, fontWeight: '800' },

  fun: {
    padding: 15,
    borderRadius: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line2,
    ...CARD_SHADOW,
  },
  funTitle: { color: C.ink, fontSize: 13, fontWeight: '800', marginBottom: 12 },
  funRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: C.line,
  },
  funRowFirst: { borderTopWidth: 0 },
  funIcon: { fontSize: 19, width: 26, textAlign: 'center' },
  funTxt: { color: '#374151', fontSize: 13, fontWeight: '600' },
});
