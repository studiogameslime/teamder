// PitchCalibrationScreen — calibrate a community's pitch ONCE by standing at
// each of the 4 corners and tapping "סמן פינה". Stores the 4 GPS corners on the
// group (via savePitchCalibration) so every future game's heatmap normalizes
// into the same fixed rectangle. Uses a one-shot foreground GPS read (the same
// pattern as nearby.ts) — the watch-side flow is a native follow-up.

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient,
  Polyline,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { toast } from '@/components/Toast';
import { logError } from '@/services/errorLog';
import { pitchCalibrationService } from '@/services/pitchCalibrationService';
import { colors, spacing, radius, typography } from '@/theme';
import { he } from '@/i18n/he';
import type { LatLng } from '@/utils/physical';
import type { CommunitiesStackParamList } from '@/navigation/CommunitiesStack';

type Nav = NativeStackNavigationProp<CommunitiesStackParamList, 'PitchCalibration'>;
type Params = RouteProp<CommunitiesStackParamList, 'PitchCalibration'>;

const CORNER_LABELS = ['פינה 1', 'פינה 2', 'פינה 3', 'פינה 4'];

async function readPosition(): Promise<{ point: LatLng; accuracy: number } | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const Location = require('expo-location');
    let perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Highest,
    });
    return {
      point: { lat: pos.coords.latitude, lng: pos.coords.longitude },
      accuracy: pos.coords.accuracy ?? 999,
    };
  } catch {
    return null;
  }
}

// A live schematic of the pitch — the 4 corners light up (and connect) in
// order as they're marked, so the user SEES the pitch taking shape. Corner
// order (TL→TR→BR→BL, clockwise) matches "פינה 1..4".
const PITCH_CORNERS: Array<[number, number]> = [
  [28, 26],
  [172, 26],
  [172, 124],
  [28, 124],
];

function PitchDiagram({ done }: { done: number }) {
  const W = 200;
  const H = 150;
  const marked = PITCH_CORNERS.slice(0, done);
  return (
    <Svg width="100%" height={172} viewBox={`0 0 ${W} ${H}`}>
      <Defs>
        <LinearGradient id="calgrass" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#2AA157" />
          <Stop offset="1" stopColor="#1C8A45" />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={W} height={H} rx={12} fill="#EAF1E7" />
      <Rect x={28} y={26} width={144} height={98} rx={4} fill="url(#calgrass)" stroke="rgba(255,255,255,0.85)" strokeWidth={2} />
      <G stroke="rgba(255,255,255,0.7)" strokeWidth={1.5} fill="none">
        <Line x1={28} y1={75} x2={172} y2={75} />
        <Circle cx={100} cy={75} r={14} />
      </G>
      {done >= 2 ? (
        <Polyline
          points={marked.map((p) => p.join(',')).join(' ')}
          fill="none"
          stroke="#1D4ED8"
          strokeWidth={3}
          strokeLinecap="round"
        />
      ) : null}
      {done >= 1 && done < 4 ? (
        <Polyline
          points={[PITCH_CORNERS[done - 1], PITCH_CORNERS[done]].map((p) => p.join(',')).join(' ')}
          fill="none"
          stroke="#94A3B8"
          strokeWidth={2}
          strokeDasharray="3 5"
        />
      ) : null}
      {PITCH_CORNERS.map((p, i) => {
        const on = i < done;
        return (
          <G key={i}>
            <Circle
              cx={p[0]}
              cy={p[1]}
              r={on ? 11 : 9}
              fill={on ? '#1D4ED8' : '#FFFFFF'}
              stroke={on ? '#FFFFFF' : '#9CA3AF'}
              strokeWidth={on ? 2.5 : 2}
              strokeDasharray={on ? undefined : '2 2'}
            />
            <SvgText
              x={p[0]}
              y={p[1] + 4}
              fontSize={on ? 11 : 10}
              fontWeight="800"
              fill={on ? '#FFFFFF' : '#6B7280'}
              textAnchor="middle"
            >
              {on ? '✓' : String(i + 1)}
            </SvgText>
          </G>
        );
      })}
      {done < 4 ? (
        <Circle cx={PITCH_CORNERS[done][0]} cy={PITCH_CORNERS[done][1]} r={17} fill="none" stroke="#1D4ED8" strokeWidth={2} opacity={0.4} />
      ) : null}
    </Svg>
  );
}

