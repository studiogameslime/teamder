import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { logError } from '@/services/errorLog';

// Brand-blue palette — same tones as the redesigned onboarding /
// hero blocks. Hardcoded here (not via colors.primary, which is
// still the legacy green) so this surface matches the rest of the
// blue-redesigned app without ripple-changing the theme token.
const ACCENT = '#1E40AF';
const ACCENT_SOFT = '#DBEAFE';

export function SignInScreen() {
  const signIn = useUserStore((s) => s.signInWithGoogle);
  const signInApple = useUserStore((s) => s.signInWithApple);
  const [busy, setBusy] = useState(false);

  const handlePress = async () => {
    setBusy(true);
    try {
      await signIn();
    } catch (err) {
      const e = err as { message?: string; code?: string };
      const code = (e?.code ?? '').toString().toLowerCase();
      const msg = (e?.message ?? '').toLowerCase();
      const cancelled =
        msg.includes('cancel') || code.includes('cancel') || code === '12501';
      // Transient/recoverable failures (Play Services hiccup, network, an
      // INTERNAL_ERROR, or a concurrent attempt). The user just retries —
      // these are NOT config bugs, so don't pollute the error panel. Only a
      // genuine misconfiguration (DEVELOPER_ERROR / SHA mismatch) is logged.
      const transient =
        code === '8' || code.includes('internal') || msg.includes('internal') ||
        code === '7' || code.includes('network') || msg.includes('network') ||
        code === '12500' || code === '12502' || code.includes('play_services') ||
        code.includes('in_progress') || msg.includes('in progress');
      if (!cancelled && !transient) {
        logError('signInGoogleScreen', err, {
          screen: 'SignInScreen',
          provider: 'google',
          code: e?.code,
        });
      }
      // Map known errors to friendly Hebrew. Log raw error to console.
      if (__DEV__) console.warn('[signIn] failed', err);
      Alert.alert(he.error, friendlySignInError(err));
    } finally {
      setBusy(false);
    }
  };

  // Sign in with Apple — required by App Store Guideline 4.8 alongside
  // Google. iOS-only; the native button is hidden on Android.
  const handleApple = async () => {
    setBusy(true);
    try {
      await signInApple();
    } catch (err) {
      if (__DEV__) console.warn('[signIn] apple failed', err);
      const e = err as { message?: string; code?: string };
      const cancelled =
        (e?.message ?? '').includes('cancelled') ||
        (e?.code ?? '').includes('CANCEL');
      if (!cancelled) {
        logError('signInAppleScreen', err, {
          screen: 'SignInScreen',
          provider: 'apple',
          code: e?.code,
        });
        Alert.alert(he.error, friendlySignInError(err));
      }
    } finally {
      setBusy(false);
    }
  };

  // Pure function so it can be unit-tested without rendering.
  function friendlySignInError(err: unknown): string {
    const e = err as { message?: string; code?: string };
    const msg = e?.message ?? '';
    const code = e?.code ?? '';
    if (msg.includes('cancelled') || code.includes('cancelled')) return he.signInCancelled;
    if (msg.includes('OAuth client ID not configured')) return he.signInConfigMissing;
    if (code === 'auth/network-request-failed' || msg.includes('network')) return he.signInNetworkError;
    return he.signInFailed;
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <Ionicons name="football-outline" size={72} color={ACCENT} />
        </View>
        <Text style={styles.title}>{he.signInTitle}</Text>
        <Text style={styles.subtitle}>{he.signInSubtitle}</Text>
      </View>

      <View style={styles.bottom}>
        {/* Custom Pressable instead of <Button variant="outline" /> —
            the Button component bakes in the legacy green palette,
            and we want the CTA to match the blue brand language used
            on the onboarding slides + tab heroes. */}
        <Pressable
          onPress={handlePress}
          disabled={busy}
          style={({ pressed }) => [
            styles.ctaBtn,
            pressed && { opacity: 0.92 },
            busy && { opacity: 0.6 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={he.signInGoogle}
        >
          {busy ? (
            <ActivityIndicator color={ACCENT} />
          ) : (
            <>
              <Ionicons name="logo-google" size={20} color={ACCENT} />
              <Text style={styles.ctaText}>{he.signInGoogle}</Text>
            </>
          )}
        </Pressable>
        {/* Custom Apple button mirroring the Google one for visual
            parity (same height, font, palette). Apple permits a custom
            button as long as it carries the Apple logo + an approved
            "Continue with Apple" title — which `signInApple` is. */}
        {Platform.OS === 'ios' && (
          <Pressable
            onPress={handleApple}
            disabled={busy}
            style={({ pressed }) => [
              styles.ctaBtn,
              pressed && { opacity: 0.92 },
              busy && { opacity: 0.6 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={he.signInApple}
          >
            <Ionicons name="logo-apple" size={20} color={ACCENT} />
            <Text style={styles.ctaText}>{he.signInApple}</Text>
          </Pressable>
        )}
        <Text style={styles.privacy}>{he.signInPrivacy}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  iconCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: ACCENT_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  title: { ...typography.h1, color: colors.text, textAlign: 'center' },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  bottom: { paddingBottom: spacing.lg, gap: spacing.md },
  ctaBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    borderWidth: 2,
    borderColor: ACCENT,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  ctaText: {
    color: ACCENT,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  // Privacy footer now uses a slightly darker grey (slate-500) to
  // hit a comfortable contrast ratio on the white sign-in card; the
  // muted-text token (#94A3B8) was too light against the bg under
  // outdoor lighting and failed WCAG AA against white.
  privacy: { ...typography.caption, color: '#5A6478', textAlign: 'center' },
});
