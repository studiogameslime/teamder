import { ChangeMotion } from '@/components/anim/ChangeMotion';
// "מצא לי משחקים" — the user marks when/where they want to play so the
// matcher can offer them open games with shortages nearby.
//
// Redesigned to the product mockup: intro card, day chips, time-of-day
// buckets, a radius map (search area), a range slider, a notifications
// toggle and a save CTA. The location is set on the map (pin) and
// reverse-geocoded to a city name on save so the server-side matcher —
// which keys off the home city + radius — keeps working.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { withAuthRaceRetry } from '@/firebase/authRace';

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
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { persistAvailability } from '@/services/availabilitySave';
import {
  useAuthenticatedAction,
  useIsGuest,
} from '@/hooks/useAuthenticatedAction';
import { draftStore } from '@/services/draftStore';
import {
  restoreAvailabilityDraft,
  isDefaultCenter,
  DEFAULT_CENTER,
  type RestoredAvailabilityDraft,
} from '@/utils/availabilityDraft';
import { logError } from '@/services/errorLog';
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
/**
 * Gush Dan — where the map OPENS when the user has no saved location.
 *
 * It is a viewport default and nothing more. It must never be persisted or
 * reverse-geocoded as if the user had chosen it: this exact point resolves to
 * {"suburb":"הר שלום","town":"בני ברק"}, so every user who flipped the location
 * toggle on and saved without moving the pin, searching a city or tapping GPS
 * was stamped homeCity/preferredCity/cities = 'בני ברק'. A location is only
 * written once `locationPicked` is true (see below).
 */
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
  const isGuest = useIsGuest();
  const authAction = useAuthenticatedAction();
  const draftIdRef = useRef(`availability-${Date.now()}`);
  /** A parked availability draft, if the person filled this in as a guest and
   *  came back. Applied once, on mount, so the grid they drew is still there. */
  const [restoredDraft, setRestoredDraft] =
    useState<RestoredAvailabilityDraft | null>(null);

  useEffect(() => {
    let alive = true;
    void draftStore
      .read('availability')
      .then((d) => {
        if (!alive || !d) return;
        draftIdRef.current = d.id;
        // The WHOLE parked shape, through the one derivation that knows what
        // to do with it. Reading only `values.availability` here is what lost
        // the home area: the coords sit beside it, and the toggle is derived
        // from them. See `availabilityDraft` for why nothing is inferred when
        // they are missing or malformed.
        const restored = restoreAvailabilityDraft(
          d.values as unknown as Parameters<typeof restoreAvailabilityDraft>[0],
        );
        if (restored) {
          setRestoredDraft(restored);
          logEvent(AnalyticsEvent.DraftRestored, {
            kind: 'availability',
            age_ms: Math.max(0, Date.now() - d.updatedAt),
            has_home_area: restored.locationEnabled,
          });
        }
      })
      .catch(() => {
        /* no draft to restore */
      });
    return () => {
      alive = false;
    };
  }, []);


  // A parked draft wins over the account's saved availability: it is what this
  // person just drew, and the only reason it is not saved yet is that they had
  // no account when they drew it.
  const initial: UserAvailability =
    restoredDraft?.availability ??
    user?.availability ?? {
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
  const initialGrid = useMemo(
    () => buildInitialGrid(initial),
    // `restoredDraft` included: it arrives one tick after mount, and without it
    // the grid would stay empty while `initial` said otherwise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user?.availability, restoredDraft],
  );
  const [slots, setSlots] = useState<SlotGrid>(initialGrid);
  const [pin, setPin] = useState(initialPin);
  const [radiusKm, setRadiusKm] = useState<number>(initialRadius);
  // Default ON (user request): nearby-game invites are the point of setting
  // availability. Only an EXPLICIT `false` keeps it off, so existing opt-outs
  // are respected while everyone else (undefined) defaults in.
  const [notify, setNotify] = useState<boolean>(initial.acceptsFillerPush !== false);
  const [locationEnabled, setLocationEnabled] = useState(initialLocationEnabled);
  // Has the user ever actually chosen the home area (map pick, city search or
  // the explicit GPS button)? While this is false the pin on screen is only
  // the map's opening view, and NOTHING location-shaped may be persisted.
  const [locationPicked, setLocationPicked] = useState(
    initialLocationEnabled && !isDefaultCenter(initial.homeCityLat, initial.homeCityLng),
  );
  // Whether the OS already granted foreground location. When it has, the
  // "אשרו שיתוף מיקום" framing is misleading (nothing to grant) — the copy
  // drops to a plain "flip the toggle above" instruction. Read non-prompting.
  const [locationGranted, setLocationGranted] = useState(false);

  // ── Re-seed EVERYTHING the draft decides, once it lands ─────────────────
  //
  // `useState` seeds on the first render and the draft is read
  // asynchronously, so every one of these was seeded from the ACCOUNT's
  // availability a tick before the draft arrived — and then never corrected.
  // Only the grid had an effect like this; the rest silently kept the
  // account's values, which for a guest means the defaults.
  //
  // So what a person filled in before signing in was not partially lost, it
  // was lost per field: the radius they dragged, the home area they pinned,
  // and the toggle that depends on it. The grid survived only because
  // somebody had already noticed this once and fixed that one case.
  //
  // Seeded from `initial`, which IS the draft when there is one — so this is
  // the same derivation as the `useState` calls above, replayed at the moment
  // the values actually exist.
  useEffect(() => {
    if (!restoredDraft) return;
    setSlots(initialGrid);
    setRadiusKm(initialRadius);
    setNotify(restoredDraft.availability.acceptsFillerPush !== false);
    setPin(initialPin);
    // Both flags come from the derivation, not from re-deriving here — one
    // place decides what a parked draft means.
    setLocationEnabled(restoredDraft.locationEnabled);
    setLocationPicked(restoredDraft.locationPicked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoredDraft]);
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
    logEvent(AnalyticsEvent.AvailabilityLocationToggled, {
      enabled: next,
      locationGranted,
    });
  };

  // Explicit, opt-in GPS: only fires on a deliberate tap, never automatically.
  // A convenience for someone setting this up while physically at home.
  const handleUseCurrentLocation = async () => {
    setGpsBusy(true);
    try {
      const r = await resolveNearbyLocation(initial.homeCity);
      logEvent(AnalyticsEvent.AvailabilityGpsUsed, {
        granted: r.granted,
        city: r.city ?? '',
        canAskAgain: r.canAskAgain,
      });
      if (r.granted) {
        if (r.latLng) {
          setPin(r.latLng);
          setLocationPicked(true);
        }
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
    setLocationPicked(true);
    if (res.label) setCityLabel(res.label);
    setSearchOpen(false);
  };

  // Map tap / pin drag (small map and the full-screen one) — the other two
  // ways of deliberately choosing the home area.
  const handlePinPicked = useCallback((lat: number, lng: number) => {
    setPin({ lat, lng });
    setLocationPicked(true);
    // The previous label belongs to the previous spot, and the new one is only
    // named on save (a reverse-geocode per drag frame would hammer Nominatim).
    // Showing nothing beats showing the city the user just moved away from.
    setCityLabel('');
  }, []);

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

  const applyPreset = useCallback((kind: 'evenings' | 'weekend' | 'all' | 'clear') => {
    logEvent(AnalyticsEvent.AvailabilityPresetApplied, { preset: kind });
    setSlots((prev) => {
      if (kind === 'clear') return {};
      const next: SlotGrid = { ...prev };
      if (kind === 'evenings') {
        for (const d of ALL_DAYS) {
          next[d] = Array.from(new Set([...(next[d] ?? []), 'evening']));
        }
      } else if (kind === 'weekend') {
        for (const d of [5, 6] as WeekdayIndex[]) next[d] = [...ALL_BUCKETS];
      } else if (kind === 'all') {
        // Whole board. "כל הערבים" only ever fills one bucket per day, and
        // there was no way to say "any time, any day" short of 21 taps.
        for (const d of ALL_DAYS) next[d] = [...ALL_BUCKETS];
      }
      return next;
    });
  }, []);

  if (!user) return null;

  const save = async () => {
    // A location that the user never chose is not a location. Saving here used
    // to reverse-geocode whatever the map happened to be showing, which for
    // anyone who hadn't touched it was the default view — and wrote 'בני ברק'
    // as their home city. Ask for a real area instead of inventing one.
    if (locationEnabled && !locationPicked) {
      appAlert(he.availabilityAreaNotSetTitle, he.availabilityAreaMissingBody);
      return;
    }
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
      // `locationPicked` is re-checked (not just guarded above) so no future
      // caller of this block can write a city derived from the default view.
      if (locationEnabled && locationPicked) {
        coords = { lat: pin.lat, lng: pin.lng };
        // The pre-geocode fallback holds ONLY while the pin has not moved.
        // `initial.homeCity` names the OLD spot, so inheriting it for a pin the
        // user has just dragged somewhere else writes the same wrong city this
        // whole change exists to stop — and it needs no exotic failure to
        // happen, only a reverse-geocode that doesn't answer (Nominatim rate
        // limits, no signal), after which homeCity/preferredCity/cities would
        // have been re-stamped 'בני ברק' beside coordinates in חיפה.
        // No city at all is recoverable; a confidently wrong one is not.
        const pinMoved = pin.lat !== initialPin.lat || pin.lng !== initialPin.lng;
        cityName = pinMoved ? '' : (initial.homeCity ?? '');
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
      // ── The save gate for a guest ────────────────────────────────────────
      //
      // Availability lives ON the user document, and a guest has none — the
      // tightened rules refuse `/users/{anonymousUid}` outright, and writing one
      // would be wrong even if they did not. So a guest's availability is a
      // LOCAL DRAFT and nothing reaches Firestore until they are somebody.
      //
      // The coords ride in the draft because the reverse-geocode above happened
      // while they were still on the screen; re-deriving them after a sign-in
      // would mean asking for location again.
      if (isGuest) {
        await authAction.request({
          kind: 'save_availability',
          origin: 'in_app',
          draft: {
            kind: 'availability',
            id: draftIdRef.current,
            values: { availability: next, coords } as unknown as Record<string, unknown>,
          },
          execute: async () => {
            throw new Error('unreachable: guest actions resume via their resumer');
          },
        });
        savingRef.current = true;
        return;
      }
      // `persistAvailability` now owns what has to be true after a successful
      // save: the store patched with the values it wrote, and the home-calendar
      // cache dropped. Both used to live here, which is exactly why the guest
      // path — where this screen is gone by the time the resumer writes — got
      // neither. The re-read that used to follow is gone with them: the write
      // knows what it wrote, so paying for a document read to find out was
      // both a cost and a read-after-write window.
      // `AvailabilitySet` is fired by `persistAvailability` now, from the
      // values it wrote — so a resumed save is measured exactly like this one
      // instead of not at all, and neither path can double-count.
      await persistAvailability(user.id, next, coords);
      savingRef.current = true;
      nav.goBack();
    } catch (e) {
      logError('saveAvailability', e, {
        screen: 'AvailabilityEditScreen',
        userId: user.id,
        days: derivedDays.join(','),
        radiusKm,
      });
      logEvent(AnalyticsEvent.SettingsSaveFailed, {
        entity: 'availability',
        reason: String((e as Error)?.message ?? e),
        days: derivedDays.join(','),
        radiusKm,
      });
      if (__DEV__) console.warn('[availability] save failed', e);
      // A sentence, not `e.message`. The message this actually produced in
      // production is Firebase's "Missing or insufficient permissions." — set
      // in English, in front of a Hebrew-only audience, describing a
      // permission the user has and a failure they cannot act on. The grid
      // they filled in is still on screen, so the one useful instruction is
      // "try again", and that is what it now says.
      appAlert(he.error, he.availabilitySaveFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {authAction.sheet}
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
              <Text style={styles.notifTitle}>{he.availabilityLocationToggle}</Text>
              <Ionicons name="navigate-circle-outline" size={18} color={ACCENT} />
            </View>
            <Text style={styles.notifHint}>
              {locationGranted
                ? he.availabilityLocationToggleHintGranted
                : he.availabilityLocationToggleHint}
            </Text>
          </View>
          <BallSwitch
            accessibilityLabel={he.availabilityLocationToggle}
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
                      onPress={() => {
                        toggleSlot(d, t.key);
                        logEvent(AnalyticsEvent.AvailabilitySlotToggled, {
                          day: d,
                          bucket: t.key,
                          on: !on,
                        });
                      }}
                      style={({ pressed }) => [
                        styles.gridCell,
                        on && styles.gridCellOn,
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <ChangeMotion triggerKey={on} pulse duration={180}>
                      <Ionicons
                        name={on ? 'checkmark' : 'add'}
                        size={on ? 20 : 19}
                        color={on ? '#fff' : colors.textMuted}
                      />
                      </ChangeMotion>
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

          {/* Quick-fill presets live INSIDE the grid card so they clearly read
              as part of marking availability, not a separate section (Pulse #15). */}
          <View style={styles.gridDivider} />
          <View style={styles.quickFillHead}>
            <Text style={styles.quickFillLabel}>{he.availabilityQuickFill}</Text>
            <Ionicons name="flash-outline" size={15} color={colors.textMuted} />
          </View>
          <View style={styles.presetRow}>
            <Pressable style={styles.preset} onPress={() => applyPreset('evenings')}>
              <Text style={styles.presetText}>{he.availabilityPresetEvenings}</Text>
            </Pressable>
            <Pressable style={styles.preset} onPress={() => applyPreset('weekend')}>
              <Text style={styles.presetText}>{he.availabilityPresetWeekend}</Text>
            </Pressable>
            <Pressable style={styles.preset} onPress={() => applyPreset('all')}>
              <Text style={styles.presetText}>{he.availabilityPresetAll}</Text>
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
        </View>

        {/* Fixed home area (map) — set explicitly, never from live GPS. */}
        <SectionHeader icon="home-outline" title={he.availabilityAreaTitle} />
        <Text style={styles.areaHint}>{he.availabilityAreaHint}</Text>
        <View style={styles.areaBtnRow}>
          <Pressable
            onPress={() => setSearchOpen(true)}
            style={({ pressed }) => [styles.areaBtn, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.areaBtnText} numberOfLines={1}>
              {he.availabilitySearchCity}
            </Text>
            <Ionicons name="search" size={16} color={ACCENT} />
          </Pressable>
          <Pressable
            onPress={handleUseCurrentLocation}
            disabled={gpsBusy}
            style={({ pressed }) => [styles.areaBtn, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.areaBtnText} numberOfLines={1}>
              {he.availabilityUseCurrent}
            </Text>
            {gpsBusy ? (
              <SoccerBallLoader size={16} />
            ) : (
              <Ionicons name="locate" size={16} color={ACCENT} />
            )}
          </Pressable>
        </View>
        <AvailabilityRadiusMap
          center={pin}
          radiusKm={radiusKm}
          onPick={handlePinPicked}
          onExpand={() => setMapExpanded(true)}
        />
        {locationPicked && cityLabel ? (
          <Text style={styles.areaCityLabel}>
            {he.availabilityHomeAreaLabel(cityLabel)}
          </Text>
        ) : null}
        {!locationPicked ? (
          <View style={styles.areaWarnCard}>
            <View style={styles.sectionHeaderInner}>
              <Text style={styles.areaWarnTitle}>
                {he.availabilityAreaNotSetTitle}
              </Text>
              <Ionicons name="alert-circle-outline" size={16} color={colors.warning} />
            </View>
            <Text style={styles.areaWarnHint}>{he.availabilityAreaNotSetHint}</Text>
          </View>
        ) : null}

        {/* Range slider */}
        <View style={styles.rangeHeader}>
          <View style={styles.sectionHeaderInner}>
            <Text style={styles.sectionTitle}>{he.availabilityRangeTitle}</Text>
            <Ionicons name="resize-outline" size={18} color={ACCENT} />
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
              <Text style={styles.notifTitle}>{he.availabilityNotifTitle}</Text>
              <Ionicons name="notifications-outline" size={18} color={colors.success} />
            </View>
            <Text style={styles.notifHint}>{he.availabilityNotifHint}</Text>
          </View>
          <BallSwitch
            accessibilityLabel={he.availabilityNotifTitle}
            value={notify}
            onValueChange={(v) => {
              setNotify(v);
              logEvent(AnalyticsEvent.AvailabilityFillerPushToggled, { enabled: v });
            }}
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
        // Same rule as the inline label below the small map, and for the same
        // reason: `initial.homeCity` is exactly the wrong fallback here. A pin
        // drop clears `cityLabel` (the old name no longer describes the new
        // spot), so falling back to the saved city made the big map's header
        // announce 'בני ברק' over a pin the user had just dropped in חיפה —
        // the stale label this change set out to remove, on the bigger screen.
        cityName={locationPicked && cityLabel ? cityLabel : undefined}
        onClose={() => setMapExpanded(false)}
        onPick={handlePinPicked}
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
        <Text style={styles.sectionTitle}>{title}</Text>
        <Ionicons name={icon} size={18} color={ACCENT} />
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
  areaBtnText: { fontSize: 13, fontWeight: '700', color: ACCENT, flexShrink: 1 },
  areaCityLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
    marginTop: spacing.sm,
  },
  // "No home area chosen yet" notice — sits under the map until the user
  // picks a real spot, so nobody saves the default view by accident.
  areaWarnCard: {
    gap: 4,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#FCD9A0',
    backgroundColor: '#FFF7E8',
  },
  areaWarnTitle: {
    fontSize: 13.5,
    fontWeight: '800',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
    writingDirection: 'rtl',
  },
  areaWarnHint: {
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    writingDirection: 'rtl',
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
  quickFillHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  quickFillLabel: {
    fontSize: 12.5,
    color: colors.textMuted,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
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
