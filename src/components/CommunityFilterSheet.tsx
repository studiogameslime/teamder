// CommunityFilterSheet — modal sheet for filtering the Communities feed.
//
// Filter dimensions:
//   • Auto-join          — isOpen=true: anyone can join without approval
//   • Regular games      — community runs a recurring weekly fixture
//   • Nearby             — radius around the viewer's GPS location
//
// The "near me" card is intentionally IDENTICAL to the one in
// GameFilterSheet — same permission-aware prompt, same FilterRadiusMap
// preview, same 1→50 km RangeSlider and tap-to-expand RadiusMapModal —
// so the two filters read and behave the same way.
//
// The screen owns the GroupFilters state and the GPS-resolution side-
// effect — this component is purely presentational like GameFilterSheet.

import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
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
import { GroupPublic, WeekdayIndex } from '@/types';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

const ALL_DAYS: WeekdayIndex[] = [0, 1, 2, 3, 4, 5, 6];

/** Radius slider bounds (km) — identical to GameFilterSheet. */
const RADIUS_MIN = 1;
const RADIUS_MAX = 50;

/** Default search radius for the "nearby" filter. 25 km comfortably
 *  covers a metro-area cluster (e.g. Tel Aviv + Ramat Gan + Givatayim
 *  + Bnei Brak + Ramat Hasharon) without bleeding into the next
 *  region entirely. Configurable per-user later. */
export const DEFAULT_NEARBY_RADIUS_KM = 25;

export interface GroupFilters {
  /** Hide groups that hit their maxMembers cap. */
  hasRoom: boolean;
  /** Show only auto-join (`isOpen === true`) groups. */
  autoJoinOnly: boolean;
  /** Hide groups with `costPerGame > 0`. */
  freeOnly: boolean;
  /** Show only communities that run a recurring weekly fixture. */
  regularGamesOnly: boolean;
  /** Subset of the week the group plays on; empty = no day filter. */
  preferredDays: WeekdayIndex[];
  /** Match group within `nearbyRadiusKm` of the viewer's GPS location.
   *  Caller resolves the viewer's `LatLng` and passes it as `nearbyLatLng`. */
  nearby: boolean;
  /** Radius in km — only consulted when `nearby` is true. */
  nearbyRadiusKm: number;
}

export const EMPTY_GROUP_FILTERS: GroupFilters = {
  hasRoom: false,
  autoJoinOnly: false,
  freeOnly: false,
  regularGamesOnly: false,
  preferredDays: [],
  nearby: false,
  nearbyRadiusKm: DEFAULT_NEARBY_RADIUS_KM,
};

export function isGroupFiltersEmpty(f: GroupFilters): boolean {
  return (
    !f.hasRoom &&
    !f.autoJoinOnly &&
    !f.freeOnly &&
    !f.regularGamesOnly &&
    f.preferredDays.length === 0 &&
    !f.nearby
  );
}

export function activeGroupFiltersCount(f: GroupFilters): number {
  let n = 0;
  if (f.hasRoom) n += 1;
  if (f.autoJoinOnly) n += 1;
  if (f.freeOnly) n += 1;
  if (f.regularGamesOnly) n += 1;
  if (f.preferredDays.length > 0) n += 1;
  if (f.nearby) n += 1;
  return n;
}

interface Props {
  visible: boolean;
  filters: GroupFilters;
  onChange: (next: GroupFilters) => void;
  onClose: () => void;
  /** Optional caption shown next to the "nearby" toggle (e.g. resolved city). */
  nearbyCaption?: string;
  /** Resolved viewer coords — drives the radius-map preview (parity with the
   *  games filter). When absent the map is hidden and a pin is shown. */
  nearbyLatLng?: { lat: number; lng: number } | null;
}

export function CommunityFilterSheet({
  visible,
  filters,
  onChange,
  onClose,
  nearbyCaption,
  nearbyLatLng,
}: Props) {
  const [bigMapOpen, setBigMapOpen] = useState(false);
  // Whether the app ALREADY holds foreground location permission. When it
  // does we drop the "אפשר גישה למיקום" framing (there's nothing to grant)
  // and show a plain enable control instead. Read non-prompting on open.
  // (Mirrors GameFilterSheet exactly.)
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
            <Text style={styles.title}>{he.communityFiltersTitle}</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            bounces
            alwaysBounceVertical
          >
            {/* Two real, working filters:
                  • autoJoinOnly    → maps to Group.isOpen
                  • regularGamesOnly → community runs a recurring weekly
                                       fixture (signalled by a non-empty
                                       preferredDays schedule on the
                                       public group doc).
                The earlier "free only" + "preferred days" rows were
                hidden (costPerGame / preferredDays unset on most
                groups); their fields stay on GroupFilters for
                backward-compat with stored prefs / legacy callers. */}
            <SwitchRow
              label={he.communityFiltersOnlyOpen}
              value={filters.autoJoinOnly}
              onChange={(v) => onChange({ ...filters, autoJoinOnly: v })}
            />
            <SwitchRow
              label="מועדונים עם משחקים קבועים"
              value={filters.regularGamesOnly}
              onChange={(v) => onChange({ ...filters, regularGamesOnly: v })}
            />

            {/* ── קרוב אליי — identical to GameFilterSheet ──────────── */}
            <View style={styles.sectionHeader}>
              <Ionicons name="location-outline" size={18} color={colors.primary} />
              <Text style={styles.sectionTitle}>
                {he.gameFiltersNearbyTitle}
              </Text>
            </View>
            <View style={styles.nearbyCard}>
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
                {nearbyLatLng ? (
                  <FilterRadiusMap
                    center={nearbyLatLng}
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
          </ScrollView>

          <View style={styles.footer}>
            <Button
              title={he.gameFiltersReset}
              variant="outline"
              size="lg"
              onPress={() => onChange(EMPTY_GROUP_FILTERS)}
            />
            <View style={{ flex: 1 }}>
              <Button
                title={he.gameFiltersApply}
                variant="primary"
                size="lg"
                fullWidth
                onPress={onClose}
              />
            </View>
          </View>
        </Pressable>
      </SpringSheet>

      {nearbyLatLng ? (
        <RadiusMapModal
          visible={bigMapOpen}
          center={nearbyLatLng}
          radiusKm={filters.nearbyRadiusKm}
          cityName={nearbyCaption}
          onClose={() => setBigMapOpen(false)}
        />
      ) : null}
    </Modal>
  );
}

function SwitchRow({
  label,
  caption,
  value,
  onChange,
}: {
  label: string;
  caption?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      style={styles.switchRow}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.switchLabel}>{label}</Text>
        {caption ? <Text style={styles.switchCaption}>{caption}</Text> : null}
      </View>
      <BallSwitch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor="#fff"
      />
    </Pressable>
  );
}

