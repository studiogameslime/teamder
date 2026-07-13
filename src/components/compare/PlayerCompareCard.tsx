// PlayerCompareCard — the shareable head-to-head comparison card. forwardRef so
// PlayerCompareScreen can captureRef → PNG → share (same flow as the evening
// summary). Light palette to match the app; RTL. "You" (a) reads on the visual
// right (blue), the other player (b) on the left (slate); the winner of each
// metric is marked green.

import React, { forwardRef } from 'react';
import { StyleSheet, Text, View, type DimensionValue } from 'react-native';
import { Avatar } from '@/components/Avatar';
import type {
  ComparisonModel,
  CompareMetric,
} from '@/services/playerCompareService';

const C = {
  bg: '#F9FAFB',
  card: '#FFFFFF',
  ink: '#111827',
  muted: '#6B7280',
  line: '#EDF0F4',
  blue: '#2563EB',
  blueDeep: '#1E40AF',
  blueTint: '#EFF4FF',
  slate: '#64748B',
  slateTint: '#EEF1F5',
  green: '#16A34A',
  gold: '#FFE9A8',
};

function fmt(v: number, f: CompareMetric['format']): string {
  if (f === 'pct') return `${v}%`;
  if (f === 'avg1') return v.toFixed(1);
  return String(v);
}

function MetricRow({ m }: { m: CompareMetric }) {
  const max = Math.max(m.a, m.b, 1);
  const aW = `${Math.round((m.a / max) * 100)}%` as DimensionValue;
  const bW = `${Math.round((m.b / max) * 100)}%` as DimensionValue;
  const aWin = m.winner === 'a';
  const bWin = m.winner === 'b';
  return (
    <View style={styles.row}>
      <View style={styles.rvals}>
        <Text style={[styles.val, styles.valYou, aWin && styles.valWin]}>
          {aWin ? '● ' : ''}
          {fmt(m.a, m.format)}
        </Text>
        <Text style={styles.rlbl}>{m.label}</Text>
        <Text style={[styles.val, styles.valHim, bWin && styles.valWin]}>
          {fmt(m.b, m.format)}
          {bWin ? ' ●' : ''}
        </Text>
      </View>
      {/* diverging bar: LTR track — left half = other (slate), right half = you (blue) */}
      <View style={styles.bar}>
        <View style={styles.barSeg}>
          <View style={[styles.fillLeft, { width: bW }]} />
        </View>
        <View style={styles.barSeg}>
          <View style={[styles.fillRight, { width: aW }]} />
        </View>
      </View>
    </View>
  );
}

