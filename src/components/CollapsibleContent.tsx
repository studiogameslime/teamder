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
  // The WHOLE block toggles, not the eight-point link alone (owner, 28.09 for
  // opening and 29.09 for closing). The text is what a thumb lands on; the link
  // under it used to be the only part that answered in EITHER direction, so
  // first tapping the paragraph did nothing, and then — once that was fixed for
  // opening only — tapping it again to close did nothing either.
  //
  // It toggles only while the content actually overflows. `Pressable` with no
  // press handler is still a plain view, so a block short enough to fit has
  // nothing to toggle and intercepts no touch.
  const clamped = !expanded && overflows;
  return (
    <View>
      <Pressable
        onPress={overflows ? () => setExpanded((v) => !v) : undefined}
        accessibilityRole={overflows ? 'button' : undefined}
        accessibilityLabel={
          overflows
            ? expanded
              ? he.communityReadLess
              : he.communityReadMore
            : undefined
        }
        style={
          clamped ? { maxHeight: collapsedHeight, overflow: 'hidden' } : undefined
        }
      >
        <View
          onLayout={(e) => {
            // Read the height SYNCHRONOUSLY here — reading e.nativeEvent inside
            // the functional setState updater crashed ("Cannot read property
            // 'layout' of null") because the event is recycled before the
            // deferred updater runs. Capture the number, then use it.
            const h = e.nativeEvent?.layout?.height ?? 0;
            setFullHeight((prev) => Math.max(prev, h));
          }}
        >
          {children}
        </View>
      </Pressable>
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
