// CollapsibleContent — clamps long content to `collapsedHeight` and shows a
// "קרא עוד / הצג פחות" toggle ONLY when the content actually overflows. Used by
// the community description + rules cards (CommunityDetails) and the same rules
// card on MatchDetails, so a long rules block never fills the whole screen.
// Height is measured with Math.max so the clamp can't shrink the measurement
// and cause a toggle flicker loop.

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';

export function CollapsibleContent({
  children,
  collapsedHeight = 160,
}: {
  children: React.ReactNode;
  collapsedHeight?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [fullHeight, setFullHeight] = useState(0);
  const overflows = fullHeight > collapsedHeight + 12;
  return (
    <View>
      <View
        style={
          !expanded && overflows
            ? { maxHeight: collapsedHeight, overflow: 'hidden' }
            : undefined
        }
      >
        <View
          onLayout={(e) =>
            setFullHeight((prev) => Math.max(prev, e.nativeEvent.layout.height))
          }
        >
          {children}
        </View>
      </View>
      {overflows ? (
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          hitSlop={8}
          style={styles.toggle}
          accessibilityRole="button"
        >
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.primary}
          />
          <Text style={styles.toggleText}>
            {expanded ? he.communityReadLess : he.communityReadMore}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 4,
    paddingTop: spacing.xs,
  },
  toggleText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '800',
  },
});
