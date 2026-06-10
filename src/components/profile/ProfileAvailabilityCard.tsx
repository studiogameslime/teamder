// ProfileAvailabilityCard — "זמינות למשחקים" summary on the user's own
// profile. Surfaces the availability the user already set (preferred
// days + travel radius + home city) as a read-only glance; tapping the
// card opens the AvailabilityEdit screen.
//
// When the user's home city has geocoded coords we render a small
// circular MapLibre map between the two columns (matching the mockup's
// centre map); otherwise the columns sit either side of a hairline
// divider.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { UserAvailability } from '@/types';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { PressableScale } from '@/components/PressableScale';
import { ProfileLocationMap } from '@/components/profile/ProfileLocationMap';

const ACCENT = '#3B82F6';
const DEFAULT_RADIUS_KM = 20;

interface Props {
  availability?: UserAvailability;
  onEdit: () => void;
}

export function ProfileAvailabilityCard({ availability, onEdit }: Props) {
  const days = availability?.preferredDays ?? [];
  const hasAny = days.length > 0 || !!availability?.homeCity;
  const lat = availability?.homeCityLat;
  const lng = availability?.homeCityLng;
  const hasCoords = typeof lat === 'number' && typeof lng === 'number';

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Ionicons name="time-outline" size={18} color={colors.text} />
        <Text style={styles.title}>{he.profileAvailabilityTitle}</Text>
      </View>

      {hasAny ? (
        <PressableScale
          onPress={onEdit}
          style={styles.card}
          accessibilityRole="button"
          accessibilityLabel={he.profileAvailabilityTitle}
        >
          {/* Inner row owns the two-column layout — PressableScale wraps
              its children in a single Animated.View, so a flexDirection
              on the card itself would only lay out that one wrapper.
              `row` flips under forceRTL → radius column (first) on the
              visual RIGHT, days column on the LEFT (mockup order). */}
          <View style={styles.row}>
            <View style={styles.column}>
              <Text style={styles.colLabel}>
                {he.profileAvailabilityRadiusLabel}
              </Text>
              <Text style={styles.colValue}>
                {he.profileAvailabilityRadiusValue(
                  availability?.availabilityRadiusKm ?? DEFAULT_RADIUS_KM,
                )}
              </Text>
              {availability?.homeCity ? (
                <View style={styles.cityRow}>
                  <Text style={styles.cityText} numberOfLines={1}>
                    {availability.homeCity}
                  </Text>
                  <Ionicons name="location" size={12} color={ACCENT} />
                </View>
              ) : null}
            </View>

            {hasCoords ? (
              <ProfileLocationMap lat={lat} lng={lng} size={96} />
            ) : (
              <View style={styles.divider} />
            )}

            <View style={styles.column}>
              <Text style={styles.colLabel}>
                {he.profileAvailabilityDaysLabel}
              </Text>
              {days.length > 0 ? (
                <View style={styles.daysRow}>
                  {[...days]
                    .sort((a, b) => a - b)
                    .map((d) => (
                      <View key={d} style={styles.dayBadge}>
                        <Text style={styles.dayBadgeText}>
                          {he.availabilityDayLetter[d]}
                        </Text>
                      </View>
                    ))}
                </View>
              ) : (
                <Text style={styles.colValueMuted}>
                  {he.profileAvailabilityNoDays}
                </Text>
              )}
            </View>
          </View>
        </PressableScale>
      ) : (
        <PressableScale
          onPress={onEdit}
          style={styles.emptyCard}
          accessibilityRole="button"
          accessibilityLabel={he.profileAvailabilityEmptyCta}
        >
          {/* Inner wrapper owns the centered layout (see note above on
              PressableScale's single Animated.View child). */}
          <View style={styles.emptyContent}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="calendar-outline" size={22} color={ACCENT} />
            </View>
            <Text style={styles.emptyBody}>
              {he.profileAvailabilityEmptyBody}
            </Text>
            <View style={styles.emptyCta}>
              <Text style={styles.emptyCtaText}>
                {he.profileAvailabilityEmptyCta}
              </Text>
              <Ionicons name="chevron-back" size={16} color={ACCENT} />
            </View>
          </View>
        </PressableScale>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
    paddingHorizontal: spacing.xs,
  },
  title: {
    ...typography.body,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  column: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  colLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  colValue: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  colValueMuted: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  daysRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  dayBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayBadgeText: {
    color: '#1D4ED8',
    fontSize: 12,
    fontWeight: '800',
  },
  cityRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 3,
    maxWidth: '100%',
  },
  cityText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    textAlign: RTL_LABEL_ALIGN,
    flexShrink: 1,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: colors.divider,
    marginVertical: spacing.xs,
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  emptyContent: {
    alignItems: 'center',
    gap: 8,
  },
  emptyIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyBody: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  emptyCta: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
  },
  emptyCtaText: {
    color: ACCENT,
    fontSize: 14,
    fontWeight: '800',
  },
});
