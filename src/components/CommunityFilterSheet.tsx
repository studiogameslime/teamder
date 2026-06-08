// CommunityFilterSheet — modal sheet for filtering the Communities feed.
//
// Filter dimensions:
//   • Has open spot      — under maxMembers cap (or no cap)
//   • Auto-join          — isOpen=true: anyone can join without approval
//   • Free only          — costPerGame === 0 || undefined
//   • Preferred days     — multi-select (sun..sat)
//   • Nearby             — match user's city (city resolved by caller)
//
// The screen owns the GroupFilters state and the city-resolution side-
// effect — this component is purely presentational like GameFilterSheet.

import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from './Button';
import { RadiusSelector } from './RadiusSelector';
import { SpringSheet } from '@/components/anim/SpringSheet';
import { GroupPublic, WeekdayIndex } from '@/types';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

const ALL_DAYS: WeekdayIndex[] = [0, 1, 2, 3, 4, 5, 6];

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
  preferredDays: [],
  nearby: false,
  nearbyRadiusKm: DEFAULT_NEARBY_RADIUS_KM,
};

export function isGroupFiltersEmpty(f: GroupFilters): boolean {
  return (
    !f.hasRoom &&
    !f.autoJoinOnly &&
    !f.freeOnly &&
    f.preferredDays.length === 0 &&
    !f.nearby
  );
}

export function activeGroupFiltersCount(f: GroupFilters): number {
  let n = 0;
  if (f.hasRoom) n += 1;
  if (f.autoJoinOnly) n += 1;
  if (f.freeOnly) n += 1;
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
}

export function CommunityFilterSheet({
  visible,
  filters,
  onChange,
  onClose,
  nearbyCaption,
}: Props) {
  const toggleDay = (d: WeekdayIndex) =>
    onChange({
      ...filters,
      preferredDays: filters.preferredDays.includes(d)
        ? filters.preferredDays.filter((x) => x !== d)
        : [...filters.preferredDays, d].sort(),
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
            <Text style={styles.title}>{he.communityFiltersTitle}</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Three filters that match real fields on every group:
                  • autoJoinOnly  → maps to Group.isOpen
                  • hasRoom        → maps to Group.maxMembers vs roster
                  • nearby         → maps to Group.city + viewer city
                The earlier sheet also exposed "free only" (costPerGame
                is never set today) and "preferred days" (also unset
                on every group). They cluttered the UI without
                actually filtering anything, so they're hidden here.
                The fields stay on the GroupFilters interface for
                backward-compat with stored prefs / legacy callers. */}
            <SwitchRow
              label={he.communityFiltersOnlyOpen}
              value={filters.autoJoinOnly}
              onChange={(v) => onChange({ ...filters, autoJoinOnly: v })}
            />
            <SwitchRow
              label={he.communityFiltersHasRoom}
              value={filters.hasRoom}
              onChange={(v) => onChange({ ...filters, hasRoom: v })}
            />
            <SwitchRow
              label={he.filterNearby}
              caption={nearbyCaption}
              value={filters.nearby}
              onChange={(v) => onChange({ ...filters, nearby: v })}
            />
            {filters.nearby ? (
              <RadiusSelector
                value={filters.nearbyRadiusKm}
                onChange={(km) => onChange({ ...filters, nearbyRadiusKm: km })}
              />
            ) : null}
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
      <Switch
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
    // Sheet now takes the full space SpringSheet allows (90% of
    // screen). minHeight: 70% keeps the body large enough on tall
    // screens so the action row doesn't float just below the title.
    minHeight: '70%',
    maxHeight: '100%',
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
    gap: spacing.md,
  },
  section: { gap: spacing.xs },
  sectionTitle: {
    ...typography.label,
    color: colors.textMuted,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
    width: '100%',
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
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
  pillActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  pillText: { ...typography.body, color: colors.textMuted },
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
