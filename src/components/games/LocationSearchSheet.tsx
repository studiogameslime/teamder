import { observeCaughtError } from '../../utils/errorObservation';
// LocationSearchSheet — full-screen location picker for the game wizard.
//
// Design goal: every chosen location ships with REAL coordinates, so the
// game can be navigated to (Waze) and found by the "games near me" matcher.
// The map is ALWAYS visible. Two ways to choose, both yielding coords:
//   1. Search by text → tap a result (govmap gives precise coords).
//   2. Tap / drag the pin on the map → reverse-geocoded to a label.
// There is no coordless free-text path anymore: a pitch that isn't in the
// search index is placed by tapping the map, which still produces coords.

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeModal as Modal } from '@/components/SafeModal';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';

import { LocationPickerMap } from '@/components/games/LocationPickerMap';
import { searchPlaces, type GovmapPlace } from '@/services/govmapService';
import { reverseGeocode } from '@/services/geocodeService';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

export interface LocationResult {
  label: string;
  lat: number;
  lng: number;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (result: LocationResult) => void;
  initialQuery?: string;
  /** When editing a game that already has coords, center the map there
   *  and show the existing pin so the organiser sees the current spot. */
  initialCoords?: { lat: number; lng: number } | null;
}

// Map default view — focus on Tel Aviv (the busiest area) rather than the
// whole region. The user can pan/zoom anywhere in Israel from here; the
// map is locked to Israel in MapWebView.
const DEFAULT_CENTER = { lat: 32.0853, lng: 34.7818 };
const DEFAULT_ZOOM = 13;

