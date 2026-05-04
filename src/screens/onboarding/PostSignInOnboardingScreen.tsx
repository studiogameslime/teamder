// Post-sign-in onboarding — short personalisation step.
// Welcome → How → Profile (name + jersey editor with live preview).

import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Jersey } from '@/components/Jersey';
import { InputField } from '@/components/InputField';
import { JerseyNumberInput } from '@/components/JerseyNumberInput';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { JERSEY_COLORS, JERSEY_PATTERNS, autoJersey } from '@/data/jerseys';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import type { Jersey as JerseyType, JerseyPattern } from '@/types';

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

  // Jersey state — seeded from the user's existing jersey, or from the
  // deterministic auto-jersey based on uid+name when nothing's saved.
  const initialJersey: JerseyType =
    user?.jersey ??
    (user
      ? autoJersey(user.id, user.name || '')
      : { color: JERSEY_COLORS[2].hex, pattern: 'solid', number: 10, displayName: '' });
  const [jersey, setJersey] = useState<JerseyType>(initialJersey);

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
      await complete({
        name: name.trim(),
        jersey: {
          ...jersey,
          displayName: jersey.displayName.trim().slice(0, 10),
        },
      });
    } catch (err) {
      if (__DEV__) console.warn('[onboarding] complete failed', err);
      Alert.alert(he.error, he.signInFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.profileScroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{he.psoProfileTitle}</Text>

        {/* Live jersey preview — sits at top, updates instantly. */}
        <View style={styles.previewWrap}>
          <Jersey
            jersey={jersey}
            user={user ? { id: user.id, name: jersey.displayName.trim() || name.trim() || user.name } : null}
            size={140}
            showName
          />
        </View>

        {/* Name */}
        <InputField
          label={he.profileName}
          value={name}
          onChangeText={setName}
          placeholder={he.profileNamePlaceholder}
          maxLength={40}
          icon="person-outline"
          required
        />

        {/* Optional nickname (printed on the shirt) */}
        <InputField
          label={he.psoProfileNickname}
          value={jersey.displayName}
          onChangeText={(t) =>
            setJersey((j) => ({ ...j, displayName: t.slice(0, 10) }))
          }
          placeholder={he.psoProfileNicknamePlaceholder}
          maxLength={10}
        />

        {/* Jersey number — 2-digit text field replacing the old
            +/- stepper. The shared component owns the visual; we
            only manage parsing here. Empty input is allowed mid-edit
            and clamped to a minimum of 1 on commit so the preview
            never shows "0". */}
        <View style={styles.numberRow}>
          <Text style={styles.label}>{he.psoProfileNumber}</Text>
          <JerseyNumberInput
            value={jersey.number > 0 ? String(jersey.number) : ''}
            onChangeText={(t) => {
              const n = parseInt(t, 10);
              setJersey((j) => ({
                ...j,
                number: Number.isFinite(n) && n >= 1 && n <= 99 ? n : j.number,
              }));
            }}
          />
        </View>

        {/* Color swatches */}
        <View>
          <Text style={styles.label}>{he.psoProfileColor}</Text>
          <View style={styles.swatchRow}>
            {JERSEY_COLORS.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => setJersey((j) => ({ ...j, color: c.hex }))}
                style={[
                  styles.swatch,
                  { backgroundColor: c.hex },
                  jersey.color === c.hex && styles.swatchActive,
                ]}
              >
                {jersey.color === c.hex ? (
                  <Ionicons
                    name="checkmark"
                    size={18}
                    color={c.hex === '#F8FAFC' ? colors.text : '#fff'}
                  />
                ) : null}
              </Pressable>
            ))}
          </View>
        </View>

        {/* Pattern pills */}
        <View>
          <Text style={styles.label}>{he.psoProfilePattern}</Text>
          <View style={styles.patternRow}>
            {JERSEY_PATTERNS.map((p) => (
              <Pressable
                key={p.id}
                onPress={() =>
                  setJersey((j) => ({ ...j, pattern: p.id as JerseyPattern }))
                }
                style={[
                  styles.patternPill,
                  jersey.pattern === p.id && styles.patternPillActive,
                ]}
              >
                <Text
                  style={[
                    styles.patternText,
                    jersey.pattern === p.id && styles.patternTextActive,
                  ]}
                >
                  {p.nameHe}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {user?.email ? <Text style={styles.email}>{user.email}</Text> : null}
      </ScrollView>
      <View style={styles.profileCta}>
        <Button
          title={he.psoProfileSave}
          variant="primary"
          size="lg"
          fullWidth
          disabled={!canSave}
          loading={busy}
          onPress={handleSave}
        />
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
  title: {
    ...typography.h1,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 24,
  },
  cards: { gap: spacing.md, alignSelf: 'stretch', marginTop: spacing.lg },
  howCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
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
    ...typography.bodyBold,
    color: colors.text,
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },

  // Profile step
  profileScroll: {
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  previewWrap: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  label: {
    ...typography.label,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    marginBottom: spacing.xs,
  },
  numberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    gap: spacing.md,
  },
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.border,
  },
  swatchActive: {
    borderColor: colors.text,
    transform: [{ scale: 1.1 }],
  },
  patternRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  patternPill: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  patternPillActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  patternText: { ...typography.body, color: colors.textMuted },
  patternTextActive: { color: colors.primary, fontWeight: '700' },
  email: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  profileCta: {
    paddingTop: spacing.sm,
  },
});
