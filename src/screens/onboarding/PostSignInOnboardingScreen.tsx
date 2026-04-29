// Post-sign-in onboarding flow.
//
// Three steps in one component (welcome → how it works → profile confirm).
// They share the in-progress display name so editing on step 3 starts from
// the Google value the user just authenticated with — and the only thing
// that needs to be persisted at the end is the (possibly edited) name +
// the onboardingCompleted flag.
//
// RootNavigator gates this whole screen on `!user.onboardingCompleted`, so
// finishing here flips that flag in /users/{uid} and the navigator falls
// through to the existing GroupChooseScreen.

import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PlayerIdentity } from '@/components/PlayerIdentity';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';

type Step = 'welcome' | 'how' | 'profile';

interface HowCard {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
}

const HOW_CARDS: HowCard[] = [
  { icon: 'people-circle-outline', title: he.psoHow1 },
  { icon: 'list-outline', title: he.psoHow2 },
  { icon: 'football-outline', title: he.psoHow3 },
];

export function PostSignInOnboardingScreen() {
  const user = useUserStore((s) => s.currentUser);
  const complete = useUserStore((s) => s.completePostSignInOnboarding);

  const [step, setStep] = useState<Step>('welcome');
  const [name, setName] = useState(user?.name ?? '');
  const [busy, setBusy] = useState(false);

  if (step === 'welcome') {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.content}>
          <View style={styles.iconCircle}>
            <Ionicons name="football-outline" size={72} color={colors.primary} />
          </View>
          <Text style={styles.title}>{he.psoWelcomeTitle}</Text>
          <Text style={styles.subtitle}>{he.psoWelcomeBody}</Text>
        </View>
        <Button
          title={he.psoWelcomeCta}
          variant="primary"
          size="lg"
          fullWidth
          onPress={() => setStep('how')}
        />
      </SafeAreaView>
    );
  }

  if (step === 'how') {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.content}>
          <Text style={styles.title}>{he.psoHowTitle}</Text>
          <View style={styles.cards}>
            {HOW_CARDS.map((c) => (
              <Card key={c.title} style={styles.howCard}>
                <View style={styles.howIcon}>
                  <Ionicons name={c.icon} size={28} color={colors.primary} />
                </View>
                <Text style={styles.howTitle}>{c.title}</Text>
              </Card>
            ))}
          </View>
        </View>
        <Button
          title={he.psoHowCta}
          variant="primary"
          size="lg"
          fullWidth
          onPress={() => setStep('profile')}
        />
      </SafeAreaView>
    );
  }

  // step === 'profile'
  const canSave = name.trim().length > 0 && !busy;
  const handleSave = async () => {
    setBusy(true);
    try {
      await complete({ name: name.trim() });
    } catch (err) {
      if (__DEV__) console.warn('[onboarding] completePostSignInOnboarding failed', err);
      Alert.alert(he.error, he.signInFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <Text style={styles.title}>{he.psoProfileTitle}</Text>
        <View style={{ marginVertical: spacing.lg }}>
          <PlayerIdentity
            user={user ? { ...user, name: name.trim() || user.name } : null}
            size="xl"
          />
        </View>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={he.profileNamePlaceholder}
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          textAlign="right"
          maxLength={40}
        />
        {user?.email ? <Text style={styles.email}>{user.email}</Text> : null}
      </View>
      <Button
        title={he.psoProfileSave}
        variant="primary"
        size="lg"
        fullWidth
        disabled={!canSave}
        loading={busy}
        onPress={handleSave}
      />
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
  cards: {
    width: '100%',
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  howCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  howIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  howTitle: {
    ...typography.h3,
    color: colors.text,
    flex: 1,
    textAlign: 'right',
  },
  input: {
    ...typography.h3,
    color: colors.text,
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  email: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  pickerWrap: {
    width: '100%',
    flexShrink: 1,
    marginTop: spacing.md,
  },
});
