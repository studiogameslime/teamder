// EveningSummaryCard — the shareable "סיכום הערב" card, in the app's LIGHT
// palette so it belongs inside Teamder (which is light). Wrapped in a forwardRef
// View so the screen can hand the node to react-native-view-shot's captureRef.
//
// Every richer section renders only when its data exists on the model, so the
// SAME component gracefully covers phase-1 (score+result+goals), phase-2
// (contribution + held-the-pitch), phase-3 (physical panel) and phase-4
// (heatmap + DNA radar). A player with no wearable just sees the game sections.

import React, { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient,
  Polygon,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import type { EveningSummaryModel } from '@/services/eveningSummaryService';

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

function initial(name: string): string {
  const t = (name || '').trim();
  return t ? Array.from(t)[0] : '⚽';
}

// ── effort ring ─────────────────────────────────────────────────────────────
function EffortRing({ score }: { score: number }) {
  const size = 78;
  const r = 31;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  return (
    <Svg width={size} height={size}>
      <Defs>
        <LinearGradient id="effort" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#F59E0B" />
          <Stop offset="1" stopColor="#EF4444" />
        </LinearGradient>
      </Defs>
      <Circle cx={cx} cy={cy} r={r} stroke="#EEF1F5" strokeWidth={9} fill="none" />
      <Circle
        cx={cx}
        cy={cy}
        r={r}
        stroke="url(#effort)"
        strokeWidth={9}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - pct)}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <SvgText x={cx} y={cy - 1} fontSize={19} fontWeight="800" fill={C.ink} textAnchor="middle">
        {String(score)}
      </SvgText>
      <SvgText x={cx} y={cy + 12} fontSize={8} fontWeight="700" fill={C.muted} textAnchor="middle">
        מאמץ
      </SvgText>
    </Svg>
  );
}

// ── heat pitch — soft overlapping blobs (a real-looking heatmap) ─────────────
function HeatPitch({ grid, rows, cols }: { grid: number[]; rows: number; cols: number }) {
  const W = 104;
  const H = 132;
  const cw = W / cols;
  const ch = H / rows;
  const blobR = Math.max(cw, ch) * 1.35;
  const blobs = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = Math.max(0, Math.min(1, grid[r * cols + c] || 0));
      if (v <= 0.08) continue;
      blobs.push(
        <Circle
          key={`${r}-${c}`}
          cx={(c + 0.5) * cw}
          cy={(r + 0.5) * ch}
          r={blobR}
          fill="url(#blob)"
          opacity={Math.min(1, 0.22 + v * 0.78)}
        />,
      );
    }
  }
  return (
    <Svg width={W} height={H}>
      <Defs>
        <LinearGradient id="grass" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#1F9D4D" />
          <Stop offset="1" stopColor="#178A41" />
        </LinearGradient>
        <RadialGradient id="blob" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#FF3B30" stopOpacity="0.9" />
          <Stop offset="55%" stopColor="#FBBF24" stopOpacity="0.45" />
          <Stop offset="100%" stopColor="#FBBF24" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={W} height={H} rx={8} fill="url(#grass)" />
      {blobs}
      <G stroke="rgba(255,255,255,0.55)" strokeWidth={1.2} fill="none">
        <Rect x={1} y={1} width={W - 2} height={H - 2} rx={8} />
        <Line x1={0} y1={H / 2} x2={W} y2={H / 2} />
        <Circle cx={W / 2} cy={H / 2} r={12} />
      </G>
    </Svg>
  );
}

// ── DNA radar ───────────────────────────────────────────────────────────────
const RADAR_AXES: Array<{ key: 'attack' | 'speed' | 'run' | 'stamina' | 'assist'; label: string }> = [
  { key: 'attack', label: 'התקפה' },
  { key: 'speed', label: 'מהירות' },
  { key: 'run', label: 'ריצה' },
  { key: 'stamina', label: 'סיבולת' },
  { key: 'assist', label: 'בישול' },
];

function RadarChart({
  radar,
}: {
  radar: { attack: number; speed: number; run: number; stamina: number; assist: number };
}) {
  const size = 150;
  const cx = size / 2;
  const cy = size / 2 + 4;
  const R = 46;
  const n = RADAR_AXES.length;
  const pt = (i: number, mag: number) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cx + R * mag * Math.cos(ang), cy + R * mag * Math.sin(ang)];
  };
  const outer = RADAR_AXES.map((_, i) => pt(i, 1).join(',')).join(' ');
  const mid = RADAR_AXES.map((_, i) => pt(i, 0.5).join(',')).join(' ');
  const val = RADAR_AXES.map((a, i) => pt(i, radar[a.key]).join(',')).join(' ');
  return (
    <Svg width={size} height={size}>
      <Polygon points={outer} fill="#F3F6FC" stroke="#D8E0EE" strokeWidth={1} />
      <Polygon points={mid} fill="none" stroke="#E2E8F2" strokeWidth={1} />
      <G stroke="#E2E8F2" strokeWidth={1}>
        {RADAR_AXES.map((_, i) => {
          const [x, y] = pt(i, 1);
          return <Line key={i} x1={cx} y1={cy} x2={x} y2={y} />;
        })}
      </G>
      <Polygon points={val} fill="rgba(37,99,235,0.22)" stroke="#2563EB" strokeWidth={2} />
      {RADAR_AXES.map((a, i) => {
        const [x, y] = pt(i, 1.16);
        return (
          <SvgText key={a.key} x={x} y={y + 3} fontSize={8} fontWeight="700" fill="#64748B" textAnchor="middle">
            {a.label}
          </SvgText>
        );
      })}
    </Svg>
  );
}

