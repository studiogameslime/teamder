// Post-sign-in onboarding — single profile-customisation step.
// The previous flow had three intermediate screens (welcome → how
// → profile) but the user already saw the value pitch on the
// pre-sign-in slides; repeating it here just adds taps before the
// app actually starts working. Now it's one screen: jersey preview
// at the top, name + customisation below, save → main app.

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
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Jersey } from '@/components/Jersey';
import { InputField } from '@/components/InputField';
import { JerseyNumberInput } from '@/components/JerseyNumberInput';
import { Card } from '@/components/Card';
import { JERSEY_COLORS, JERSEY_PATTERNS, autoJersey } from '@/data/jerseys';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import type { Jersey as JerseyType, JerseyPattern } from '@/types';

// Same blue palette as the pre-sign-in slides + heroes elsewhere.
const HERO_GRADIENT = ['#1E3A8A', '#1E40AF', '#3B82F6'] as const;
const ACCENT = '#1E40AF';
const ACCENT_SOFT = '#DBEAFE';

export function PostSignInOnboardingScreen() {
  const user = useUserStore((s) => s.currentUser);
  const complete = useUserStore((s) => s.completePostSignInOnboarding);

  const [name, setName] = useState(user?.name ?? '');
  const [busy, setBusy] = useState(false);

  // Jersey state — seeded from the user's existing jersey, or from a
  // deterministic auto-jersey based on uid+name when nothing's saved.
  const initialJersey: JerseyType =
    user?.jersey ??
    (user
      ? autoJersey(user.id, user.name || '')
      : { color: JERSEY_COLORS[2].hex, pattern: 'solid', number: 10, displayName: '' });
  const [jersey, setJersey] = useState<JerseyType>(initialJersey);

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
    <View style={styles.root}>
      {/* Blue hero on top with the live jersey preview floating into
          its bottom edge — same visual language as the Communities /
          Matches tab heroes. */}
      <LinearGradient
        colors={HERO_GRADIENT}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={styles.hero}
      >
        <SafeAreaView edges={['top']} style={styles.heroSafe}>
          <Text style={styles.heroTitle}>{he.psoProfileTitle}</Text>
          <Text style={styles.heroSubtitle}>{he.psoWelcomeBody}</Text>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {/* Live jersey preview — pulled up onto the hero's curved
            bottom so the page reads as ONE composition. */}
        <View style={styles.previewWrap}>
          <Jersey
            jersey={jersey}
            user={
              user
                ? {
                    id: user.id,
                    name: jersey.displayName.trim() || name.trim() || user.name,
                  }
                : null
            }
            size={140}
            showName
          />
        </View>

        <Card style={styles.formCard}>
          <InputField
            label={he.profileName}
            value={name}
            onChangeText={setName}
            placeholder={he.profileNamePlaceholder}
            maxLength={40}
            icon="person-outline"
            required
          />

          <InputField
            label={he.psoProfileNickname}
            value={jersey.displayName}
            onChangeText={(t) =>
              setJersey((j) => ({ ...j, displayName: t.slice(0, 10) }))
            }
            placeholder={he.psoProfileNicknamePlaceholder}
            maxLength={10}
          />

          <View style={styles.numberRow}>
            <Text style={styles.label}>{he.psoProfileNumber}</Text>
            <JerseyNumberInput
              value={jersey.number > 0 ? String(jersey.number) : ''}
              onChangeText={(t) => {
                const n = parseInt(t, 10);
                setJersey((j) => ({
                  ...j,
                  number:
                    Number.isFinite(n) && n >= 1 && n <= 99 ? n : j.number,
                }));
              }}
            />
          </View>

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
                  accessibilityRole="button"
                  accessibilityLabel={c.id}
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

          <View>
            <Text style={styles.label}>{he.psoProfilePattern}</Text>
            <View style={styles.patternRow}>
              {JERSEY_PATTERNS.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() =>
                    setJersey((j) => ({
                      ...j,
                      pattern: p.id as JerseyPattern,
                    }))
                  }
                  style={[
                    styles.patternPill,
                    jersey.pattern === p.id && styles.patternPillActive,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={p.nameHe}
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
        </Card>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.ctaBar}>
        <Pressable
          onPress={handleSave}
          disabled={!canSave}
          style={({ pressed }) => [
            styles.ctaBtn,
            pressed && { opacity: 0.92 },
            !canSave && { opacity: 0.5 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={he.psoProfileSave}
        >
          <Text style={styles.ctaText}>{he.psoProfileSave}</Text>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  // Hero: same shape language as the redesigned tab heroes — curved
  // bottom corners + soft shadow lifting the surface.
  hero: {
    overflow: 'hidden',
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    paddingBottom: spacing.xxl + spacing.lg,
    shadowColor: '#1E40AF',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 6,
  },
  heroSafe: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: 6,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '900',
    textAlign: RTL_LABEL_ALIGN,
    letterSpacing: 0.3,
  },
  heroSubtitle: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 13,
    fontWeight: '500',
    textAlign: RTL_LABEL_ALIGN,
  },

  scroll: {
    paddingBottom: spacing.xxl + spacing.lg,
  },

  // Jersey preview floats up onto the hero — pulls into the curved
  // bottom for the same visual rhyme as the screen heroes.
  previewWrap: {
    alignItems: 'center',
    marginTop: -spacing.xxl,
  },

  formCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.lg,
    gap: spacing.md,
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
    borderColor: ACCENT,
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
    borderColor: ACCENT,
    backgroundColor: ACCENT_SOFT,
  },
  patternText: { ...typography.body, color: colors.textMuted },
  patternTextActive: { color: ACCENT, fontWeight: '700' },

  email: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
  },

  // Pinned CTA bar — blue pill, full-width, matches the rest of
  // the redesigned action bars.
  ctaBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  ctaBtn: {
    backgroundColor: ACCENT,
    borderRadius: 999,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1E40AF',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 5,
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
