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
  red: '#DC2626',
};

function fmt(v: number, f: CompareMetric['format']): string {
  if (f === 'pct') return `${v}%`;
  if (f === 'avg1') return v.toFixed(1);
  return String(v);
}

function MetricRow({ m, last }: { m: CompareMetric; last?: boolean }) {
  // One continuous bar split by the SHARE each player holds of the total, so
  // the wider colour = the bigger stat. You (blue) sit on the right, the other
  // player (red) on the left — matching the numbers above.
  const total = m.a + m.b || 1;
  const aShare = `${(m.a / total) * 100}%` as DimensionValue;
  const bShare = `${(m.b / total) * 100}%` as DimensionValue;
  const aWin = m.winner === 'a';
  const bWin = m.winner === 'b';
  return (
    <View style={[styles.row, last && styles.rowLast]}>
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
      <View style={styles.bar}>
        {/* first child → right (you, blue); second → left (opponent, red).
            minWidth keeps a shutout (0) still showing a sliver of each side. */}
        <View style={[styles.barYou, { width: aShare }]} />
        <View style={[styles.barThem, { width: bShare }]} />
      </View>
    </View>
  );
}

export const PlayerCompareCard = forwardRef<View, { model: ComparisonModel }>(
  function PlayerCompareCard({ model }, ref) {
    const { a, b, metrics, verdict } = model;
    const youLead = verdict.leader === 'a';
    const tie = verdict.leader === 'tie';
    const leadCount = youLead ? verdict.aLeads : verdict.bLeads;

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
              {/* Prefer a real uploaded photo when the user has one; Avatar
                  otherwise ignores `uri` whenever an avatarId is set (user
                  report: "show my photo if I have one"). */}
              <Avatar
                avatarId={a.photo ? undefined : a.avatarId}
                uri={a.photo}
                name={a.name}
                size={62}
                showRing
                ringColor="#93C5FD"
              />
              <Text style={styles.nm}>{a.name}</Text>
              <View style={[styles.teamChip, { backgroundColor: C.blue }]}>
                <Text style={styles.teamChipTxt}>אתה</Text>
              </View>
            </View>
            <Text style={styles.vs}>VS</Text>
            <View style={styles.pl}>
              <Avatar
                avatarId={b.photo ? undefined : b.avatarId}
                uri={b.photo}
                name={b.name}
                size={62}
                showRing
                ringColor="#F87171"
              />
              <Text style={styles.nm}>{b.name}</Text>
              <View style={[styles.teamChip, { backgroundColor: C.red }]}>
                <Text style={styles.teamChipTxt}>יריב</Text>
              </View>
            </View>
          </View>

          {/* verdict headline — who leads more of the per-community metrics */}
          <View style={styles.verdictHead}>
            <Text style={styles.verdictHeadTop}>
              {tie ? '🤝 שקול' : youLead ? 'אתה מוביל 👑' : `${b.name} מוביל 👑`}
            </Text>
            <Text style={styles.verdictHeadSub}>
              {tie
                ? `כל אחד מוביל ב-${verdict.aLeads} מתוך ${verdict.total} קטגוריות`
                : `ב-${leadCount} מתוך ${verdict.total} קטגוריות במועדון 🔥`}
            </Text>
          </View>
        </View>

        {/* metrics */}
        <View style={styles.metrics}>
          <Text style={styles.metricsTitle}>📊 סטטיסטיקה</Text>
          {metrics.map((m, i) => (
            <MetricRow key={m.key} m={m} last={i === metrics.length - 1} />
          ))}
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
  teamChip: {
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 99,
    marginTop: 1,
  },
  teamChipTxt: { color: '#fff', fontSize: 11, fontWeight: '800' },
  vs: { color: 'rgba(255,255,255,0.9)', fontWeight: '900', fontSize: 15 },
  verdictHead: { alignItems: 'center', marginTop: 14 },
  verdictHeadTop: { color: '#fff', fontWeight: '900', fontSize: 26 },
  verdictHeadSub: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 12.5,
    fontWeight: '600',
    marginTop: 3,
  },

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
  rowLast: { borderBottomWidth: 0 },
  rvals: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  val: { fontWeight: '900', fontSize: 20, flex: 1 },
  valYou: { textAlign: 'right', color: C.blue },
  valHim: { textAlign: 'left', color: C.red },
  valWin: { color: C.green },
  rlbl: { fontSize: 12, color: C.muted, textAlign: 'center', flex: 1.4 },
  bar: {
    flexDirection: 'row',
    height: 9,
    borderRadius: 99,
    overflow: 'hidden',
    backgroundColor: C.slateTint,
    gap: 2,
  },
  barYou: { height: '100%', minWidth: 4, borderRadius: 99, backgroundColor: C.blue },
  barThem: { height: '100%', minWidth: 4, borderRadius: 99, backgroundColor: C.red },
});
