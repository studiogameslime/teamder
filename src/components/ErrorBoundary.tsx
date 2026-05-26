// ErrorBoundary — catches uncaught render-time exceptions in any React
// subtree and shows a Hebrew RTL fallback UI instead of leaving the app
// frozen on a white screen (production) or a Metro red box (dev).
//
// Why we need this:
//   • React's default behaviour for an uncaught component error is to
//     unmount the entire component tree. Without a boundary at the root
//     the app appears dead and the user can only force-quit.
//   • Production logs are minimal until Crashlytics/Sentry is wired up
//     (Audit Finding #12). This component is the single hook where
//     remote logging will be plugged in — the `onError` prop accepts a
//     reporter, and the default falls back to `console.error` in DEV
//     and a no-op in production.
//
// What it deliberately does NOT do:
//   • Try to recover automatically: an auto-retry on the same boundary
//     is the textbook crash-loop. Recovery is user-driven via the
//     "נסה שוב" button (resets boundary state) or the OS "swipe-to-kill"
//     gesture (full app restart).
//   • Touch React Navigation. The boundary wraps the navigator from
//     the OUTSIDE so a navigator-internal crash still ends up here,
//     and `navigationRef` is intentionally not consulted (it may be
//     in an undefined state during the crash).

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  children: React.ReactNode;
  /**
   * Optional reporter — invoked once per caught error with the error
   * and the React-provided component stack. Plug a Crashlytics /
   * Sentry call here when remote crash reporting is enabled. If
   * omitted, the default reporter logs to console in DEV only.
   */
  onError?: (error: Error, info: { componentStack: string }) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  // Static lifecycle: derive new state from the error. Returning
  // hasError:true tells React to render the fallback on next paint.
  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }): void {
    // Default reporter: log in DEV so the developer sees the stack;
    // stay silent in production to avoid noise. The caller can pass
    // its own reporter to forward to Crashlytics/Sentry.
    if (this.props.onError) {
      try {
        this.props.onError(error, info);
      } catch {
        // A faulty reporter must never re-crash the boundary itself.
      }
    } else if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error('[ErrorBoundary] uncaught error', error, info?.componentStack);
    }
  }

  // User-driven retry. Clearing state lets the children mount again.
  // If the underlying bug is deterministic the boundary will catch it
  // on the next render — the user can then dismiss again, but we
  // never auto-retry to avoid a spin loop.
  private handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <View style={styles.root} accessibilityRole="alert">
        <View style={styles.iconWrap}>
          <Ionicons name="alert-circle-outline" size={56} color={colors.danger} />
        </View>
        <Text style={styles.title}>{he.errorBoundaryTitle}</Text>
        <Text style={styles.body}>{he.errorBoundaryBody}</Text>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            pressed && { opacity: 0.85 },
          ]}
          onPress={this.handleReset}
          accessibilityRole="button"
          accessibilityLabel={he.errorBoundaryReload}
        >
          <Text style={styles.buttonText}>{he.errorBoundaryReload}</Text>
        </Pressable>
        <Text style={styles.hint}>{he.errorBoundaryReportHint}</Text>
        {/* In DEV, surface the actual error message under the body so the
            developer doesn't need to read the Metro console. Stripped from
            release via the __DEV__ guard. */}
        {__DEV__ && this.state.error ? (
          <Text style={styles.devError} selectable>
            {String(this.state.error?.message ?? this.state.error)}
          </Text>
        ) : null}
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.h1,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  body: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.xl,
    maxWidth: 360,
    lineHeight: 22,
  },
  button: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
    minWidth: 200,
    alignItems: 'center',
  },
  buttonText: {
    color: colors.textOnPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.lg,
    maxWidth: 320,
  },
  devError: {
    fontFamily: 'Courier',
    fontSize: 12,
    color: colors.danger,
    textAlign: 'center',
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
});