export function LocationSearchSheet({
  visible,
  onClose,
  onSelect,
  initialQuery,
  initialCoords,
}: Props) {
  const [query, setQuery] = useState(initialQuery ?? '');
  const [results, setResults] = useState<GovmapPlace[]>([]);
  const [loading, setLoading] = useState(false);
  /** The search service didn't answer — a different message from "no match". */
  const [searchDown, setSearchDown] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // The currently-staged choice. `label` may be '' briefly while a map
  // tap is being reverse-geocoded; coords are always present once set.
  const [picked, setPicked] = useState<LocationResult | null>(null);
  const [resolving, setResolving] = useState(false);
  const [fly, setFly] = useState<{ lat: number; lng: number; zoom?: number } | null>(
    null,
  );
  const inputRef = useRef<TextInput>(null);
  const choiceRevision = useRef(0);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');

  // Reset to a clean search each time the sheet opens. If we're editing a
  // game that already has coords, seed the pin + center on it.
  useEffect(() => {
    choiceRevision.current += 1;
    setLocating(false);
    setLocationError('');
    if (visible) {
      setQuery(initialQuery ?? '');
      setResults([]);
      setSearchOpen(false);
      setResolving(false);
      if (initialCoords) {
        setPicked({
          label: initialQuery ?? he.locationOnMap,
          lat: initialCoords.lat,
          lng: initialCoords.lng,
        });
        setFly({ ...initialCoords, zoom: 15 });
      } else {
        setPicked(null);
        setFly(null);
      }
    }
    return () => { choiceRevision.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Debounced text search. Only runs while the search dropdown is open
  // (i.e. the user is actively typing) so a result/map pick doesn't
  // re-trigger it.
  useEffect(() => {
    if (!visible || !searchOpen) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearchDown(false);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchPlaces(q);
        if (alive) {
          setResults(r.places);
          setSearchDown(r.unavailable);
        }
      } catch (caughtError273c382242) {
    observeCaughtError(caughtError273c382242, {"source":"src/components/games/LocationSearchSheet.tsx","handler":"LocationSearchSheet","site":"LocationSearchSheet:273c382242"});
        if (alive) {
          setResults([]);
          setSearchDown(true);
        }
      } finally {
        if (alive) setLoading(false);
      }
    }, 600);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, visible, searchOpen]);

  const pickResult = (p: GovmapPlace) => {
    choiceRevision.current += 1;
    setLocating(false);
    setResolving(false);
    setLocationError('');
    Keyboard.dismiss();
    setSearchOpen(false);
    setResults([]);
    setPicked({ label: p.label, lat: p.lat, lng: p.lng });
    setFly({ lat: p.lat, lng: p.lng, zoom: 15 });
  };

  const pickFromMap = (lat: number, lng: number) => {
    const revision = ++choiceRevision.current;
    setLocating(false);
    setLocationError('');
    Keyboard.dismiss();
    setSearchOpen(false);
    setResults([]);
    // Show the pin + a "resolving" label immediately; fill the real label
    // once reverse geocoding returns. Coords are final from this moment.
    setPicked({ label: '', lat, lng });
    setResolving(true);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    Promise.race([
      reverseGeocode(lat, lng),
      new Promise<null>((resolve) => { timeout = setTimeout(() => resolve(null), 8000); }),
    ])
      .then((r) => {
        if (revision !== choiceRevision.current) return;
        setPicked({ label: r?.label || he.locationOnMap, lat, lng });
      })
      .catch((caughtErrore2a679cbdf: unknown) => {
    observeCaughtError(caughtErrore2a679cbdf, {"source":"src/components/games/LocationSearchSheet.tsx","handler":"pickFromMap","site":"LocationSearchSheet:e2a679cbdf"});
        if (revision !== choiceRevision.current) return;
        setPicked({ label: he.locationOnMap, lat, lng });
      })
      .finally(() => {
        if (timeout) clearTimeout(timeout);
        if (revision === choiceRevision.current) setResolving(false);
      });
  };

  const useCurrentLocation = async () => {
    const revision = ++choiceRevision.current;
    setLocating(true);
    setResolving(false);
    setLocationError('');
    Keyboard.dismiss();
    setSearchOpen(false);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (revision !== choiceRevision.current) return;
      if (permission.status !== 'granted') {
        setLocationError('כדי לבחור את המיקום הנוכחי, צריך לאפשר גישה למיקום. אפשר גם לבחור נקודה במפה.');
        return;
      }
      const position = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('LOCATION_TIMEOUT')), 15000); }),
      ]);
      if (revision !== choiceRevision.current) return;
      const { latitude: lat, longitude: lng } = position.coords;
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 29.3 || lat > 33.4 || lng < 34.1 || lng > 35.9) {
        setLocationError('המיקום נמצא מחוץ לאזור המפה. אפשר לחפש מגרש או לבחור נקודה במפה.');
        return;
      }
      setFly({ lat, lng, zoom: 16 });
      pickFromMap(lat, lng);
    } catch (caughtError57ff4fecdc) {
    observeCaughtError(caughtError57ff4fecdc, {"source":"src/components/games/LocationSearchSheet.tsx","handler":"useCurrentLocation","site":"LocationSearchSheet:57ff4fecdc"});
      if (revision === choiceRevision.current) setLocationError('לא הצלחנו לאתר את המיקום כרגע. נסו שוב או בחרו נקודה במפה.');
    } finally {
      if (timeout) clearTimeout(timeout);
      if (revision === choiceRevision.current) setLocating(false);
    }
  };

  const confirm = () => {
    // Block confirm until the tapped point's address has finished resolving —
    // otherwise the user locks in a generic "מיקום על המפה" label before the
    // real street/city settles (user report: "עד שהכפתור לא מתייצב על העיר
    // שלא יהיה לחיץ").
    if (!picked || resolving || locating) return;
    onSelect({
      label: picked.label || he.locationOnMap,
      lat: picked.lat,
      lng: picked.lng,
    });
    onClose();
  };

  // Show the dropdown whenever the user is actively searching — it holds
  // the spinner, the hits, or the "nothing found, tap the map" message.
  const showResults = searchOpen && query.trim().length >= 2;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
            <Ionicons name="close" size={26} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>{he.locationSearchTitle}</Text>
          <View style={{ width: 26 }} />
        </View>

        {/* Search box */}
        <View style={styles.searchBox}>
          <Ionicons name="search" size={20} color={colors.textMuted} />
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={(t) => {
              setLocationError('');
              setQuery(t);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            placeholder={he.createGameFieldPlaceholder}
            placeholderTextColor="#9CA3AF"
            style={styles.searchInput}
            textAlign="right"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 ? (
            <Pressable
              onPress={() => {
                setQuery('');
                setResults([]);
              }}
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        <Pressable onPress={useCurrentLocation} disabled={locating} accessibilityRole="button" style={styles.currentLocation}>
          {locating ? <ActivityIndicator color={colors.primary} size="small" /> : <Ionicons name="locate-outline" size={20} color={colors.primary} />}
          <Text style={styles.currentLocationText}>{locating ? 'מאתרים את המיקום שלך…' : 'המיקום הנוכחי שלי'}</Text>
        </Pressable>
        {locationError ? <Text accessibilityRole="alert" style={styles.locationError}>{locationError}</Text> : null}

        {/* Map (always visible) + results overlay */}
        <View style={styles.mapWrap}>
          <LocationPickerMap
            center={initialCoords ?? DEFAULT_CENTER}
            zoom={initialCoords ? 15 : DEFAULT_ZOOM}
            pin={picked ? { lat: picked.lat, lng: picked.lng } : null}
            onPick={pickFromMap}
            focusOn={fly}
          />

          {showResults ? (
            <View style={styles.resultsOverlay}>
              <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={{flexShrink:1}}>
              {loading ? (
                <View style={styles.center}>
                  <ActivityIndicator color={colors.primary} />
                </View>
              ) : results.length > 0 ? (
                results.map((p, i) => (
                  <Pressable
                    key={`${p.label}-${i}`}
                    style={styles.resultRow}
                    onPress={() => pickResult(p)}
                  >
                    <Ionicons name="location-outline" size={20} color={colors.textMuted} />
                    <Text style={styles.resultText} numberOfLines={2}>
                      {p.label}
                    </Text>
                  </Pressable>
                ))
              ) : (
                <Text style={styles.empty}>
                  {searchDown ? he.locationSearchUnavailable : he.locationNoResults}
                </Text>
              )}
              <Text style={styles.attribution}>נתוני כתובות: Govmap · OpenStreetMap / Photon</Text>
              </ScrollView>
            </View>
          ) : null}
        </View>

        {/* Footer — picked location + confirm, or a how-to hint */}
        <View style={styles.footer}>
          {picked ? (
            <>
              <View style={styles.pickedRow}>
                <Ionicons name="location" size={22} color={colors.primary} />
                {resolving ? (
                  <Text style={styles.pickedLabel} numberOfLines={2}>
                    {he.locationResolving}
                  </Text>
                ) : (
                  <Text style={styles.pickedLabel} numberOfLines={2}>
                    {picked.label || he.locationOnMap}
                  </Text>
                )}
              </View>
              <Pressable
                style={[styles.primaryBtn, (resolving || locating) && styles.primaryBtnDisabled]}
                onPress={confirm}
                disabled={resolving || locating}
              >
                <Text style={styles.primaryBtnText}>{he.locationConfirm}</Text>
              </Pressable>
            </>
          ) : (
            <View style={styles.hintRow}>
              <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
              <Text style={styles.hintText}>{he.locationTapHint}</Text>
            </View>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  currentLocation: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12, marginHorizontal: 16, marginBottom: 10, borderRadius: 14, backgroundColor: '#EAF2FF' },
  currentLocationText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  locationError: { color: '#B42318', textAlign: RTL_LABEL_ALIGN, paddingHorizontal: 20, paddingBottom: 10, fontSize: 13 },
  attribution: { color: colors.textMuted, textAlign: 'center', fontSize: 10, padding: 6 },
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  closeBtn: { padding: 2 },
  headerTitle: { ...typography.h3, color: colors.text, fontWeight: '800' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    margin: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: '#F5F5F5',
    borderRadius: radius.lg,
  },
  searchInput: {
    ...typography.body,
    flex: 1,
    color: colors.text,
    writingDirection: 'rtl',
    paddingVertical: spacing.xs,
  },
  mapWrap: { flex: 1, marginHorizontal: spacing.lg, borderRadius: radius.lg, overflow: 'hidden' },
  resultsOverlay: {
    maxHeight: '100%',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    paddingHorizontal: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  center: { paddingVertical: spacing.lg, alignItems: 'center' },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  resultText: { ...typography.body, color: colors.text, flex: 1, textAlign: RTL_LABEL_ALIGN },
  empty: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  footer: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  pickedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pickedLabel: { ...typography.body, color: colors.text, fontWeight: '700', flex: 1, textAlign: RTL_LABEL_ALIGN },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, justifyContent: 'center' },
  hintText: { ...typography.body, color: colors.textMuted, flex: 1, textAlign: RTL_LABEL_ALIGN },
});