interface Props {
  model: EveningSummaryModel;
}

export const EveningSummaryCard = forwardRef<View, Props>(
  function EveningSummaryCard({ model }, ref) {
    const p = model.physical;
    const zoneTotal =
      p ? p.hrZones.light + p.hrZones.moderate + p.hrZones.intense + p.hrZones.peak : 0;
    const gritDistance = p ? ` · רצת ${p.distanceKm} ק״מ` : '';
    // In winner-stays the player sits some mini-games out, so show played-of-
    // total when the total is known and larger than what they played.
    const showTotal = model.totalKnown && model.totalRounds > model.rounds;
    const roundsMeta = showTotal
      ? `${model.rounds} מתוך ${model.totalRounds}`
      : `${model.rounds}`;
    const gritRounds = showTotal
      ? `${model.rounds} מתוך ${model.totalRounds} המשחקונים`
      : model.totalKnown
        ? `את כל ${model.rounds} המשחקונים`
        : `${model.rounds} משחקונים`;
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
            <Text style={styles.kickerTxt}>סיכום הערב</Text>
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
            <Text style={styles.meta} numberOfLines={1}>
              {roundsMeta} משחקונים · {model.dateLabel} · {model.communityName}
            </Text>
          </View>
        </View>

        {/* score hero */}
        <View style={styles.score}>
          <Text style={styles.scoreNum}>{model.score.toFixed(1)}</Text>
          <View style={styles.scoreText}>
            <Text style={styles.tier}>
              {model.title} {model.titleEmoji}
            </Text>
            <Text style={styles.scoreLabel}>ציון הערב שלך</Text>
            <Text style={styles.scoreSub}>מגולים, בישולים ומאמץ — לא רק משערים</Text>
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

        {/* held the pitch (winner-stays) */}
        {model.heldPitch >= 2 ? (
          <View style={[styles.strip, styles.stripGold]}>
            <Text style={styles.stripIco}>🏰</Text>
            <Text style={styles.stripTxt}>
              החזקתם את המגרש{' '}
              <Text style={styles.stripBoldGold}>{model.heldPitch} משחקונים ברצף</Text>
            </Text>
          </View>
        ) : null}

        {/* contribution */}
        {model.contribution ? (
          <View style={styles.contrib}>
            <View style={styles.contribTop}>
              <Text style={styles.contribLabel}>📊 התרומה שלך</Text>
              <Text style={styles.contribBig}>
                {model.contribution.pct}
                <Text style={styles.contribPct}>%</Text>
              </Text>
            </View>
            <View style={styles.bar}>
              <View
                style={[
                  styles.barFill,
                  { width: `${Math.max(4, Math.min(100, model.contribution.pct))}%` },
                ]}
              />
            </View>
            <Text style={styles.contribSub}>
              נגעת ב-
              <Text style={styles.contribSubStrong}>
                {model.contribution.touched} מתוך {model.contribution.teamGoals}
              </Text>{' '}
              מהגולים של הקבוצה שלך
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

        {/* grit / effort — always shows the player did the work */}
        <View style={[styles.strip, styles.stripLime]}>
          <Text style={styles.stripIco}>💪</Text>
          <Text style={styles.stripTxt}>
            עבדת קשה — שיחקת{' '}
            <Text style={styles.stripBoldLime}>{gritRounds}</Text>
            {gritDistance}
          </Text>
        </View>

        {/* physical panel */}
        {p ? (
          <View style={styles.watch}>
            <View style={styles.watchHead}>
              <Text style={styles.watchTitle}>הנתונים הפיזיים שלך</Text>
              <View style={styles.wBadge}>
                <View style={styles.wDot} />
                <Text style={styles.wBadgeTxt}>מהשעון</Text>
              </View>
            </View>
            <View style={styles.watchBody}>
              <EffortRing score={p.effortScore} />
              <View style={styles.wMetrics}>
                <WMetric label="מרחק ריצה" value={`${p.distanceKm}`} unit=" ק״מ" color={C.green} />
                <WMetric label="מהירות שיא" value={`${p.topSpeedKmh}`} unit=" קמ״ש" color={C.cyan} />
                <WMetric label="ספרינטים" value={`${p.sprints}`} color={C.ink} />
                <WMetric label="דופק מקסימלי" value={`${p.maxHr}`} color={C.red} />
              </View>
            </View>
            {/* HR zones */}
            {zoneTotal > 0 ? (
              <View style={styles.zones}>
                <View style={styles.zbar}>
                  <View style={[styles.zseg, { flex: p.hrZones.light || 0.001, backgroundColor: '#22C55E' }]} />
                  <View style={[styles.zseg, { flex: p.hrZones.moderate || 0.001, backgroundColor: '#EAB308' }]} />
                  <View style={[styles.zseg, { flex: p.hrZones.intense || 0.001, backgroundColor: '#F97316' }]} />
                  <View style={[styles.zseg, { flex: p.hrZones.peak || 0.001, backgroundColor: '#EF4444' }]} />
                </View>
                <View style={styles.zLegend}>
                  <ZLegend color="#22C55E" label={`קל · ${p.hrZones.light}ד׳`} />
                  <ZLegend color="#EAB308" label={`בינוני · ${p.hrZones.moderate}ד׳`} />
                  <ZLegend color="#F97316" label={`אינטנסיבי · ${p.hrZones.intense}ד׳`} />
                  <ZLegend color="#EF4444" label={`שיא · ${p.hrZones.peak}ד׳`} />
                </View>
              </View>
            ) : null}
            <View style={styles.wFoot}>
              <WFoot value={`${p.avgSpeedKmh}`} label="מהירות ממוצעת" />
              <WFoot value={`${p.steps}`} label="צעדים" />
              <WFoot value={`${p.calories}`} label="קלוריות" />
            </View>
          </View>
        ) : null}

        {/* heatmap */}
        {model.heatmap ? (
          <View style={styles.viz}>
            <HeatPitch grid={model.heatmap.grid} rows={model.heatmap.rows} cols={model.heatmap.cols} />
            <View style={styles.vizText}>
              <Text style={styles.vizTitle}>🗺️ מפת-חום · איפה חיית</Text>
              <View style={styles.vChips}>
                <View style={styles.vChip}>
                  <Text style={styles.vChipTxt}>{model.heatmap.zones.attack}% התקפה</Text>
                </View>
                <View style={styles.vChip}>
                  <Text style={styles.vChipTxt}>{model.heatmap.zones.middle}% אמצע</Text>
                </View>
                <View style={styles.vChip}>
                  <Text style={styles.vChipTxt}>{model.heatmap.zones.defense}% הגנה</Text>
                </View>
              </View>
            </View>
          </View>
        ) : null}

        {/* radar / DNA */}
        {model.radar ? (
          <View style={styles.viz}>
            <RadarChart radar={model.radar} />
            <View style={styles.vizText}>
              <Text style={styles.vizTitle}>🕸️ ה-DNA שלך הערב</Text>
              <View style={styles.vChips}>
                <View style={styles.vChip}>
                  <Text style={styles.vChipTxt}>הפרופיל שלך: {model.radar.profile}</Text>
                </View>
              </View>
            </View>
          </View>
        ) : null}

        {/* funny numbers */}
        {model.fun ? (
          <View style={styles.fun}>
            <Text style={styles.funTitle}>😄 מספרים מהערב</Text>
            <FunRow first icon="🍕" text={`שרפת ${model.fun.pizzas} פיצות של אנרגיה`} />
            <FunRow icon="📏" text={`רצת ${model.fun.fieldLengths} אורכי-מגרש`} />
            <FunRow icon="🔋" text={`מספיק ל-${model.fun.phoneCharges} טעינות טלפון`} />
          </View>
        ) : null}
      </View>
    );
  },
);

function WMetric({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: string;
  unit?: string;
  color: string;
}) {
  return (
    <View style={styles.wm}>
      <Text style={styles.wmLabel}>{label}</Text>
      <Text style={[styles.wmVal, { color }]}>
        {value}
        {unit ? <Text style={styles.wmUnit}>{unit}</Text> : null}
      </Text>
    </View>
  );
}

function ZLegend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.zl}>
      <View style={[styles.zlDot, { backgroundColor: color }]} />
      <Text style={styles.zlTxt}>{label}</Text>
    </View>
  );
}

function WFoot({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.wf}>
      <Text style={styles.wfVal}>{value}</Text>
      <Text style={styles.wfLabel}>{label}</Text>
    </View>
  );
}

function FunRow({ icon, text, first }: { icon: string; text: string; first?: boolean }) {
  return (
    <View style={[styles.funRow, first && styles.funRowFirst]}>
      <Text style={styles.funIcon}>{icon}</Text>
      <Text style={styles.funTxt}>{text}</Text>
    </View>
  );
}

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
  stripIco: { fontSize: 20 },
  stripTxt: { flex: 1, color: C.ink, fontSize: 13, fontWeight: '700' },
  stripBoldGold: { color: C.goldDeep, fontWeight: '800' },
  stripBoldLime: { color: C.green, fontWeight: '800' },

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