export function PitchCalibrationScreen() {
  const nav = useNavigation<Nav>();
  const { groupId } = useRoute<Params>().params;

  const [corners, setCorners] = useState<LatLng[]>([]);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  async function markCorner() {
    if (busy || corners.length >= 4) return;
    setBusy(true);
    const res = await readPosition();
    setBusy(false);
    if (!res) {
      toast.error(he.pitchGpsFailed);
      return;
    }
    setAccuracy(res.accuracy);
    setCorners((prev) => [...prev, res.point]);
  }

  async function finish() {
    if (corners.length !== 4 || saving) return;
    setSaving(true);
    try {
      const ok = await pitchCalibrationService.saveCorners(groupId, corners);
      if (ok) {
        toast.success(he.pitchSaved);
        nav.goBack();
      } else {
        toast.error(he.pitchSaveFailed);
      }
    } catch (err) {
      logError('pitchCalibration.finish', err, { groupId });
      toast.error(he.pitchSaveFailed);
    } finally {
      setSaving(false);
    }
  }

  const done = corners.length;
  const accColor =
    accuracy == null ? colors.textMuted : accuracy <= 8 ? colors.success : colors.warning;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={he.pitchTitle} />
      <View style={styles.body}>
        <View style={styles.diagram}>
          <PitchDiagram done={done} />
          <Text style={styles.diagramCap}>
            {done < 4 ? `סמן את פינה ${done + 1} מתוך 4` : 'כל הפינות סומנו — סיים כיול'}
          </Text>
        </View>
        <Card>
          <Text style={styles.h}>עמוד בכל פינה של המגרש ולחץ "סמן פינה"</Text>
          <Text style={styles.sub}>
            עצור שנייה-שתיים בכל פינה כדי שה-GPS יתייצב — כך הכיול הכי מדויק.
          </Text>

          <View style={styles.dots}>
            {CORNER_LABELS.map((label, i) => (
              <View key={label} style={styles.dotRow}>
                <View style={[styles.dot, i < done && styles.dotOn]}>
                  {i < done ? <Text style={styles.dotCheck}>✓</Text> : null}
                </View>
                <Text style={styles.dotLabel}>{label}</Text>
              </View>
            ))}
          </View>

          {accuracy != null ? (
            <Text style={[styles.acc, { color: accColor }]}>
              דיוק GPS ±{Math.round(accuracy)} מ׳
            </Text>
          ) : null}
        </Card>

        <View style={{ flex: 1 }} />

        {done < 4 ? (
          <Pressable
            style={({ pressed }) => [styles.btn, pressed && { opacity: 0.9 }]}
            onPress={markCorner}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnTxt}>📍 סמן פינה ({done}/4)</Text>
            )}
          </Pressable>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.btn, styles.btnDone, pressed && { opacity: 0.9 }]}
            onPress={finish}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnTxt}>{he.pitchFinish}</Text>
            )}
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, padding: spacing.lg },
  diagram: { marginBottom: spacing.lg, alignItems: 'center' },
  diagramCap: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
  h: { ...typography.h3, color: colors.text, textAlign: 'center' },
  sub: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  dots: { marginTop: spacing.lg, gap: spacing.sm },
  dotRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm },
  dot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  dotCheck: { color: '#fff', fontSize: 14, fontWeight: '800' },
  dotLabel: { ...typography.body, color: colors.text, fontWeight: '600' },
  acc: {
    marginTop: spacing.lg,
    textAlign: 'center',
    fontWeight: '800',
    fontSize: 13,
  },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDone: { backgroundColor: colors.success },
  btnTxt: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
