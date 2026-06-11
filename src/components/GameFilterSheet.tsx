// GameFilterSheet — modal sheet for filtering the matches list.
//
// Redesigned (2026-06) to the "סינון משחקים" mockup:
//   • מתי            — היום / מחר / בחר יום (→ weekday chips, like the
//                      availability screen; no native date-picker dep)
//   • קרוב אליי       — location card: permission prompt + radius slider
//   • סינונים מהירים  — פתוח לכולם · יש מקומות פנויים (toggle cards)
//   • פורמט משחק      — 5×5 / 6×6 / 7×7 (multi-select segments)
//
// Dropped from the old sheet (product decision): the payment/cost
// filter, field-type filter, the approval tri-state, and the
// public/community tri-state (replaced by a single "פתוח לכולם" toggle).
//
// The list screen owns the GameFilters state; this component is purely
// presentational and reports changes via `onChange`. Setting
// `nearby:true` makes the list screen resolve GPS + (on denial) flip it
// back off, so the "אפשר גישה למיקום" button just sets nearby:true.

import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { BallSwitch } from '@/components/anim/BallSwitch';
import { Ionicons } from '@expo/vector-icons';
import { Button } from './Button';
import { RangeSlider } from './RangeSlider';
import { FilterRadiusMap } from '@/components/games/FilterRadiusMap';
import { RadiusMapModal } from '@/components/games/RadiusMapModal';
import { SpringSheet } from '@/components/anim/SpringSheet';
import { GameFormat, WeekdayIndex } from '@/types';
import { haversineKm } from '@/utils/geo';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

const FORMATS: GameFormat[] = ['5v5', '6v6', '7v7'];
const ALL_WEEKDAYS: WeekdayIndex[] = [0, 1, 2, 3, 4, 5, 6];

/** Radius slider bounds (km). Mockup runs 50 (left) → 1 (right). */
const RADIUS_MIN = 1;
const RADIUS_MAX = 50;

/** Date window. `day` = a specific upcoming weekday (see `weekday`). */
export type GameTimeWindow = 'any' | 'today' | 'tomorrow' | 'day';

export interface GameFilters {
  /** Time window — primary question, surfaces at the top of the sheet. */
  when: GameTimeWindow;
  /** The chosen weekday when `when === 'day'` (the next occurrence). */
  weekday: WeekdayIndex | null;
  formats: GameFormat[];
  /** "פתוח לכולם" — show only games open to the whole app (public). */
  openToAll: boolean;
  /** When true, hide games that are full (no spots in players). */
  onlyAvailable: boolean;
  /** Match games within `nearbyRadiusKm` of the viewer's location. The
   *  list screen resolves the viewer's coords and passes them via ctx. */
  nearby: boolean;
  /** Radius in km — only consulted when `nearby` is true. */
  nearbyRadiusKm: number;
}

/** Default "near me" radius — a metro-area cluster. */
export const DEFAULT_GAME_NEARBY_RADIUS_KM = 25;

export const EMPTY_GAME_FILTERS: GameFilters = {
  when: 'any',
  weekday: null,
  formats: [],
  openToAll: false,
  onlyAvailable: false,
  nearby: false,
  nearbyRadiusKm: DEFAULT_GAME_NEARBY_RADIUS_KM,
};

export function isFiltersEmpty(f: GameFilters): boolean {
  return (
    f.when === 'any' &&
    f.formats.length === 0 &&
    !f.openToAll &&
    !f.onlyAvailable &&
    !f.nearby
  );
}

export function activeFiltersCount(f: GameFilters): number {
  let n = 0;
  if (f.when !== 'any') n += 1;
  if (f.formats.length) n += 1;
  if (f.openToAll) n += 1;
  if (f.onlyAvailable) n += 1;
  if (f.nearby) n += 1;
  return n;
}

