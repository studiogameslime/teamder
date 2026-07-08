// FormSectionHeader — bold RTL section title with a hairline rule beside it.
// Groups related fields into labeled sections in the create-game and
// create-community wizards (the "מאפייני משחק" / "זמינות משחק" design).

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';

/** `first` removes the top margin so the opening header sits flush at the top
 *  of a step instead of pushing the content down. */
export function FormSectionHeader({
  title,
  first,
}: {
  title: string;
  first?: boolean;
}) {
  return (
    <View style={[styles.row, first && styles.first]}>
      {/* Title first → forceRTL flips `row` so it lands on the visual RIGHT,
          with the rule filling the space to its left. */}
      <Text style={styles.text}>{title}</Text>
      <View style={styles.line} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  first: { marginTop: 0 },
  text: {
    ...typography.body,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  line: {
    flex: 1,
    height: 1,
    // A hair darker than `border` (gray-200) but well short of `textMuted`
    // (gray-500) — a thin, quiet rule that reads without dominating the title.
    backgroundColor: '#D1D5DB',
  },
});
