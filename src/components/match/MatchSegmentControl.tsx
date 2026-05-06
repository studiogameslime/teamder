// MatchSegmentControl — pill segmented control for the redesigned
// matches screen. Two tabs: פתוחים (active by default) / שלי. Active
// tab gets a deep-blue background + white text + a small badge with
// the count. Inactive tab is light-grey with muted text.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  badge?: number;
}

interface Props<T extends string> {
  value: T;
  onChange: (next: T) => void;
  options: Array<SegmentOption<T>>;
}

export function MatchSegmentControl<T extends string>({
  value,
  onChange,
  options,
}: Props<T>) {
  return (
    <View style={styles.wrap}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={({ pressed }) => [
              styles.tab,
              active && styles.tabActive,
              pressed && { opacity: 0.92 },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={opt.label}
          >
            <Text
              style={[styles.label, active && styles.labelActive]}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
            {opt.badge !== undefined && opt.badge > 0 ? (
              <View
                style={[styles.badge, active && styles.badgeActive]}
              >
                <Text
                  style={[
                    styles.badgeText,
                    active && styles.badgeTextActive,
                  ]}
                >
                  {opt.badge}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const ACCENT = '#1E40AF';

const styles = StyleSheet.create({
  // Outer pill — soft grey background, holds both tabs.
  wrap: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    padding: 5,
    gap: 4,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.10,
    shadowRadius: 14,
    elevation: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 999,
  },
  tabActive: {
    backgroundColor: ACCENT,
  },
  label: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '700',
  },
  labelActive: {
    color: '#FFFFFF',
  },
  // Count chip — sits to the side of the label inside each tab.
  badge: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeActive: {
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  badgeText: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '800',
  },
  badgeTextActive: {
    color: '#FFFFFF',
  },
});
