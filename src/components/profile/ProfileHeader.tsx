// ProfileHeader — compact identity band at the top of the redesigned
// player card. Replaces the old full-bleed hero that took ~50% of the
// screen.
//
// Visual: green gradient with rounded bottom corners; jersey + name
// only. The role badge + community name were intentionally removed
// per design — both repeat info already implied by the screen
// context (you're on YOUR profile in YOUR active community).

import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Jersey as JerseyView } from '@/components/Jersey';
import type { Jersey, JerseyPattern } from '@/types';
import { spacing } from '@/theme';

interface Props {
  jersey: Jersey;
  name: string;
  /** Optional override for the outer container style. */
  style?: ViewStyle;
}

export function ProfileHeader({ jersey, name, style }: Props) {
  return (
    <View style={[styles.wrap, style]}>
      <LinearGradient
        colors={['#16A34A', '#15803D', '#0F5F2C']}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.content}>
        <View style={styles.jerseyWrap}>
          <JerseyView
            jersey={{
              color: jersey.color,
              pattern: jersey.pattern as JerseyPattern,
              number: jersey.number,
              displayName: jersey.displayName,
            }}
            size={92}
          />
        </View>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    // Mild shadow lifts the band off the page bg without competing
    // with the cards below.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  content: {
    alignItems: 'center',
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  jerseyWrap: {
    marginBottom: spacing.xs,
  },
  name: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
});
