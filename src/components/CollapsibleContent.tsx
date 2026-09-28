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
  // The WHOLE clamped block opens it, not the eight-point "קרא עוד" alone
  // (owner, 28.09). The text is the thing a thumb lands on; the link under it
  // was the only part that answered, so tapping the paragraph you are trying
  // to read did nothing. Only while it is clamped: once open, the text is
  // selectable content again and must not collapse under an accidental tap.
  //
  // `Pressable` with no press handler is still a view, so when the content
  // fits there is nothing to open and nothing intercepts the touch.
  const clamped = !expanded && overflows;
  return (
    <View>
      <Pressable
        onPress={clamped ? () => setExpanded(true) : undefined}
        accessibilityRole={clamped ? 'button' : undefined}
        accessibilityLabel={clamped ? he.communityReadMore : undefined}
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
