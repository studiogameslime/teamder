// MatchEmptyHintCard — bottom card on the matches list inviting the
// user to create a new game when nothing in the visible list catches
// their eye.
//
//   ┌──────────────────────────────────────────────────────┐
//   │  [field illustration]   לא מצאת משחק שמתאים?         │
//   │                          צור משחק חדש ותן לאחרים     │
//   │                          להצטרף                       │
//   └──────────────────────────────────────────────────────┘
//
// Tap → onPress (the screen wires it to the create-game flow).

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  onPress: () => void;
}

const ACCENT = '#3B82F6';

export function MatchEmptyHintCard({ onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        pressed && { opacity: 0.94 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={he.matchesEmptyCardTitle}
    >
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {he.matchesEmptyCardTitle}
        </Text>
        <Text style={styles.sub} numberOfLines={2}>
          {he.matchesEmptyCardSub}
        </Text>
      </View>
      <View style={styles.illustration}>
        <Ionicons name="football-outline" size={28} color={ACCENT} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderWidth: 1.5,
    borderColor: '#DBEAFE',
    borderStyle: 'dashed',
  },
  text: {
    flex: 1,
    gap: 4,
  },
  title: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  sub: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '500',
    textAlign: RTL_LABEL_ALIGN,
  },
  // Decorative football "illustration" — the spec calls for a field
  // illustration but the asset isn't shipped, so we use the football
  // glyph in a soft-tinted disc as a stand-in.
  illustration: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(59,130,246,0.10)',
  },
});
