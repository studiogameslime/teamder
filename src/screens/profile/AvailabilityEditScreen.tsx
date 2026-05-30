// Edits the user's availability (preferred days / time range / city /
// invitable toggle) and persists it via userService.updateProfile.
//
// Phase 5 scope: form-only. The data is read by Game create + Player Card
// "Invite to Game" matching when those features ship. We don't show
// explicit feedback if the user has never set availability — defaults to
// no days selected, empty time range, empty city, invitable=true.

import React, { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { updateDoc } from 'firebase/firestore';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/Button';
import { AutocompleteInput } from '@/components/AutocompleteInput';
import { AppTimeField } from '@/components/DateTimeFields';
import { userService } from '@/services';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { storage } from '@/services/storage';
import { docs } from '@/firebase/firestore';
import { USE_MOCK_DATA } from '@/firebase/config';
import { searchCities } from '@/services/israelLocationService';
import { UserAvailability, WeekdayIndex } from '@/types';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';

const ALL_DAYS: WeekdayIndex[] = [0, 1, 2, 3, 4, 5, 6];
/** Radius options offered to the user. 20km is the default — covers
 *  most of "I'm willing to drive there" scenarios for an urban
 *  player without overshooting into "send me to Eilat" territory. */
const RADIUS_OPTIONS = [10, 20, 30, 50, 100] as const;

export function AvailabilityEditScreen() {
  const nav = useNavigation();
  const user = useUserStore((s) => s.currentUser);
  // Pull the action out of the store so we can refresh on save.
  const reloadUser = async () => {
    const fresh = await userService.getCurrentUser();
    if (fresh) {
      // userStore uses immutable state; this re-set keeps store in sync.
      useUserStore.setState({ currentUser: fresh });
    }
  };

  const initial: UserAvailability = user?.availability ?? {
    preferredDays: [],
    timeFrom: '',
    timeTo: '',
    homeCity: '',
    availabilityRadiusKm: 20,
    isAvailableForInvites: true,
    acceptsFillerPush: false,
  };

  const [days, setDays] = useState<WeekdayIndex[]>(initial.preferredDays ?? []);
  const [timeFrom, setTimeFrom] = useState<string>(initial.timeFrom ?? '');
  const [timeTo, setTimeTo] = useState<string>(initial.timeTo ?? '');
  // Single home city. Seed from `homeCity` if present, else fall back
  // to legacy `preferredCity` / first entry of `cities[]`. Mark
  // `homeCityFromList` as true ONLY if we know the saved value came
  // from the autocomplete (we can't tell for legacy data — assume
  // false, force user to re-pick on first save).
  const [homeCity, setHomeCity] = useState<string>(
    initial.homeCity ??
      initial.preferredCity ??
      initial.cities?.[0] ??
      '',
  );
  const [homeCityFromList, setHomeCityFromList] = useState<boolean>(
    typeof initial.homeCity === 'string' && initial.homeCity.length > 0,
  );
  const [radiusKm, setRadiusKm] = useState<number>(
    typeof initial.availabilityRadiusKm === 'number' &&
      initial.availabilityRadiusKm > 0
      ? initial.availabilityRadiusKm
      : 20,
  );
  const [invitable, setInvitable] = useState<boolean>(
    initial.isAvailableForInvites !== false,
  );
  const [acceptsFillerPush, setAcceptsFillerPush] = useState<boolean>(
    initial.acceptsFillerPush === true,
  );
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const toggleDay = (d: WeekdayIndex) => {
    setDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()
    );
  };

  const fetchCities = useCallback(
    (q: string) => searchCities(q),
    [],
  );

  // Block save when the user has opted into filler push but the home
  // city wasn't picked from the list. The matcher reads the EXACT
  // string and the geocoder needs a canonical value to look up.
  const cityIsValid =
    !acceptsFillerPush ||
    (homeCity.trim().length > 0 && homeCityFromList === true);
  const cityInvalid =
    acceptsFillerPush &&
    homeCity.trim().length > 0 &&
    !homeCityFromList;

  const save = async () => {
    if (!cityIsValid) {
      Alert.alert(he.error, he.availabilityHomeCityMustPick);
      return;
    }
    setBusy(true);
    try {
      const cityVal = homeCity.trim();
      const next: UserAvailability = {
        preferredDays: days,
        timeFrom: timeFrom.trim() || undefined,
        timeTo: timeTo.trim() || undefined,
        // Keep legacy fields populated for backward compat with old
        // clients that still read `preferredCity` / `cities[]`.
        preferredCity: cityVal || undefined,
        cities: cityVal ? [cityVal] : [],
        homeCity: cityVal || undefined,
        availabilityRadiusKm: radiusKm,
        isAvailableForInvites: invitable,
        acceptsFillerPush,
      };
      // Geocode the home city and persist coords if we got them.
      // Best-effort: a failed geocode just stores no coords; the
      // matcher then falls back to exact-city match for this user.
      const coords = cityVal ? await tryGeocodeCity(cityVal) : null;
      await persistAvailability(user.id, next, coords);
      logEvent(AnalyticsEvent.AvailabilitySet, {
        days: days.join(','),
        invitable: String(invitable),
        hasCity: cityVal.length > 0,
        radiusKm,
        acceptsFillerPush: String(acceptsFillerPush),
        geocoded: coords !== null,
      });
      await reloadUser();
      nav.goBack();
    } catch (e) {
      Alert.alert(he.error, String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.availabilityTitle} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>{he.availabilityIntro}</Text>

        <View style={styles.field}>
          <Text style={styles.label}>{he.availabilityDays}</Text>
          <View style={styles.daysRow}>
            {ALL_DAYS.map((d) => {
              const active = days.includes(d);
              return (
                <Pressable
                  key={d}
                  onPress={() => toggleDay(d)}
                  style={({ pressed }) => [
                    styles.dayPill,
                    active && styles.dayPillActive,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text
                    style={[
                      styles.dayPillText,
                      active && { color: '#FFFFFF', fontWeight: '700' },
                    ]}
                  >
                    {he.availabilityDayShort[d]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <AppTimeField
          label={he.availabilityTimeFrom}
          value={timeFrom}
          onChange={setTimeFrom}
        />
        <AppTimeField
          label={he.availabilityTimeTo}
          value={timeTo}
          onChange={setTimeTo}
        />

        <View style={styles.field}>
          <AutocompleteInput
            label={he.availabilityHomeCity}
            value={homeCity}
            onChange={(t) => {
              setHomeCity(t);
              setHomeCityFromList(false);
            }}
            onSelect={(v) => {
              setHomeCity(v);
              setHomeCityFromList(true);
            }}
            placeholder={he.availabilityHomeCityPlaceholder}
            fetchSuggestions={fetchCities}
          />
          {cityInvalid ? (
            <Text style={styles.hintError}>
              {he.availabilityHomeCityMustPick}
            </Text>
          ) : (
            <Text style={styles.hint}>{he.availabilityHomeCityHint}</Text>
          )}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>
            {he.availabilityRadius(radiusKm)}
          </Text>
          <View style={styles.radiusRow}>
            {RADIUS_OPTIONS.map((km) => {
              const active = radiusKm === km;
              return (
                <Pressable
                  key={km}
                  onPress={() => setRadiusKm(km)}
                  style={({ pressed }) => [
                    styles.radiusPill,
                    active && styles.radiusPillActive,
                    pressed && { opacity: 0.85 },
                  ]}
                  accessibilityRole="button"
                >
                  <Text
                    style={[
                      styles.radiusPillText,
                      active && styles.radiusPillTextActive,
                    ]}
                  >
                    {km} ק"מ
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.hint}>{he.availabilityRadiusHint}</Text>
        </View>

        <Pressable
          onPress={() => setInvitable(!invitable)}
          style={styles.toggleRow}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>{he.availabilityInvitable}</Text>
            <Text style={styles.hint}>{he.availabilityInvitableHint}</Text>
          </View>
          <Switch
            value={invitable}
            onValueChange={setInvitable}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor="#fff"
          />
        </Pressable>

        <Pressable
          onPress={() => setAcceptsFillerPush(!acceptsFillerPush)}
          style={styles.toggleRow}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>{he.availabilityFillerPush}</Text>
            <Text style={styles.hint}>{he.availabilityFillerPushHint}</Text>
          </View>
          <Switch
            value={acceptsFillerPush}
            onValueChange={setAcceptsFillerPush}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor="#fff"
          />
        </Pressable>
      </ScrollView>

      <View style={{ padding: spacing.lg }}>
        <Button
          title={he.availabilitySave}
          variant="primary"
          size="lg"
          fullWidth
          loading={busy}
          onPress={save}
        />
      </View>
    </SafeAreaView>
  );
}

// ── Persistence helper ────────────────────────────────────────────────────
// Writes only the `availability` field. We don't add a method to userService
// because availability lives entirely on the user doc and there's nothing
// non-trivial in the write logic — keeping it inline avoids over-growing
// the service surface for a single screen.

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
      timeFrom: availability.timeFrom ?? null,
      timeTo: availability.timeTo ?? null,
      preferredCity: availability.preferredCity ?? null,
      cities: Array.isArray(availability.cities) ? availability.cities : [],
      homeCity: availability.homeCity ?? null,
      // Coords come from a best-effort geocode; null means "unknown".
      // The matcher gracefully degrades when missing.
      homeCityLat: coords?.lat ?? null,
      homeCityLng: coords?.lng ?? null,
      availabilityRadiusKm:
        typeof availability.availabilityRadiusKm === 'number'
          ? availability.availabilityRadiusKm
          : 20,
      isAvailableForInvites: availability.isAvailableForInvites !== false,
      acceptsFillerPush: availability.acceptsFillerPush === true,
    },
    updatedAt: Date.now(),
  });
}

/**
 * Best-effort geocode of a city name to lat/lng. Returns null on
 * any failure (network, rate limit, unknown city). The user record
 * stores the city name regardless; the coords are an optimisation
 * for distance-based filler matching.
 *
 * Implementation: lazy-import the geocode service so this screen
 * doesn't pull the network module unless the user actually saves
 * a city. The service handles caching internally.
 */
async function tryGeocodeCity(
  city: string,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const { geocodeCity } = await import('@/services/geocodeService');
    return await geocodeCity(city);
  } catch (err) {
    if (__DEV__) console.warn('[availability] geocode failed', err);
    return null;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  intro: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    marginBottom: spacing.sm,
  },
  field: { gap: spacing.xs },
  label: { ...typography.label, color: colors.textMuted },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
    textAlign: RTL_LABEL_ALIGN,
  },
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  daysRow: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  dayPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 44,
    alignItems: 'center',
  },
  // Active = strong fill + white text. The previous design used
  // primaryLight + primary text which was hard to tell apart from
  // unselected pills (low contrast). Bold fill makes selection obvious.
  dayPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  dayPillText: { ...typography.body, color: colors.textMuted },

  timeRow: { flexDirection: 'row', gap: spacing.sm },
  hintError: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.xs,
    textAlign: RTL_LABEL_ALIGN,
  },
  radiusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  radiusPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 60,
    alignItems: 'center',
  },
  radiusPillActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  radiusPillText: {
    ...typography.body,
    color: colors.textMuted,
  },
  radiusPillTextActive: {
    color: colors.primary,
    fontWeight: '700',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
});
