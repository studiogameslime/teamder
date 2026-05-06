import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

// Brand-blue palette — same tones as the redesigned onboarding /
// hero blocks. Hardcoded here (not via colors.primary, which is
// still the legacy green) so this surface matches the rest of the
// blue-redesigned app without ripple-changing the theme token.
const ACCENT = '#1E40AF';
const ACCENT_SOFT = '#DBEAFE';

export function SignInScreen() {
  const signIn = useUserStore((s) => s.signInWithGoogle);
  const [busy, setBusy] = useState(false);

  const handlePress = async () => {
    setBusy(true);
    try {
      await signIn();
    } catch (err) {
      // Map known errors to friendly Hebrew. Log raw error to console.
      if (__DEV__) console.warn('[signIn] failed', err);
      Alert.alert(he.error, friendlySignInError(err));
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
  privacy: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
});
