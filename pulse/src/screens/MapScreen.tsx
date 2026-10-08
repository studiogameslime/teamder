import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Circle, Text as SvgText } from 'react-native-svg';
import { Screen, Card, SectionHeader, Empty } from '../components/ui';
import { colors } from '../theme';
import {
  fetchCommunityPoints, fetchGamePoints,
  type CommunityPoint, type GamePoint,
} from '../services/firebase';

// lat/lng for major Israeli cities. Keys are NORMALISED Hebrew names
// (spaces/hyphens/quotes stripped) so minor spelling variants still match.
const CITY: Record<string, [number, number]> = {
  תלאביב: [32.08, 34.78], תלאביביפו: [32.08, 34.78],
  ירושלים: [31.77, 35.21], חיפה: [32.79, 34.99],
  ראשוןלציון: [31.96, 34.8], פתחתקווה: [32.09, 34.89], פתחתקוה: [32.09, 34.89],
  אשדוד: [31.8, 34.65], נתניה: [32.33, 34.86], בארשבע: [31.25, 34.79],
  בניברק: [32.08, 34.83], חולון: [32.01, 34.78], רמתגן: [32.07, 34.82],
  אשקלון: [31.67, 34.57], רחובות: [31.89, 34.81], בתים: [32.02, 34.75],
  כפרסבא: [32.18, 34.91], הרצליה: [32.16, 34.84], חדרה: [32.43, 34.92],
  מודיעין: [31.9, 35.01], מודיעיןמכביםרעות: [31.9, 35.01], נצרת: [32.7, 35.3],
  לוד: [31.95, 34.9], רעננה: [32.18, 34.87], רמלה: [31.93, 34.87],
  גבעתיים: [32.07, 34.81], הודהשרון: [32.15, 34.89], קריתאתא: [32.81, 35.1],
  קרייתאתא: [32.81, 35.1], נהריה: [33.01, 35.09], עכו: [32.93, 35.07],
  אילת: [29.56, 34.95], טבריה: [32.79, 35.53], צפת: [32.96, 35.5],
  דימונה: [31.07, 35.03], אריאל: [32.1, 35.18], יבנה: [31.88, 34.74],
  נסציונה: [31.93, 34.8], קריתגת: [31.61, 34.77], קרייתגת: [31.61, 34.77],
  אוריהודה: [32.03, 34.85], רמתהשרון: [32.15, 34.84], עפולה: [32.61, 35.29],
  כרמיאל: [32.92, 35.3], קרייתשמונה: [33.21, 35.57], ביתשמש: [31.75, 34.99],
  גןיבנה: [31.78, 34.7], קרייתביאליק: [32.83, 35.08], קרייתמוצקין: [32.84, 35.08],
  פרדסחנהכרכור: [32.47, 34.97], נשר: [32.77, 35.04], טירתכרמל: [32.76, 34.97],
};

// Simplified Israel border (lat, lng), traced N → coast → south → up the
// Jordan side → back north. Same projection as the dots, so they line up.
const BORDER: [number, number][] = [
  [33.28, 35.58], [33.1, 35.1], [32.83, 35.07], [32.55, 34.91], [32.08, 34.76],
  [31.66, 34.56], [31.35, 34.27], [30.95, 34.4], [30.4, 34.66], [29.55, 34.95],
  [30.1, 35.08], [30.6, 35.18], [31.3, 35.45], [31.75, 35.55], [32.4, 35.57],
  [32.7, 35.57], [33.0, 35.65], [33.28, 35.78],
];

