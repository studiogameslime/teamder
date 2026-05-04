// CommunityHeader — compact identity band for the redesigned
// CommunityDetailsScreen. Replaces the old hero + meta block that
// took ~40% of the screen height.
//
// Visual: subtle green tint with rounded bottom corners. Title is
// large + bold + right-aligned; location sits muted underneath. The
// hamburger button floats at the top-leading edge (top-right under
// forceRTL) — replaces the old pencil-edit affordance which has
// moved into the menu.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  name: string;
  /** Free-text "city · field address" line. Optional. */
  location?: string;
  /** Renders the מאמן badge under the title. */
  isAdmin: boolean;
  onMenuPress: () => void;
}

export function CommunityHeader({
  name,
  location,
  isAdmin,
  onMenuPress,
}: Props) {
  return (
    <View style={styles.wrap}>
      <LinearGradient
        colors={['#16A34A', '#15803D', '#0F5F2C']}
        style={StyleSheet.absoluteFill}
      />
      <Pressable
        onPress={onMenuPress}
        hitSlop={10}
        style={({ pressed }) => [
          styles.menuButton,
          pressed && { opacity: 0.7 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={he.profileMenuOpen}
      >
        <Ionicons name="menu" size={24} color="#FFFFFF" />
      </Pressable>
      <View style={styles.content}>
        <Text style={styles.name} numberOfLines={2}>
          {name}
        </Text>
        {location ? (
          <View style={styles.locationRow}>
            <Ionicons
              name="location-outline"
              size={14}
              color="rgba(255,255,255,0.85)"
            />
            <Text style={styles.location} numberOfLines={1}>
              {location}
            </Text>
          </View>
        ) : null}
        {isAdmin ? (
          <View style={styles.badge}>
            <Ionicons name="star" size={12} color="#FACC15" />
            <Text style={styles.badgeText}>{he.profileBadgeAdmin}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  menuButton: {
    position: 'absolute',
    top: 0,
    start: spacing.md,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    marginTop: spacing.xl,
    zIndex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl + spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.xs,
    alignItems: 'flex-end',
  },
  name: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
    width: '100%',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  location: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    marginTop: spacing.xs,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  // reserved for if we ever want to align differently in LTR
  _bg: { backgroundColor: colors.primary },
});