// ─── Filter application ─────────────────────────────────────────────────

interface ApplyContext {
  /** Resolved viewer GPS coords for the "nearby" toggle. Pass undefined
   *  when the toggle is off or location is still resolving — those rows
   *  are treated as "doesn't match" so the list stays predictable. */
  nearbyLatLng?: { lat: number; lng: number };
  /** Optional viewer city — used as a graceful fallback when the viewer
   *  granted location but groups in the DB still lack lat/lng (legacy
   *  rows). Matches case-insensitively on the trimmed city name. */
  nearbyCityFallback?: string;
}

/** Pure filter application — used by PublicGroupsFeedScreen.
 *  Imports haversineKm lazily via direct call site so the filter file
 *  stays cheap to load. */
import { haversineKm } from '@/utils/geo';

/** A public community "runs regular games" when it carries a recurring
 *  weekly schedule. The cleanest signal mirrored onto GroupPublic is a
 *  non-empty `preferredDays` (the weekly fixture's day(s)); recurring
 *  schedules are the only thing that ever populates it. This is the best
 *  available signal without adding a new mirrored field on the public
 *  doc (which would require touching the converter + feed screen). */
function hasRegularGames(g: GroupPublic): boolean {
  return Array.isArray(g.preferredDays) && g.preferredDays.length > 0;
}

export function applyGroupFilters(
  groups: GroupPublic[],
  f: GroupFilters,
  ctx: ApplyContext,
): GroupPublic[] {
  return groups.filter((g) => {
    if (f.hasRoom) {
      const cap = g.maxMembers;
      if (typeof cap === 'number' && g.memberCount >= cap) return false;
    }
    if (f.autoJoinOnly && g.isOpen !== true) return false;
    if (f.freeOnly && typeof g.costPerGame === 'number' && g.costPerGame > 0) {
      return false;
    }
    if (f.regularGamesOnly && !hasRegularGames(g)) return false;
    if (f.preferredDays.length > 0) {
      const days = g.preferredDays ?? [];
      if (!f.preferredDays.some((d) => days.includes(d))) return false;
    }
    if (f.nearby) {
      // Preferred path — radius via GPS. Works regardless of city-name
      // spelling, language, or municipal boundaries.
      if (ctx.nearbyLatLng &&
          typeof g.lat === 'number' &&
          typeof g.lng === 'number') {
        const km = haversineKm(ctx.nearbyLatLng, { lat: g.lat, lng: g.lng });
        if (km > f.nearbyRadiusKm) return false;
        return true;
      }
      // Fallback — for legacy groups that lack lat/lng, accept an
      // exact city-name match against the viewer's resolved city.
      // This preserves the old behaviour for unmigrated rows; once
      // every group is geocoded the branch goes dead.
      if (ctx.nearbyCityFallback && g.city) {
        const sameCity = g.city.trim().toLowerCase() ===
                         ctx.nearbyCityFallback.trim().toLowerCase();
        if (!sameCity) return false;
        return true;
      }
      // Neither path can verify — exclude the row.
      return false;
    }
    return true;
  });
}

// ─── Styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    // Fill the SpringSheet panel (top:10%→bottom = 90% of screen) so the
    // sheet has a DEFINITE height — that's what lets the body ScrollView's
    // `flex:1` resolve and scroll, with the footer pinned at the bottom.
    flex: 1,
    paddingBottom: spacing.xl,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginTop: 8,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  title: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
  },
  body: { flex: 1 },
  bodyContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  // ── Section header (matches GameFilterSheet) ──────────────────────
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
    marginTop: spacing.sm,
    marginBottom: 2,
  },
  sectionTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  // ── Nearby card (identical to GameFilterSheet) ────────────────────
  nearbyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
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
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  switchLabel: {
    ...typography.body,
    color: colors.text,
    fontWeight: '500',
    textAlign: RTL_LABEL_ALIGN,
    width: '100%',
  },
  switchCaption: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: RTL_LABEL_ALIGN,
    width: '100%',
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    alignItems: 'center',
  },
});
