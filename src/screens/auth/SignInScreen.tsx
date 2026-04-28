import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';

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
          <Ionicons name="football-outline" size={72} color={colors.primary} />
        </View>
        <Text style={styles.title}>{he.signInTitle}</Text>
        <Text style={styles.subtitle}>{he.signInSubtitle}</Text>
      </View>

      <View style={styles.bottom}>
        <Button
          title={he.signInGoogle}
          iconLeft="logo-google"
          variant="outline"
          size="lg"
          fullWidth
          loading={busy}
          onPress={handlePress}
        />
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
    backgroundColor: colors.primaryLight,
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
  privacy: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
});