const BB = { minLat: 29.45, maxLat: 33.35, minLng: 34.2, maxLng: 35.95 };
const W = 200;
const H = 470;
function proj(lat: number, lng: number): [number, number] {
  const x = ((lng - BB.minLng) / (BB.maxLng - BB.minLng)) * W;
  const y = ((BB.maxLat - lat) / (BB.maxLat - BB.minLat)) * H;
  return [x, y];
}
const norm = (s: string) => s.replace(/['"\-\s־]/g, '').trim();

export function MapScreen() {
  const [comms, setComms] = useState<CommunityPoint[]>([]);
  const [games, setGames] = useState<GamePoint[]>([]);

  // All-time communities + games, fetched once. Each carries lat/lng (and/or a
  // city) — they drive the two map layers and enrich the city→coords lookup.
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetchCommunityPoints().catch(() => [] as CommunityPoint[]),
      fetchGamePoints().catch(() => [] as GamePoint[]),
    ]).then(([c, g]) => {
      if (!alive) return;
      setComms(c);
      setGames(g);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Expand the city→coords lookup: any city seen on a community or game that
  // carries real lat/lng becomes plottable, on top of the static dict — so a
  // city-only record still lands on the map (locations & cities, no addresses).
  const cityCoords = useMemo(() => {
    const m: Record<string, [number, number]> = { ...CITY };
    const add = (city?: string, lat?: number, lng?: number) => {
      if (city && typeof lat === 'number' && typeof lng === 'number') {
        const k = norm(city);
        if (!m[k]) m[k] = [lat, lng];
      }
    };
    for (const c of comms) add(c.city, c.lat, c.lng);
    for (const g of games) add(g.city, g.lat, g.lng);
    return m;
  }, [comms, games]);

  // Resolve a point's coordinates: real lat/lng first, else the city centroid.
  const coordsOf = useMemo(() => {
    return (lat?: number, lng?: number, city?: string): [number, number] | undefined => {
      if (typeof lat === 'number' && typeof lng === 'number') return [lat, lng];
      if (city) return cityCoords[norm(city)];
      return undefined;
    };
  }, [cityCoords]);

  // Layer 1 — every community of all time, placed by its coords or its city.
  const commPlaced = useMemo(
    () =>
      comms
        .map((c) => ({ ...c, coords: coordsOf(c.lat, c.lng, c.city) }))
        .filter((c): c is CommunityPoint & { coords: [number, number] } => !!c.coords)
        .sort((a, b) => b.members - a.members),
    [comms, coordsOf],
  );
  const maxMembers = commPlaced.reduce((mx, c) => Math.max(mx, c.members), 1);

  // Layer 2 — every game of all time, placed by its field coords or its city.
  const gamePlaced = useMemo(
    () =>
      games
        .map((g) => ({ ...g, coords: coordsOf(g.lat, g.lng, g.city) }))
        .filter((g): g is GamePoint & { coords: [number, number] } => !!g.coords)
        .sort((a, b) => b.players - a.players),
    [games, coordsOf],
  );
  const maxPlayers = gamePlaced.reduce((mx, g) => Math.max(mx, g.players), 1);

  // The list: one row per city with how many communities + games sit there
  // (locations & cities only — names don't matter, counts do).
  const byCity = useMemo(() => {
    const m = new Map<string, { comms: number; games: number }>();
    const bump = (city: string | undefined, key: 'comms' | 'games') => {
      const c = (city || '').trim();
      if (!c) return;
      const e = m.get(c) ?? { comms: 0, games: 0 };
      e[key] += 1;
      m.set(c, e);
    };
    for (const c of comms) bump(c.city, 'comms');
    for (const g of games) bump(g.city, 'games');
    return [...m.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.comms + b.games - (a.comms + a.games));
  }, [comms, games]);

  const borderPath =
    'M' +
    BORDER.map(([la, ln]) => proj(la, ln).map((n) => n.toFixed(1)).join(',')).join(' L') +
    ' Z';

  const GREEN = colors.green ?? '#22C55E';
  const AMBER = colors.amber ?? '#F59E0B';

  return (
    <Screen
      title="מפה"
      subtitle={`${commPlaced.length} מועדונים · ${gamePlaced.length} משחקים על המפה`}
    >
      {commPlaced.length === 0 && gamePlaced.length === 0 ? (
        <Empty text="אין נתוני מיקום להצגה" />
      ) : (
        <Card>
          <Svg width="100%" height={H} viewBox={`-12 -12 ${W + 24} ${H + 24}`}>
            <Path d={borderPath} fill={colors.surfaceAlt} stroke={colors.border} strokeWidth={1.2} />
            {/* Layer 1 — communities of all time, by coords/city, sized by members. */}
            {commPlaced.map((c) => {
              const [x, y] = proj(c.coords[0], c.coords[1]);
              const r = 4 + (c.members / maxMembers) * 16;
              return (
                <Circle
                  key={'c' + c.id}
                  cx={x}
                  cy={y}
                  r={r}
                  fill={GREEN}
                  fillOpacity={0.4}
                  stroke={GREEN}
                  strokeWidth={1.3}
                />
              );
            })}
            {/* Layer 2 — games of all time, by field coords/city, sized by players. */}
            {gamePlaced.map((g) => {
              const [x, y] = proj(g.coords[0], g.coords[1]);
              const r = 3 + (g.players / maxPlayers) * 10;
              return (
                <Circle
                  key={'g' + g.id}
                  cx={x}
                  cy={y}
                  r={r}
                  fill={AMBER}
                  fillOpacity={0.6}
                  stroke={AMBER}
                  strokeWidth={1.1}
                />
              );
            })}
          </Svg>
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: GREEN }]} />
              <Text style={styles.legendTxt}>מועדונים</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: AMBER }]} />
              <Text style={styles.legendTxt}>משחקים</Text>
            </View>
          </View>
        </Card>
      )}

      <SectionHeader>לפי עיר</SectionHeader>
      {byCity.length ? (
        <Card>
          <View style={[styles.row, styles.headRow]}>
            <Text style={styles.city}>עיר</Text>
            <Text style={[styles.colLabel, { color: AMBER }]}>משחקים</Text>
            <Text style={[styles.colLabel, { color: GREEN }]}>מועדונים</Text>
          </View>
          {byCity.map((c) => (
            <View key={c.name} style={styles.row}>
              <Text style={styles.city} numberOfLines={1}>{c.name}</Text>
              <Text style={[styles.count, { color: AMBER }]}>{c.games || '–'}</Text>
              <Text style={[styles.count, { color: GREEN }]}>{c.comms || '–'}</Text>
            </View>
          ))}
        </Card>
      ) : (
        <Empty text="אין מיקומים להצגה" />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row-reverse', gap: 16, justifyContent: 'center', marginTop: 8 },
  legendItem: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  dot: { width: 11, height: 11, borderRadius: 6 },
  legendTxt: { color: colors.textMuted, fontSize: 12 },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, paddingVertical: 7 },
  headRow: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingBottom: 8, marginBottom: 2 },
  colLabel: { fontSize: 11, fontWeight: '800', minWidth: 56, textAlign: 'center' },
  count: { color: colors.primary, fontWeight: '800', fontSize: 15, minWidth: 56, textAlign: 'center' },
  city: { color: colors.text, fontSize: 14, flex: 1, textAlign: 'right' },
  note: { color: colors.textMuted, fontSize: 12, marginTop: 8, textAlign: 'right' },
});