/** Start-of-day ms for the date `daysAhead` days from `now`. */
function dayStart(now: number, daysAhead: number): number {
  const d = new Date(now);
  d.setDate(d.getDate() + daysAhead);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** ms range [start, end] of the next upcoming occurrence of `weekday`. */
function nextWeekdayRange(
  weekday: WeekdayIndex,
  now = Date.now(),
): { start: number; end: number } {
  const today = new Date(now).getDay();
  const ahead = (weekday - today + 7) % 7; // 0 = today, else next occurrence
  const start = dayStart(now, ahead);
  return { start, end: start + 24 * 60 * 60 * 1000 - 1 };
}

/** Apply the time window to a startsAt timestamp. */
export function gameMatchesWhen(
  startsAt: number,
  when: GameTimeWindow,
  weekday: WeekdayIndex | null,
  now = Date.now(),
): boolean {
  if (when === 'any') return true;
  if (startsAt < now) return false;
  if (when === 'today') {
    return startsAt <= dayStart(now, 1) - 1;
  }
  if (when === 'tomorrow') {
    return startsAt >= dayStart(now, 1) && startsAt <= dayStart(now, 2) - 1;
  }
  if (when === 'day' && weekday !== null) {
    const { start, end } = nextWeekdayRange(weekday, now);
    return startsAt >= start && startsAt <= end;
  }
  return true;
}

interface Props {
  visible: boolean;
  filters: GameFilters;
  onChange: (next: GameFilters) => void;
  onClose: () => void;
  /** Live count of games matching the current draft — shown in the CTA. */
  matchCount?: number;
  /** Optional caption under the location card (e.g. resolved city). */
  nearbyCaption?: string;
  /** Map centre for the radius preview (viewer GPS or home city). When
   *  absent the map is hidden and only the slider is shown. */
  mapCenter?: { lat: number; lng: number } | null;
}

export function GameFilterSheet({
  visible,
  filters,
  onChange,
  onClose,
  matchCount,
  nearbyCaption,
  mapCenter,
}: Props) {
  const [bigMapOpen, setBigMapOpen] = useState(false);
  // Whether the app ALREADY holds foreground location permission. When it
  // does we drop the "אפשר גישה למיקום" framing (there's nothing to grant)
  // and show a plain enable control instead. Read non-prompting on open.
  const [locationGranted, setLocationGranted] = useState(false);

  useEffect(() => {
    if (!visible) return;
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
        // ignore — leave as not-granted, show the permission prompt.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const toggleFormat = (f: GameFormat) =>
    onChange({
      ...filters,
      formats: filters.formats.includes(f)
        ? filters.formats.filter((x) => x !== f)
        : [...filters.formats, f],
    });

  // Tapping an active "when" chip clears it back to "any" (the sheet has
  // no explicit "all" chip — matches the mockup's 3-chip row).
  const setWhen = (w: GameTimeWindow) =>
    onChange({
      ...filters,
      when: filters.when === w && w !== 'day' ? 'any' : w,
      weekday: w === 'day' ? filters.weekday : null,
    });

  const pickWeekday = (d: WeekdayIndex) =>
    onChange({
      ...filters,
      when: filters.weekday === d ? 'any' : 'day',
      weekday: filters.weekday === d ? null : d,
    });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <SpringSheet visible={visible} onBackdropPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel={he.close}
            >
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
            <Text style={styles.title}>{he.gameFiltersTitle}</Text>
            <View style={styles.closeBtn} />
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* ── מתי ─────────────────────────────────────────────── */}
            <SectionHeader icon="calendar-outline" title={he.gameFiltersWhen} />
            {/* First JSX child lands on the visual RIGHT (forceRTL):
                היום leads, בחר יום trails — matching the mockup. */}
            <View style={styles.segmentRow}>
              <Segment
                label={he.gameFiltersWhenToday}
                active={filters.when === 'today'}
                onPress={() => setWhen('today')}
              />
              <Segment
                label={he.gameFiltersWhenTomorrow}
                active={filters.when === 'tomorrow'}
                onPress={() => setWhen('tomorrow')}
              />
              <Segment
                label={he.gameFiltersWhenPickDay}
                icon="calendar-outline"
                active={filters.when === 'day'}
                onPress={() => setWhen('day')}
              />
            </View>
            {filters.when === 'day' ? (
              <View style={styles.daysRow}>
                {ALL_WEEKDAYS.map((d) => {
                  const active = filters.weekday === d;
                  return (
                    <Pressable
                      key={d}
                      onPress={() => pickWeekday(d)}
                      style={({ pressed }) => [
                        styles.dayChip,
                        active && styles.dayChipActive,
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.dayChipText,
                          active && styles.dayChipTextActive,
                        ]}
                      >
                        {he.availabilityDayLetter[d]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {/* ── קרוב אליי ───────────────────────────────────────── */}
            <SectionHeader icon="location-outline" title={he.gameFiltersNearbyTitle} />
            <View style={styles.nearbyCard}>
              {/* Top row: radius map on the LEFT, the prompt / active
                  state on the RIGHT (forceRTL `row` → first child right). */}
              <View style={styles.nearbyRow}>
                <View style={styles.nearbyContent}>
                  {filters.nearby ? (
                    <>
                      <View style={styles.nearbyActiveTop}>
                        <Ionicons
                          name="checkmark-circle"
                          size={20}
                          color={colors.success}
                        />
                        <Text style={styles.nearbyActiveTitle}>
                          {he.gameFiltersNearbyActive}
                        </Text>
                      </View>
                      {nearbyCaption ? (
                        <Text style={styles.nearbyCaption}>{nearbyCaption}</Text>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <Text style={styles.nearbyPromptTitle}>
                        {locationGranted
                          ? he.gameFiltersNearbyEnableTitle
                          : he.gameFiltersNearbyNeedPermission}
                      </Text>
                      <Text style={styles.nearbyPromptHint}>
                        {locationGranted
                          ? he.gameFiltersNearbyEnableHint
                          : he.gameFiltersNearbyPermissionHint}
                      </Text>
                      <Pressable
                        onPress={() => onChange({ ...filters, nearby: true })}
                        style={({ pressed }) => [
                          styles.nearbyAllowBtn,
                          pressed && { opacity: 0.9 },
                        ]}
                        accessibilityRole="button"
                      >
                        <Ionicons
                          name="navigate-outline"
                          size={16}
                          color={colors.primary}
                        />
                        <Text style={styles.nearbyAllowText}>
                          {locationGranted
                            ? he.gameFiltersNearbyEnable
                            : he.gameFiltersNearbyAllow}
                        </Text>
                      </Pressable>
                    </>
                  )}
                </View>
                {mapCenter ? (
                  <FilterRadiusMap
                    center={mapCenter}
                    radiusKm={filters.nearbyRadiusKm}
                    size={120}
                    onPress={() => setBigMapOpen(true)}
                  />
                ) : (
                  <View style={styles.nearbyPinWrap}>
                    <Ionicons name="location" size={30} color={colors.primary} />
                  </View>
                )}
              </View>

              <View style={styles.sliderLabels}>
                <Text style={styles.sliderEnd}>{he.gameFiltersKm(RADIUS_MIN)}</Text>
                <Text style={styles.sliderEnd}>{he.gameFiltersKm(RADIUS_MAX)}</Text>
              </View>
              {/* Standard direction: 1 ק"מ (left) → 50 ק"מ (right). */}
              <RangeSlider
                min={RADIUS_MIN}
                max={RADIUS_MAX}
                step={1}
                value={filters.nearbyRadiusKm}
                onChange={(v) =>
                  onChange({ ...filters, nearbyRadiusKm: v })
                }
                thumbLabel={String(filters.nearbyRadiusKm)}
              />
            </View>

            {/* ── סינונים מהירים ──────────────────────────────────── */}
            <SectionHeader icon="flash-outline" title={he.gameFiltersQuickTitle} />
            <View style={styles.quickRow}>
              <QuickToggle
                icon="globe-outline"
                label={he.gameFiltersOpenToAll}
                value={filters.openToAll}
                onChange={(v) => onChange({ ...filters, openToAll: v })}
              />
              <QuickToggle
                icon="people-outline"
                label={he.gameFiltersHasSpots}
                value={filters.onlyAvailable}
                onChange={(v) => onChange({ ...filters, onlyAvailable: v })}
              />
            </View>

            {/* ── פורמט משחק ──────────────────────────────────────── */}
            <SectionHeader
              icon="football-outline"
              title={he.gameFiltersFormatTitle}
            />
            <View style={styles.segmentRow}>
              {FORMATS.map((f) => (
                <Segment
                  key={f}
                  label={formatLabel(f)}
                  active={filters.formats.includes(f)}
                  onPress={() => toggleFormat(f)}
                />
              ))}
            </View>

            {!isFiltersEmpty(filters) ? (
              <Pressable
                onPress={() => onChange(EMPTY_GAME_FILTERS)}
                hitSlop={8}
                style={styles.clearWrap}
              >
                <Text style={styles.clearText}>{he.gameFiltersReset}</Text>
              </Pressable>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <Button
              title={
                typeof matchCount === 'number'
                  ? he.gameFiltersShowN(matchCount)
                  : he.gameFiltersApply
              }
              variant="primary"
              size="lg"
              fullWidth
              onPress={onClose}
            />
          </View>
        </Pressable>
      </SpringSheet>

      {mapCenter ? (
        <RadiusMapModal
          visible={bigMapOpen}
          center={mapCenter}
          radiusKm={filters.nearbyRadiusKm}
          cityName={nearbyCaption}
          onClose={() => setBigMapOpen(false)}
        />
      ) : null}
    </Modal>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────

function SectionHeader({
  icon,
  title,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
}) {
  // `row` flips under forceRTL → icon (first child) lands on the visual
  // RIGHT, title to its left (matches the mockup's section headers).
  return (
    <View style={styles.sectionHeader}>
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function Segment({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.segment,
        active && styles.segmentActive,
        pressed && { opacity: 0.9 },
      ]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={15}
          color={active ? '#FFFFFF' : colors.textMuted}
        />
      ) : null}
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function QuickToggle({
  icon,
  label,
  value,
  onChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      style={[styles.quickCard, value && styles.quickCardActive]}
    >
      <View style={styles.quickTop}>
        <Ionicons
          name={icon}
          size={18}
          color={value ? colors.primary : colors.textMuted}
        />
        <Text style={styles.quickLabel} numberOfLines={2}>
          {label}
        </Text>
      </View>
      <BallSwitch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor="#fff"
        style={styles.quickSwitch}
      />
    </Pressable>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function formatLabel(f: GameFormat): string {
  if (f === '5v5') return he.gameFormat5;
  if (f === '6v6') return he.gameFormat6;
  return he.gameFormat7;
}

// ─── Filter application — pure function consumed by the list screen ────

export interface GameApplyContext {
  nearbyLatLng?: { lat: number; lng: number };
  nearbyCityFallback?: string;
}

export function applyGameFilters<T extends {
  startsAt: number;
  format?: GameFormat;
  visibility?: 'public' | 'community';
  maxPlayers: number;
  players: string[];
  fieldLat?: number;
  fieldLng?: number;
  city?: string;
}>(games: T[], f: GameFilters, ctx: GameApplyContext = {}): T[] {
  return games.filter((g) => {
    if (!gameMatchesWhen(g.startsAt, f.when, f.weekday)) return false;
    if (f.formats.length > 0 && (!g.format || !f.formats.includes(g.format))) {
      return false;
    }
    if (f.openToAll && (g.visibility ?? 'community') !== 'public') {
      return false;
    }
    if (f.onlyAvailable && g.players.length >= g.maxPlayers) return false;
    if (f.nearby) {
      if (
        ctx.nearbyLatLng &&
        typeof g.fieldLat === 'number' &&
        typeof g.fieldLng === 'number'
      ) {
        const km = haversineKm(ctx.nearbyLatLng, {
          lat: g.fieldLat,
          lng: g.fieldLng,
        });
        return km <= f.nearbyRadiusKm;
      }
      if (ctx.nearbyCityFallback && g.city) {
        return (
          g.city.trim().toLowerCase() ===
          ctx.nearbyCityFallback.trim().toLowerCase()
        );
      }
      return false;
    }
    return true;
  });
}

// ─── Styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    // Fill the SpringSheet panel (top:10%→bottom = 90% of screen) so the
    // sheet has a DEFINITE height. That's what lets the body ScrollView's
    // `flex:1` resolve and scroll, with the footer pinned at the bottom.
    // Capping with maxHeight alone left the sheet content-sized, so the
    // ScrollView never got a bounded height and couldn't scroll.
    flex: 1,
    paddingBottom: spacing.lg,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginTop: 8,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    textAlign: 'center',
  },
  // flex:1 against the now-definite-height sheet → bounded ScrollView
  // that scrolls internally while header + footer stay pinned.
  body: { flex: 1 },
  bodyContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  // `row` → first child (icon) on the visual RIGHT under forceRTL.
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
    marginTop: spacing.md,
    marginBottom: 2,
  },
  sectionTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  // ── Segmented rows (when + format) ──────────────────────────────
  segmentRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    height: 52,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segmentActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  segmentText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
  },
  segmentTextActive: { color: '#FFFFFF' },
  // ── Weekday chips ────────────────────────────────────────────────
  daysRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  dayChip: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayChipText: { ...typography.body, fontWeight: '800', color: colors.text },
  dayChipTextActive: { color: '#FFFFFF' },
  // ── Nearby card ──────────────────────────────────────────────────
  nearbyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  // Top row of the nearby card: content (right) + map (left).
  nearbyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  nearbyContent: { flex: 1, gap: 6 },
  nearbyPinWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nearbyPromptTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  nearbyPromptHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  nearbyActiveTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  nearbyAllowBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    height: 46,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignSelf: 'stretch',
  },
  nearbyAllowText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '800',
  },
  nearbyActiveTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
  nearbyCaption: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    direction: 'ltr',
  },
  sliderEnd: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
  },
  // ── Quick toggles ────────────────────────────────────────────────
  quickRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  // `row` under forceRTL → first child (the icon+label cluster) on the
  // visual RIGHT, the Switch on the visual LEFT.
  quickCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    minHeight: 60,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickCardActive: { borderColor: colors.primary },
  // `row` → icon (first child) on the RIGHT, label to its left.
  quickTop: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  quickLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
    flexShrink: 1,
  },
  quickSwitch: {
    transform: [{ scale: 0.85 }],
  },
  // ── Footer / clear ───────────────────────────────────────────────
  clearWrap: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  clearText: {
    ...typography.body,
    color: colors.textMuted,
    fontWeight: '700',
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
});
