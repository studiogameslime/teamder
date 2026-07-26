// "מצא לי משחקים" — the user marks when/where they want to play so the
// matcher can offer them open games with shortages nearby.
//
// Redesigned to the product mockup: intro card, day chips, time-of-day
// buckets, a radius map (search area), a range slider, a notifications
// toggle and a save CTA. The location is set on the map (pin) and
// reverse-geocoded to a city name on save so the server-side matcher —
// which keys off the home city + radius — keeps working.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { BallSwitch } from '@/components/anim/BallSwitch';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { updateDoc } from 'firebase/firestore';

import { appAlert } from '@/components/AppDialog';
import { ScreenHeader } from '@/components/ScreenHeader';
import { RangeSlider } from '@/components/RangeSlider';
import { AvailabilityRadiusMap } from '@/components/availability/AvailabilityRadiusMap';
import { AvailabilityRadiusMapModal } from '@/components/availability/AvailabilityRadiusMapModal';
import {
  LocationSearchSheet,
  type LocationResult,
} from '@/components/games/LocationSearchSheet';
import { resolveNearbyLocation, promptLocationDenied } from '@/utils/nearby';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { userService } from '@/services';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { logError } from '@/services/errorLog';
import { availabilityFeedService } from '@/services/availabilityFeedService';
import { storage } from '@/services/storage';
import { docs } from '@/firebase/firestore';
import { USE_MOCK_DATA } from '@/firebase/config';
import { TimeBucket, UserAvailability, WeekdayIndex } from '@/types';
import { colors, radius, spacing, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';

const ALL_DAYS: WeekdayIndex[] = [0, 1, 2, 3, 4, 5, 6];
const RADIUS_MIN = 5;
const RADIUS_MAX = 50;
const ACCENT = '#2563EB';
/** Gush Dan — sensible default focus when the user has no saved location. */
const DEFAULT_CENTER = { lat: 32.0719, lng: 34.8417 };

const TIME_BUCKETS: {
  key: TimeBucket;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  range: string;
}[] = [
  { key: 'morning', label: he.availabilityTimeMorning, icon: 'sunny-outline', range: he.availabilityTimeRangeMorning },
  { key: 'noon', label: he.availabilityTimeNoon, icon: 'sunny', range: he.availabilityTimeRangeNoon },
  { key: 'evening', label: he.availabilityTimeEvening, icon: 'partly-sunny-outline', range: he.availabilityTimeRangeEvening },
];
const ALL_BUCKETS: TimeBucket[] = ['morning', 'noon', 'evening'];

/** grid = weekday → free buckets that day. */
type SlotGrid = Partial<Record<WeekdayIndex, TimeBucket[]>>;

/**
 * Build the initial grid, MIGRATING existing users so nobody's saved
 * availability is lost when the grid UI replaces the old decoupled pickers:
 *  • a saved `availabilitySlots` grid wins (normalise string keys from Firestore);
 *  • else expand the legacy `preferredDays × preferredTimes` cross-product —
 *    empty days ⇒ "any day", empty times ⇒ "any window" (matches the old
 *    "empty array = any" matcher semantics);
 *  • both empty ⇒ empty grid (still "any", handled by the matcher fallback).
 */
function buildInitialGrid(av: UserAvailability): SlotGrid {
  const saved = av.availabilitySlots;
  if (saved && Object.keys(saved).length > 0) {
    const out: SlotGrid = {};
    for (const [k, v] of Object.entries(saved)) {
      if (Array.isArray(v) && v.length > 0) {
        out[Number(k) as WeekdayIndex] = v.filter((b): b is TimeBucket =>
          ALL_BUCKETS.includes(b as TimeBucket),
        );
      }
    }
    return out;
  }
  const dLegacy = av.preferredDays ?? [];
  const tLegacy = (av.preferredTimes ?? []).filter((b) =>
    ALL_BUCKETS.includes(b),
  );
  if (dLegacy.length === 0 && tLegacy.length === 0) return {};
  const days = dLegacy.length > 0 ? dLegacy : ALL_DAYS;
  const buckets = tLegacy.length > 0 ? tLegacy : ALL_BUCKETS;
  const out: SlotGrid = {};
  for (const d of days) out[d] = [...buckets];
  return out;
}

export function AvailabilityEditScreen() {
  const nav = useNavigation();
  const user = useUserStore((s) => s.currentUser);

  const reloadUser = async () => {
    const fresh = await userService.getCurrentUser();
    if (fresh) useUserStore.setState({ currentUser: fresh });
  };

  const initial: UserAvailability = user?.availability ?? {
    preferredDays: [],
    isAvailableForInvites: true,
  };

  const initialPin = useMemo(
    () =>
      typeof initial.homeCityLat === 'number' &&
      typeof initial.homeCityLng === 'number'
        ? { lat: initial.homeCityLat, lng: initial.homeCityLng }
        : DEFAULT_CENTER,
    [initial.homeCityLat, initial.homeCityLng],
  );
  const initialRadius = clampRadius(initial.availabilityRadiusKm ?? 15);

  // The whole feature is location-based: it's "on" only once the user has
  // a saved location (i.e. previously granted + picked). Seeded from coords.
  const initialLocationEnabled =
    typeof initial.homeCityLat === 'number' &&
    typeof initial.homeCityLng === 'number';

  // Per-day availability grid (migrated from any legacy days×times on first open).
  const initialGrid = useMemo(() => buildInitialGrid(initial), [user?.availability]);
  const [slots, setSlots] = useState<SlotGrid>(initialGrid);
  const [pin, setPin] = useState(initialPin);
  const [radiusKm, setRadiusKm] = useState<number>(initialRadius);
  // Default ON (user request): nearby-game invites are the point of setting
  // availability. Only an EXPLICIT `false` keeps it off, so existing opt-outs
  // are respected while everyone else (undefined) defaults in.
  const [notify, setNotify] = useState<boolean>(initial.acceptsFillerPush !== false);
  const [locationEnabled, setLocationEnabled] = useState(initialLocationEnabled);
  // Whether the OS already granted foreground location. When it has, the
  // "אשרו שיתוף מיקום" framing is misleading (nothing to grant) — the copy
  // drops to a plain "flip the toggle above" instruction. Read non-prompting.
  const [locationGranted, setLocationGranted] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  // City/area search sheet + a display label for the resolved home area.
  const [searchOpen, setSearchOpen] = useState(false);
  const [cityLabel, setCityLabel] = useState<string>(initial.homeCity ?? '');

  const isDirty =
    JSON.stringify(slots) !== JSON.stringify(initialGrid) ||
    pin.lat !== initialPin.lat ||
    pin.lng !== initialPin.lng ||
    radiusKm !== initialRadius ||
    notify !== (initial.acceptsFillerPush !== false) ||
    locationEnabled !== initialLocationEnabled;
  const savingRef = useUnsavedChangesGuard({ isDirty, onSave: () => save() });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let Location: typeof import('expo-location') | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        Location = require('expo-location');
      } catch {
        Location = null;
      }
      if (!Location) return;
      try {
        const cur = await Location.getForegroundPermissionsAsync();
        if (!cancelled) setLocationGranted(cur.granted);
      } catch {
        // ignore — leave as not-granted, keep the permission-framed copy.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Master toggle. Just enables/disables the feature — it does NOT capture
  // live GPS. The home area is a FIXED point the user sets explicitly on the
  // map, by city search, or via the explicit "use my current location" button.
  // (Previously this grabbed getCurrentPositionAsync and froze whatever the
  // GPS happened to be — which anchored availability to a vacation spot when
  // enabled abroad.)
  const handleToggleLocation = (next: boolean) => {
    setLocationEnabled(next);
  };

  // Explicit, opt-in GPS: only fires on a deliberate tap, never automatically.
  // A convenience for someone setting this up while physically at home.
  const handleUseCurrentLocation = async () => {
    setGpsBusy(true);
    try {
      const r = await resolveNearbyLocation(initial.homeCity);
      if (r.granted) {
        if (r.latLng) setPin(r.latLng);
        if (r.city) setCityLabel(r.city);
      } else {
        promptLocationDenied(r.canAskAgain);
      }
    } finally {
      setGpsBusy(false);
    }
  };

  // City/area search result → move the fixed home pin there.
  const handleCityPicked = (res: LocationResult) => {
    setPin({ lat: res.lat, lng: res.lng });
    if (res.label) setCityLabel(res.label);
    setSearchOpen(false);
  };

  const toggleSlot = useCallback((d: WeekdayIndex, b: TimeBucket) => {
    setSlots((prev) => {
      const cur = prev[d] ?? [];
      const nextArr = cur.includes(b) ? cur.filter((x) => x !== b) : [...cur, b];
      const next: SlotGrid = { ...prev };
      if (nextArr.length > 0) next[d] = nextArr;
      else delete next[d];
      return next;
    });
  }, []);

  const applyPreset = useCallback((kind: 'evenings' | 'weekend' | 'clear') => {
    setSlots((prev) => {
      if (kind === 'clear') return {};
      const next: SlotGrid = { ...prev };
      if (kind === 'evenings') {
        for (const d of ALL_DAYS) {
          next[d] = Array.from(new Set([...(next[d] ?? []), 'evening']));
        }
      } else if (kind === 'weekend') {
        for (const d of [5, 6] as WeekdayIndex[]) next[d] = [...ALL_BUCKETS];
      }
      return next;
    });
  }, []);

  if (!user) return null;

  const save = async () => {
    // The grid is the source of truth; derive the legacy arrays from it so
    // older clients + the server matcher's fallback path keep working exactly
    // as before (never wiping anyone's saved availability).
    const derivedDays = (Object.keys(slots) as string[])
      .map((k) => Number(k) as WeekdayIndex)
      .filter((d) => (slots[d]?.length ?? 0) > 0)
      .sort((a, b) => a - b);
    const derivedTimes = Array.from(
      new Set(Object.values(slots).flat().filter(Boolean)),
    ) as TimeBucket[];
    setBusy(true);
    try {
      // When location is off the feature is disabled: clear coords/city and
      // force notifications off so the server-side matcher won't include the
      // user. When on, resolve the dropped pin to a city name (best-effort)
      // since the matcher requires a city.
      let cityName = '';
      let coords: { lat: number; lng: number } | null = null;
      if (locationEnabled) {
        coords = { lat: pin.lat, lng: pin.lng };
        cityName = initial.homeCity ?? '';
        try {
          const { reverseGeocodeCity } = await import('@/services/geocodeService');
          const c = await reverseGeocodeCity(pin.lat, pin.lng);
          if (c) cityName = c;
        } catch {
          /* keep previous city name on failure */
        }
      }
      const next: UserAvailability = {
        preferredDays: derivedDays,
        preferredTimes: derivedTimes,
        availabilitySlots: slots,
        homeCity: cityName || undefined,
        preferredCity: cityName || undefined,
        cities: cityName ? [cityName] : [],
        availabilityRadiusKm: radiusKm,
        // Not surfaced in the new UI — preserve whatever was set before
        // (defaults to invitable).
        isAvailableForInvites: initial.isAvailableForInvites !== false,
        acceptsFillerPush: locationEnabled ? notify : false,
      };
      await persistAvailability(user.id, next, coords);
      // The viewer's radius/location just changed → drop the home-calendar
      // cache so the "פנויים לשחק לידך" counts refresh on the next open.
      availabilityFeedService.invalidate();
      logEvent(AnalyticsEvent.AvailabilitySet, {
        days: derivedDays.join(','),
        times: derivedTimes.join(','),
        radiusKm,
        locationEnabled: String(locationEnabled),
        acceptsFillerPush: String(locationEnabled && notify),
        geocoded: cityName.length > 0,
      });
      await reloadUser();
      savingRef.current = true;
      nav.goBack();
    } catch (e) {
      logError('saveAvailability', e, {
        screen: 'AvailabilityEditScreen',
        userId: user.id,
        days: derivedDays.join(','),
        radiusKm,
      });
      if (__DEV__) console.warn('[availability] save failed', e);
      appAlert(he.error, String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title={he.availabilityHeaderTitle} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Intro card */}
        <View style={styles.introCard}>
          <View style={styles.introAccent} />
          <View style={styles.introText}>
            <Text style={styles.introTitle}>{he.availabilityCardTitle}</Text>
            <Text style={styles.introBody}>{he.availabilityCardBody}</Text>
          </View>
          <View style={styles.introIcon}>
            <Ionicons name="search" size={26} color={ACCENT} />
            <Text style={styles.introIconBall}>⚽</Text>
          </View>
        </View>

        {/* Master location gate — the feature requires location permission */}
        <View style={styles.gateCard}>
          <View style={styles.notifText}>
            <View style={styles.sectionHeaderInner}>
              <Ionicons name="navigate-circle-outline" size={18} color={ACCENT} />
              <Text style={styles.notifTitle}>{he.availabilityLocationToggle}</Text>
            </View>
            <Text style={styles.notifHint}>
              {locationGranted
                ? he.availabilityLocationToggleHintGranted
                : he.availabilityLocationToggleHint}
            </Text>
          </View>
          <BallSwitch
            value={locationEnabled}
            onValueChange={handleToggleLocation}
            trackColor={{ false: colors.border, true: ACCENT }}
            thumbColor="#fff"
          />
        </View>

        {!locationEnabled ? (
          <View style={styles.lockedCard}>
            <Ionicons
              name={locationGranted ? 'navigate-circle-outline' : 'lock-closed-outline'}
              size={26}
              color={colors.textMuted}
            />
            <Text style={styles.lockedTitle}>
              {locationGranted
                ? he.availabilityLocationLockedTitleGranted
                : he.availabilityLocationLockedTitle}
            </Text>
            <Text style={styles.lockedHint}>
              {locationGranted
                ? he.availabilityLocationLockedHintGranted
                : he.availabilityLocationLockedHint}
            </Text>
          </View>
        ) : (
          <>
        {/* Availability grid — day × time-of-day, each cell independent so a
            user can be free e.g. Friday morning but NOT Friday evening. */}
        <SectionHeader icon="calendar-outline" title={he.availabilityGridTitle} />
        <View style={styles.gridCard}>
          <View style={styles.gridHeaderRow}>
            <View style={styles.gridDayCol} />
            {TIME_BUCKETS.map((t) => (
              <View key={t.key} style={styles.gridHeadCell}>
                <Ionicons name={t.icon} size={18} color={colors.textMuted} />
                <Text style={styles.gridHeadLabel}>{t.label}</Text>
                <Text style={styles.gridHeadRange}>{t.range}</Text>
              </View>
            ))}
          </View>
          <View style={styles.gridDivider} />
          {ALL_DAYS.map((d) => {
            const isWeekend = d === 5 || d === 6;
            return (
              <View key={d} style={styles.gridRow}>
                <Text
                  style={[styles.gridDayLabel, isWeekend && styles.gridDayWeekend]}
                >
                  {he.availabilityDayName[d]}
                </Text>
                {TIME_BUCKETS.map((t) => {
                  const on = (slots[d] ?? []).includes(t.key);
                  return (
                    <Pressable
                      key={t.key}
                      onPress={() => toggleSlot(d, t.key)}
                      style={({ pressed }) => [
                        styles.gridCell,
                        on && styles.gridCellOn,
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <Ionicons
                        name={on ? 'checkmark' : 'add'}
                        size={on ? 20 : 19}
                        color={on ? '#fff' : colors.textMuted}
                      />
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
          <View style={styles.gridLegend}>
            <View style={styles.legendItem}>
              <View
                style={[styles.legendSwatch, { backgroundColor: colors.success }]}
              />
              <Text style={styles.legendText}>{he.availabilityLegendFree}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, styles.legendSwatchOff]} />
              <Text style={styles.legendText}>{he.availabilityLegendBusy}</Text>
            </View>
          </View>
        </View>

        {/* Quick-fill presets — 21 cells by hand is a chore; one tap fills a
            common pattern, then the user tweaks the exceptions. */}
        <SectionHeader icon="flash-outline" title={he.availabilityQuickFill} />
        <View style={styles.presetRow}>
          <Pressable style={styles.preset} onPress={() => applyPreset('evenings')}>
            <Text style={styles.presetText}>{he.availabilityPresetEvenings}</Text>
          </Pressable>
          <Pressable style={styles.preset} onPress={() => applyPreset('weekend')}>
            <Text style={styles.presetText}>{he.availabilityPresetWeekend}</Text>
          </Pressable>
          <Pressable
            style={[styles.preset, styles.presetGhost]}
            onPress={() => applyPreset('clear')}
          >
            <Text style={[styles.presetText, styles.presetGhostText]}>
              {he.availabilityPresetClear}
            </Text>
          </Pressable>
        </View>

        {/* Fixed home area (map) — set explicitly, never from live GPS. */}
        <SectionHeader icon="home-outline" title={he.availabilityAreaTitle} />
        <Text style={styles.areaHint}>{he.availabilityAreaHint}</Text>
        <View style={styles.areaBtnRow}>
          <Pressable
            onPress={() => setSearchOpen(true)}
            style={({ pressed }) => [styles.areaBtn, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="search" size={16} color={ACCENT} />
            <Text style={styles.areaBtnText}>{he.availabilitySearchCity}</Text>
          </Pressable>
          <Pressable
            onPress={handleUseCurrentLocation}
            disabled={gpsBusy}
            style={({ pressed }) => [styles.areaBtn, pressed && { opacity: 0.85 }]}
          >
            {gpsBusy ? (
              <SoccerBallLoader size={16} />
            ) : (
              <Ionicons name="locate" size={16} color={ACCENT} />
            )}
            <Text style={styles.areaBtnText}>{he.availabilityUseCurrent}</Text>
          </Pressable>
        </View>
        <AvailabilityRadiusMap
          center={pin}
          radiusKm={radiusKm}
          onPick={(lat, lng) => setPin({ lat, lng })}
          onExpand={() => setMapExpanded(true)}
        />
        {cityLabel ? (
          <Text style={styles.areaCityLabel}>
            {he.availabilityHomeAreaLabel(cityLabel)}
          </Text>
        ) : null}

        {/* Range slider */}
        <View style={styles.rangeHeader}>
          <View style={styles.sectionHeaderInner}>
            <Ionicons name="resize-outline" size={18} color={ACCENT} />
            <Text style={styles.sectionTitle}>{he.availabilityRangeTitle}</Text>
          </View>
          <Text style={styles.rangeValue}>
            {he.availabilityRangeValue(radiusKm)}
          </Text>
        </View>
        <View style={styles.rangeCard}>
          <RangeSlider
            min={RADIUS_MIN}
            max={RADIUS_MAX}
            step={1}
            value={radiusKm}
            onChange={setRadiusKm}
            accent={ACCENT}
          />
          <View style={styles.rangeEnds}>
            <Text style={styles.rangeEndText}>{RADIUS_MIN} ק"מ</Text>
            <Text style={styles.rangeEndText}>{RADIUS_MAX} ק"מ</Text>
          </View>
        </View>

        {/* Notifications */}
        <View style={styles.notifCard}>
          <View style={styles.notifText}>
            <View style={styles.sectionHeaderInner}>
              <Ionicons name="notifications-outline" size={18} color={colors.success} />
              <Text style={styles.notifTitle}>{he.availabilityNotifTitle}</Text>
            </View>
            <Text style={styles.notifHint}>{he.availabilityNotifHint}</Text>
          </View>
          <BallSwitch
            value={notify}
            onValueChange={setNotify}
            trackColor={{ false: colors.border, true: colors.success }}
            thumbColor="#fff"
          />
        </View>
          </>
        )}
      </ScrollView>

      {/* Save CTA */}
      <View style={styles.footer}>
        <Pressable onPress={save} disabled={busy} style={{ opacity: busy ? 0.7 : 1 }}>
          <LinearGradient
            colors={['#2F6BED', '#1E40AF']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.saveBtn}
          >
            {/* Text first so the ball icon lands on the visual LEFT (forceRTL
                flips `row`: last child → visual left). */}
            <Text style={styles.saveText}>{he.availabilitySavePrefs}</Text>
            <Ionicons name="football-outline" size={22} color="#fff" />
          </LinearGradient>
        </Pressable>
      </View>

      <AvailabilityRadiusMapModal
        visible={mapExpanded}
        center={pin}
        radiusKm={radiusKm}
        minKm={RADIUS_MIN}
        maxKm={RADIUS_MAX}
        cityName={initial.homeCity}
        onClose={() => setMapExpanded(false)}
        onPick={(lat, lng) => setPin({ lat, lng })}
        onRadiusChange={setRadiusKm}
      />

      {/* City / area search — sets the FIXED home pin (reuses the game
          wizard's picker: text search or pin-drop, always yields coords). */}
      <LocationSearchSheet
        visible={searchOpen}
        initialCoords={pin}
        onClose={() => setSearchOpen(false)}
        onSelect={handleCityPicked}
      />
    </SafeAreaView>
  );
}

function SectionHeader({
  icon,
  title,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderInner}>
        <Ionicons name={icon} size={18} color={ACCENT} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
    </View>
  );
}

function CheckBadge() {
  return (
    <View style={styles.checkBadge}>
      <Ionicons name="checkmark" size={11} color={ACCENT} />
    </View>
  );
}

function clampRadius(km: number): number {
  return Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, Math.round(km)));
}

// ── Persistence ───────────────────────────────────────────────────────────
async function persistAvailability(
  uid: string,
  availability: UserAvailability,
  coords: { lat: number; lng: number } | null,
): Promise<void> {
  if (USE_MOCK_DATA) {
    const json = await storage.getAuthUserJson();
    if (!json) return;
    try {
      const cur = JSON.parse(json);
      const merged: UserAvailability = {
        ...availability,
        homeCityLat: coords?.lat,
        homeCityLng: coords?.lng,
      };
      const next = { ...cur, availability: merged, updatedAt: Date.now() };
      await storage.setAuthUserJson(JSON.stringify(next));
    } catch {
      /* corrupt cache — leave alone */
    }
    return;
  }
  await updateDoc(docs.user(uid), {
    availability: {
      preferredDays: availability.preferredDays,
      preferredTimes: availability.preferredTimes ?? [],
      preferredCity: availability.preferredCity ?? null,
      cities: Array.isArray(availability.cities) ? availability.cities : [],
      homeCity: availability.homeCity ?? null,
      homeCityLat: coords?.lat ?? null,
      homeCityLng: coords?.lng ?? null,
      availabilityRadiusKm:
        typeof availability.availabilityRadiusKm === 'number'
          ? availability.availabilityRadiusKm
          : 15,
      isAvailableForInvites: availability.isAvailableForInvites !== false,
      acceptsFillerPush: availability.acceptsFillerPush === true,
    },
    updatedAt: Date.now(),
  });
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },

  // Intro card
  introCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF4FF',
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
    overflow: 'hidden',
  },
  introAccent: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 6,
    backgroundColor: ACCENT,
  },
  introText: { flex: 1, gap: 4 },
  introTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: ACCENT,
    textAlign: RTL_LABEL_ALIGN,
  },
  introBody: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  introIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#DCE7FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  introIconBall: { fontSize: 16, marginTop: -2 },

  // Section headers
  sectionHeader: { marginTop: spacing.sm },
  sectionHeaderInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },

  // Fixed home-area controls (search / current-location buttons + labels)
  areaHint: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    marginTop: 2,
    marginBottom: spacing.sm,
  },
  areaBtnRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  areaBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  areaBtnText: { fontSize: 13, fontWeight: '700', color: ACCENT },
  areaCityLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
    marginTop: spacing.sm,
  },

  // Day chips — 7 equal cells in one row
  daysRow: { flexDirection: 'row', gap: spacing.xs },
  dayChip: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  dayLetter: { fontSize: 16, fontWeight: '700', color: colors.text },

  // Time chips
  timesRow: { flexDirection: 'row', gap: spacing.sm },
  timeChip: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  timeLabel: { fontSize: 14, fontWeight: '700', color: colors.text },

  chipActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  textOnActive: { color: '#fff' },

  // Availability grid (day × time-of-day)
  gridCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.sm,
  },
  gridHeaderRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs },
  gridDayCol: { width: 58 },
  gridHeadCell: { flex: 1, alignItems: 'center', paddingBottom: 2 },
  gridHeadLabel: { fontSize: 12, fontWeight: '800', color: colors.text, marginTop: 1 },
  gridHeadRange: { fontSize: 10, fontWeight: '600', color: colors.textMuted },
  gridDivider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
  gridRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  gridDayLabel: {
    width: 58,
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'right',
  },
  gridDayWeekend: { color: '#7C3AED' },
  gridCell: {
    flex: 1,
    height: 42,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridCellOn: { backgroundColor: colors.success, borderColor: colors.success },
  gridLegend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendSwatch: { width: 14, height: 14, borderRadius: 4 },
  legendSwatchOff: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  legendText: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  preset: {
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1.5,
    borderColor: ACCENT,
  },
  presetText: { fontSize: 13, fontWeight: '800', color: ACCENT },
  presetGhost: { borderColor: colors.border },
  presetGhostText: { color: colors.textMuted },
  checkBadge: {
    position: 'absolute',
    bottom: -8,
    alignSelf: 'center',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: ACCENT,
  },

  // Range
  rangeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  rangeValue: { fontSize: 15, fontWeight: '800', color: ACCENT },
  rangeCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  rangeEnds: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    direction: 'ltr',
  },
  rangeEndText: { fontSize: 12, color: colors.textMuted },

  // Location gate
  gateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: '#EFF4FF',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#CFE0FF',
    padding: spacing.lg,
  },
  lockedCard: {
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  lockedTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  lockedHint: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
    textAlign: 'center',
  },

  // Notifications
  notifCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginTop: spacing.sm,
  },
  notifText: { flex: 1, gap: 4 },
  notifTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  notifHint: { fontSize: 12, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },

  // Footer / save
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 56,
    borderRadius: radius.pill,
  },
  saveText: { fontSize: 17, fontWeight: '800', color: '#fff' },
});