export const PlayerCompareCard = forwardRef<View, { model: ComparisonModel }>(
  function PlayerCompareCard({ model }, ref) {
    const { a, b, metrics, headToHead, together, verdict } = model;
    const youLead = verdict.leader === 'a';
    const theyLead = verdict.leader === 'b';

    return (
      <View ref={ref} collapsable={false} style={styles.card}>
        {/* VS hero */}
        <View style={styles.hero}>
          <View style={styles.brandRow}>
            <Text style={styles.brand}>Teamder</Text>
            <Text style={styles.brandPill}>השוואה</Text>
          </View>

          <View style={styles.players}>
            <View style={styles.pl}>
              <Avatar avatarId={a.avatarId} uri={a.photo} name={a.name} size={62} />
              <Text style={styles.nm}>{a.name}</Text>
              <Text style={styles.sub}>אתה</Text>
            </View>
            <Text style={styles.vs}>VS</Text>
            <View style={styles.pl}>
              <Avatar avatarId={b.avatarId} uri={b.photo} name={b.name} size={62} />
              <Text style={styles.nm}>{b.name}</Text>
              <Text style={styles.sub}> </Text>
            </View>
          </View>

          {headToHead ? (
            <View style={styles.h2h}>
              <Text style={styles.h2hLbl}>🥊 ראש-בראש · קבוצות יריבות</Text>
              <View style={styles.h2hScore}>
                <Text style={[styles.h2hNum, headToHead.aWins >= headToHead.bWins && styles.h2hWin]}>
                  {headToHead.aWins}
                </Text>
                <Text style={styles.h2hDash}>–</Text>
                <Text style={[styles.h2hNum, headToHead.bWins > headToHead.aWins && styles.h2hWin]}>
                  {headToHead.bWins}
                </Text>
              </View>
              <Text style={styles.h2hFoot}>
                {headToHead.total} משחקונים אחד נגד השני
              </Text>
            </View>
          ) : null}

          {headToHead ? (
            <View style={styles.verdictPill}>
              <Text style={styles.verdictPillTxt}>
                {headToHead.aWins > headToHead.bWins
                  ? '👑 אתה מוביל בראש-בראש'
                  : headToHead.bWins > headToHead.aWins
                    ? `👑 ${b.name} מוביל בראש-בראש`
                    : '🤝 ראש-בראש שקול'}
              </Text>
            </View>
          ) : null}
        </View>

        {/* metrics */}
        <View style={styles.metrics}>
          <Text style={styles.metricsTitle}>📊 סטטיסטיקה במועדון</Text>
          {metrics.map((m) => (
            <MetricRow key={m.key} m={m} />
          ))}
        </View>

        {/* together */}
        {together ? (
          <View style={styles.together}>
            <Text style={styles.togetherBig}>{together.pct}%</Text>
            <Text style={styles.togetherTxt}>
              <Text style={styles.togetherBold}>🤝 כשאתם באותה קבוצה</Text>
              {'\n'}
              ניצחתם ב-{together.wins} מתוך {together.total} משחקונים משותפים
            </Text>
          </View>
        ) : null}

        {/* verdict */}
        <View style={styles.verdict}>
          <Text style={styles.verdictTxt}>
            {verdict.leader === 'tie'
              ? `תיקו — כל אחד מוביל ב-${verdict.aLeads} קטגוריות`
              : `${youLead ? 'אתה' : b.name} מוביל ב-`}
            {verdict.leader !== 'tie' ? (
              <Text style={styles.verdictNum}>
                {youLead ? verdict.aLeads : verdict.bLeads} מתוך {verdict.total}
              </Text>
            ) : null}
            {verdict.leader !== 'tie' ? ' קטגוריות 🔥' : ''}
          </Text>
        </View>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  card: { backgroundColor: C.bg, borderRadius: 22, padding: 12, gap: 12 },
  hero: {
    backgroundColor: C.blueDeep,
    borderRadius: 20,
    padding: 16,
    alignItems: 'center',
  },
  brandRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    marginBottom: 8,
  },
  brand: { color: '#fff', fontWeight: '900', fontSize: 15 },
  brandPill: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 99,
    overflow: 'hidden',
  },
  players: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    alignSelf: 'stretch',
  },
  pl: { alignItems: 'center', gap: 5, flex: 1 },
  nm: { color: '#fff', fontWeight: '800', fontSize: 15 },
  sub: { color: 'rgba(255,255,255,0.8)', fontSize: 11 },
  vs: { color: 'rgba(255,255,255,0.9)', fontWeight: '900', fontSize: 15 },
  h2h: { alignItems: 'center', marginTop: 12 },
  h2hLbl: { color: 'rgba(255,255,255,0.85)', fontSize: 11.5 },
  h2hScore: { flexDirection: 'row', alignItems: 'baseline', gap: 14 },
  h2hNum: { color: '#fff', fontWeight: '900', fontSize: 44 },
  h2hWin: { color: C.gold },
  h2hDash: { color: 'rgba(255,255,255,0.6)', fontSize: 24, fontWeight: '800' },
  h2hFoot: { color: 'rgba(255,255,255,0.8)', fontSize: 11, marginTop: 2 },
  verdictPill: {
    marginTop: 10,
    backgroundColor: 'rgba(255,255,255,0.16)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 99,
  },
  verdictPillTxt: { color: '#fff', fontWeight: '700', fontSize: 12.5 },

  metrics: {
    backgroundColor: C.card,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: C.line,
  },
  metricsTitle: {
    color: C.muted,
    fontWeight: '700',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 10,
  },
  row: { paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.line },
  rvals: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  val: { fontWeight: '800', fontSize: 18, flex: 1 },
  valYou: { textAlign: 'right', color: C.blue },
  valHim: { textAlign: 'left', color: C.slate },
  valWin: { color: C.green },
  rlbl: { fontSize: 12, color: C.muted, textAlign: 'center', flex: 1.4 },
  bar: { flexDirection: 'row', height: 7, gap: 3 },
  barSeg: {
    flex: 1,
    height: '100%',
    backgroundColor: C.slateTint,
    borderRadius: 99,
    overflow: 'hidden',
  },
  // left half fills from its right edge (other player), right half from its left (you)
  fillLeft: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: C.slate,
    borderRadius: 99,
  },
  fillRight: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: C.blue,
    borderRadius: 99,
  },

  together: {
    backgroundColor: C.blueTint,
    borderRadius: 16,
    padding: 13,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
  },
  togetherBig: { color: C.blue, fontWeight: '900', fontSize: 26 },
  togetherTxt: { color: C.ink, fontSize: 12.5, lineHeight: 18, flex: 1 },
  togetherBold: { fontWeight: '800' },

  verdict: {
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.blue,
    borderStyle: 'dashed',
    padding: 12,
    alignItems: 'center',
  },
  verdictTxt: { fontWeight: '800', fontSize: 14, color: C.ink, textAlign: 'center' },
  verdictNum: { color: C.blue },
});
