// ScreenContainer — the standard scrollable screen frame.
//
// Wraps every "regular" screen with:
//   • SafeAreaView (top/bottom insets honoured)
//   • optional ScreenHeader at the top
//   • ScrollView body with consistent 16-20px horizontal padding
//   • bottom padding so the last card never touches the home indicator
//
// Pass `noScroll` for screens that need to manage their own layout
// (e.g., LiveMatch's full-screen pitch). Pass `padded={false}` to skip
// the body's horizontal padding (useful when a child already provides
// its own).

import React from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from './ScreenHeader';
import { colors, spacing } from '@/theme';

interface Props {
  children: React.ReactNode;
  /** Optional title — when set, a ScreenHeader is rendered at the top. */
  title?: string;
  /** Hides the back chevron on the header. */
  hideBack?: boolean;
  /** When true, renders a plain View instead of a ScrollView. */
  noScroll?: boolean;
  /** When false, drops the standard horizontal padding on the body. */
  padded?: boolean;
  contentStyle?: ViewStyle;
  /**
   * Sticky bottom area rendered OUTSIDE the scrollable body. Use this
   * for primary CTAs ("שמור", "שלח") that must stay visible no matter
   * how far the user has scrolled. Without this, a tall form pushes
   * the save button below the fold and users hit "back" thinking
   * they saved.
   */
  footer?: React.ReactNode;
}

export function ScreenContainer({
  children,
  title,
  hideBack,
  noScroll,
  padded = true,
  contentStyle,
  footer,
}: Props) {
  const bodyPad = padded ? styles.bodyPadded : null;

  const body = noScroll ? (
    <View style={[styles.body, bodyPad, contentStyle]}>{children}</View>
  ) : (
    <ScrollView
      contentContainerStyle={[styles.scroll, bodyPad, contentStyle]}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      {title !== undefined ? (
        <ScreenHeader title={title} showBack={!hideBack} />
      ) : null}
      {body}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  body: {
    flex: 1,
  },
  bodyPadded: {
    paddingHorizontal: spacing.lg,
  },
  scroll: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(15,23,42,0.08)',
    // Elevation/shadow so the footer reads as floating over the scroll
    // content even when there's a hairline above it.
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 6,
  },
});
