// MapScreen — full-screen map of games OR communities, one component, two
// modes. The chrome matches the product mockup: header + subtitle, a search
// row with a "locate me" button, mode-appropriate filter chips, a colour
// legend, a "show the other layer" toggle and a bottom detail card.
//
// Content is sorted by mode so the two maps never mix concerns:
//   • games        → date chips (הכל / היום / סופ״ש), a by-date legend,
//                     a "הצג מועדונים" toggle, and a game card.
//   • communities  → status chips (הכל / פתוחות), a "הצג משחקים" toggle,
//                     and a community card.
//
// Data arrives as serializable `MapItem[]` from the list screen that already
// loaded it (plus an optional overlay set for the toggle), so the map never
// re-fetches and works in mock mode identically.

import React, { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { BallSwitch } from '@/components/anim/BallSwitch';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  RouteProp,
  useNavigation,
  useRoute,
} from '@react-navigation/native';

import { MapWebView, type MapMarker } from '@/components/map/MapWebView';
import { ScreenHeader } from '@/components/ScreenHeader';
import { logError } from '@/services/errorLog';
import { colors, spacing, typography, radius, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

/** Date bucket for a game — drives pin colour + the chip filters. */
export type DateBucket = 'today' | 'tomorrow' | 'weekend' | 'other';

/** One pin + its card content. Plain & serializable for nav params. */
export interface MapItem {
  id: string;
  lat: number;
  lng: number;
  color?: string;
  title: string;
  subtitle: string;
  /** Trailing chip on the card, e.g. "7×7" or "23 שחקנים". */
  badge?: string;
  /** Games: when the game is — drives colour + date chips. */
  dateBucket?: DateBucket;
  /** Games: short time label for the card, e.g. "היום · 17:00". */
  timeLabel?: string;
  /** Has spots (games) / open membership (communities). Drives the
   *  "open only" filter toggle. Undefined = always shown. */
  open?: boolean;
}

export type MapScreenParams = {
  mode: 'games' | 'communities';
  items: MapItem[];
  /** Optional other-layer items shown when the toggle is on. */
  overlay?: MapItem[];
};

const ISRAEL_CENTER = { lat: 31.5, lng: 34.9 };

// By-date palette (games) — mirrors the legend in the mockup.
const BUCKET_COLOR: Record<DateBucket, string> = {
  today: '#2563EB',
  tomorrow: '#16A34A',
  weekend: '#EA580C',
  other: '#6B7280',
};

type GameChip = 'all' | 'today' | 'weekend';

type Nav = { navigate: (s: string, p?: object) => void; goBack: () => void };

export function MapScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<RouteProp<Record<string, MapScreenParams>, string>>();
  const { mode, items, overlay } = route.params ?? {
    mode: 'games',
    items: [],
  };
  const isGames = mode === 'games';

  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<GameChip>('all');
  const [openOnly, setOpenOnly] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [selected, setSelected] = useState<MapItem | null>(null);
  const [focusOn, setFocusOn] = useState<{
    lat: number;
    lng: number;
    zoom?: number;
  } | null>(null);
  const [locating, setLocating] = useState(false);

  // "Focus on my city" — fly to the user's GPS (with a timeout so it never
  // hangs); fall back to their first marker. Israel-only bounds keep the
  // view sane even if the fix is rough.
  const focusOnMe = async () => {
    if (locating) return;
    setLocating(true);
    try {
      const Location = await import('expo-location');
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const pos = (await Promise.race([
          Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          }),
          new Promise<null>((res) => setTimeout(() => res(null), 5000)),
        ])) as { coords: { latitude: number; longitude: number } } | null;
        if (pos) {
          setFocusOn({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            zoom: 13,
          });
        }
      }
    } catch (err) {
      // denied / unavailable — leave the view as-is.
      logError('mapLocateMe', err, { screen: 'MapScreen', mode });
      if (__DEV__) console.warn('[map] locate me failed', err);
    } finally {
      setLocating(false);
    }
  };

  // Synchronous initial centre — never block on GPS (it can hang on devices
  // without a fix). The map auto-fits to all markers anyway.
  const center = useMemo(
    () =>
      items.length > 0
        ? { lat: items[0].lat, lng: items[0].lng }
        : ISRAEL_CENTER,
    [items],
  );

  // Primary items filtered by the search query + the active chip.
  const filtered = useMemo(() => {
    const q = query.trim();
    return items.filter((it) => {
      if (q && !it.title.includes(q) && !it.subtitle.includes(q)) return false;
      if (isGames && chip === 'today' && it.dateBucket !== 'today') return false;
      if (isGames && chip === 'weekend' && it.dateBucket !== 'weekend') {
        return false;
      }
      // Filter toggle: only items with spots / open membership.
      if (openOnly && it.open === false) return false;
      return true;
    });
  }, [items, query, chip, isGames, openOnly]);

  // The markers actually rendered: filtered primary + (optionally) the
  // overlay layer (dimmed to a neutral tone so it reads as secondary).
  const markers = useMemo<MapMarker[]>(() => {
    const primary = filtered.map((it) => ({
      id: it.id,
      lat: it.lat,
      lng: it.lng,
      color: it.color,
    }));
    if (showOverlay && overlay) {
      const sec = overlay.map((it) => ({
        id: `ov:${it.id}`,
        lat: it.lat,
        lng: it.lng,
        color: '#94A3B8',
      }));
      return [...primary, ...sec];
    }
    return primary;
  }, [filtered, showOverlay, overlay]);

  const onMarkerPress = (id: string) => {
    const isOverlay = id.startsWith('ov:');
    const realId = isOverlay ? id.slice(3) : id;
    const pool = isOverlay && overlay ? overlay : items;
    setSelected(pool.find((i) => i.id === realId) ?? null);
  };

  const openDetails = () => {
    if (!selected) return;
    // A community card can appear from either map (it's an overlay on the
    // games map); route by the card's own kind rather than the screen mode.
    const looksLikeCommunity = !selected.timeLabel && !isGames;
    if (isGames && !looksLikeCommunity) {
      nav.navigate('MatchDetails', { gameId: selected.id });
    } else {
      nav.navigate('CommunityDetailsPublic', { groupId: selected.id });
    }
  };

  const title = isGames ? he.mapGamesTitle : he.mapCommunitiesTitle;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Shared ScreenHeader — same surface bar + back chevron as the rest
          of the app (this screen used to roll its own). */}
      <ScreenHeader title={title} />

      {/* Search row. Under RTL the first child sits on the visual RIGHT, so
          order is: locate (→ right) · search · filter (→ left) to match the
          mockup (sliders on the left, crosshair on the right). */}
      <View style={styles.searchRow}>
        <Pressable
          onPress={focusOnMe}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel={he.mapLocateMe}
        >
          <Ionicons
            name="locate"
            size={20}
            color={locating ? colors.textMuted : colors.primary}
          />
        </Pressable>
        <View style={styles.searchPill}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={
              isGames ? he.mapSearchGames : he.mapSearchCommunities
            }
            placeholderTextColor="#94A3B8"
            style={styles.searchInput}
          />
          <Ionicons name="search" size={18} color="#94A3B8" />
        </View>
        <Pressable
          onPress={() => setOpenOnly((v) => !v)}
          style={[styles.iconBtn, openOnly && styles.iconBtnActive]}
          accessibilityRole="button"
          accessibilityLabel={he.gameFiltersButton}
        >
          <Ionicons
            name="options-outline"
            size={20}
            color={openOnly ? '#FFFFFF' : colors.primary}
          />
        </Pressable>
      </View>

      {/* Filter chips — games: by date; communities: by status. */}
      <View style={styles.chipsRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsContent}
        >
          {(isGames
            ? ([
                ['all', he.mapChipAllGames],
                ['today', he.mapChipToday],
                ['weekend', he.mapChipWeekend],
              ] as [GameChip, string][])
            : ([['all', he.mapChipAllCommunities]] as [GameChip, string][])
          ).map(([value, label]) => {
            const active = chip === value;
            return (
              <Pressable
                key={value}
                onPress={() => setChip(value)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Map + floating overlays. */}
      <View style={styles.mapWrap}>
        {markers.length > 0 ? (
          <MapWebView
            markers={markers}
            center={center}
            focusOn={focusOn}
            onMarkerPress={onMarkerPress}
            // Clean, natural basemap (no heavy blue wash) so it matches the
            // app's other maps (the OpenFreeMap radius/picker maps).
            tintAlpha={0}
            // Ball pins on the games map, people pins on the communities map.
            pinEmoji={mode === 'communities' ? '👥' : '⚽'}
          />
        ) : (
          <View style={styles.empty}>
            <Ionicons name="map-outline" size={56} color={colors.textMuted} />
            <Text style={styles.emptyText}>{he.mapEmpty}</Text>
          </View>
        )}

        {/* Legend (games only) — colour by date. */}
        {isGames ? (
          <View style={styles.legend}>
            {(
              [
                ['today', he.mapLegendToday],
                ['tomorrow', he.mapLegendTomorrow],
                ['weekend', he.mapLegendWeekend],
                ['other', he.mapLegendOther],
              ] as [DateBucket, string][]
            ).map(([b, label]) => (
              <View key={b} style={styles.legendRow}>
                <View
                  style={[styles.legendDot, { borderColor: BUCKET_COLOR[b] }]}
                />
                <Text style={styles.legendText}>{label}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Overlay toggle — show the OTHER layer. */}
        {overlay && overlay.length > 0 ? (
          <View style={styles.toggle}>
            <BallSwitch
              value={showOverlay}
              onValueChange={setShowOverlay}
              trackColor={{ true: colors.primary, false: '#CBD5E1' }}
            />
            <Text style={styles.toggleText}>
              {isGames ? he.mapShowCommunities : he.mapShowGames}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Bottom detail card. */}
      {selected ? (
        <View style={styles.card}>
          <Pressable
            onPress={() => setSelected(null)}
            hitSlop={10}
            style={styles.cardClose}
            accessibilityRole="button"
            accessibilityLabel={he.close}
          >
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </Pressable>
          <View style={styles.cardRow}>
            <View style={styles.cardBall}>
              <Text style={{ fontSize: 22 }}>⚽</Text>
            </View>
            <View style={{ flex: 1 }}>
              {selected.timeLabel ? (
                <Text style={styles.cardTime}>{selected.timeLabel}</Text>
              ) : null}
              <Text style={styles.cardTitle} numberOfLines={1}>
                {selected.title}
              </Text>
              <Text style={styles.cardSubtitle} numberOfLines={1}>
                {selected.subtitle}
              </Text>
              {selected.badge ? (
                <View style={styles.cardBadge}>
                  <Text style={styles.cardBadgeText}>{selected.badge}</Text>
                </View>
              ) : null}
            </View>
            <Pressable
              onPress={openDetails}
              hitSlop={8}
              style={styles.cardChevron}
              accessibilityRole="button"
              accessibilityLabel={he.mapOpenDetails}
            >
              <Ionicons name="chevron-back" size={22} color={colors.primary} />
            </Pressable>
          </View>
          <Pressable
            onPress={openDetails}
            style={({ pressed }) => [styles.cardCta, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
          >
            <Text style={styles.cardCtaText}>{he.mapOpenDetails}</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  headerBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    ...typography.h2,
    color: colors.text,
    textAlign: 'center',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  iconBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  iconBtnActive: { backgroundColor: colors.primary },
  searchPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    height: 48,
    gap: spacing.sm,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    ...typography.body,
    color: colors.text,
    // TextInput (Android EditText) honours physical alignment — 'right'
    // keeps the Hebrew placeholder/value on the visual right edge.
    textAlign: 'right',
    paddingVertical: 0,
  },
  chipsRow: { paddingBottom: spacing.sm },
  chipsContent: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    flexDirection: 'row',
  },
  chip: {
    paddingHorizontal: spacing.lg,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.text,
  },
  chipTextActive: { color: '#FFFFFF' },
  mapWrap: { flex: 1, backgroundColor: '#eaf2fb' },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  legend: {
    position: 'absolute',
    bottom: spacing.lg,
    right: spacing.lg,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 14,
    padding: spacing.md,
    gap: 6,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 3,
    backgroundColor: '#fff',
  },
  legendText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  toggle: {
    position: 'absolute',
    bottom: spacing.lg,
    left: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
  toggleText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  card: {
    position: 'absolute',
    bottom: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: spacing.lg,
    gap: spacing.sm,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 8,
  },
  cardClose: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardBall: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#EFF6FF',
    borderWidth: 2,
    borderColor: '#BFDBFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTime: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  cardTitle: {
    ...typography.body,
    fontWeight: '800',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  cardSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  cardBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#DBEAFE',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 2,
    marginTop: 4,
  },
  cardBadgeText: { fontSize: 12, fontWeight: '700', color: '#1D4ED8' },
  cardChevron: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardCta: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: 4,
  },
  cardCtaText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});
