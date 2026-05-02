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
import { GroupPublic, WeekdayIndex } from '@/types';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

const ALL_DAYS: WeekdayIndex[] = [0, 1, 2, 3, 4, 5, 6];

export interface GroupFilters {
  /** Hide groups that hit their maxMembers cap. */
  hasRoom: boolean;
  /** Show only auto-join (`isOpen === true`) groups. */
  autoJoinOnly: boolean;
  /** Hide groups with `costPerGame > 0`. */
  freeOnly: boolean;
  /** Subset of the week the group plays on; empty = no day filter. */
  preferredDays: WeekdayIndex[];
  /** Match group's `city` against the viewer's `city` — caller resolves. */
  nearby: boolean;
}

export const EMPTY_GROUP_FILTERS: GroupFilters = {
  hasRoom: false,
  autoJoinOnly: false,
  freeOnly: false,
  preferredDays: [],
  nearby: false,
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
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
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
            <SwitchRow
              label={he.communityFiltersOnlyOpen}
              value={filters.autoJoinOnly}
              onChange={(v) => onChange({ ...filters, autoJoinOnly: v })}
            />
            <SwitchRow
              label={he.gameFiltersOnlyAvailable}
              value={filters.hasRoom}
              onChange={(v) => onChange({ ...filters, hasRoom: v })}
            />
            <SwitchRow
              label={he.communityFiltersFreeOnly}
              value={filters.freeOnly}
              onChange={(v) => onChange({ ...filters, freeOnly: v })}
            />
            <SwitchRow
              label={he.filterNearby}
              caption={nearbyCaption}
              value={filters.nearby}
              onChange={(v) => onChange({ ...filters, nearby: v })}
            />

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                {he.createGroupPreferredDays}
              </Text>
              <View style={styles.pillRow}>
                {ALL_DAYS.map((d) => {
                  const active = filters.preferredDays.includes(d);
                  return (
                    <Pressable
                      key={d}
                      onPress={() => toggleDay(d)}
                      style={({ pressed }) => [
                        styles.dayPill,
                        active && styles.pillActive,
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.pillText,
                          active && {
                            color: colors.primary,
                            fontWeight: '700',
                          },
                        ]}
                      >
                        {he.availabilityDayShort[d]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
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
      </Pressable>
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
    <View style={styles.switchRow}>
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
    </View>
  );
}

// ─── Filter application ─────────────────────────────────────────────────

interface ApplyContext {
  /** Resolved viewer city for the "nearby" toggle. Pass undefined when
   *  the toggle is off or the city is still resolving — those rows are
   *  treated as "doesn't match" so the list stays predictable. */
  nearbyCity?: string;
}

/** Pure filter application — used by PublicGroupsFeedScreen. */
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
      if (!ctx.nearbyCity) return false;
      if (
        !g.city ||
        g.city.trim().toLowerCase() !== ctx.nearbyCity.trim().toLowerCase()
      ) {
        return false;
      }
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
    // Fixed height (not maxHeight) — without an explicit height the
    // body's ScrollView `flex:1` collapses to 0 because there's no
    // defined parent height for it to share.
    height: '85%',
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
