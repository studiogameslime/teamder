// JerseyPickerScreen — pick color, pattern, number, and display name.
// Live preview at the top updates as the user changes any field.
//
// Persistence: userService.updateProfile({ jersey }) — same path used by
// name/avatarId edits. No duplicate-number validation in v1 per spec.

import React, { useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/Button';
import { Jersey as JerseyView } from '@/components/Jersey';
import { userService } from '@/services';
import {
  JERSEY_COLORS,
  JERSEY_PATTERNS,
  autoJersey,
  trimDisplayName,
} from '@/data/jerseys';
import type { Jersey, JerseyPattern } from '@/types';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';

export function JerseyPickerScreen() {
  const nav = useNavigation();
  const user = useUserStore((s) => s.currentUser);

  // Seed the form with the user's current jersey, falling back to the
  // deterministic auto-jersey so first-time users see a sensible
  // starting point instead of an empty form.
  const initial: Jersey = useMemo(() => {
    if (user?.jersey) return user.jersey;
    return autoJersey(user?.id ?? '', user?.name ?? '');
  }, [user?.id, user?.jersey, user?.name]);

  const [color, setColor] = useState<string>(initial.color);
  const [pattern, setPattern] = useState<JerseyPattern>(initial.pattern);
  const [number, setNumber] = useState<string>(String(initial.number));
  const [displayName, setDisplayName] = useState<string>(initial.displayName);
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  // Parse + clamp number so the live preview always renders something
  // valid even mid-typing. The persisted value uses the same clamp.
  const parsedNumber = clampJerseyNumber(number);

  const previewJersey: Jersey = {
    color,
    pattern,
    number: parsedNumber,
    displayName: displayName.trim() || trimDisplayName(user.name),
  };

  const save = async () => {
    setBusy(true);
    try {
      const next: Jersey = {
        color,
        pattern,
        number: parsedNumber,
        displayName: trimDisplayName(displayName || user.name),
      };
      const updated = await userService.updateProfile({ jersey: next });
      // Mirror to the store so screens that read currentUser.jersey
      // re-render without a round-trip.
      useUserStore.setState({ currentUser: updated });
      nav.goBack();
    } catch (e) {
      Alert.alert(he.error, String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.jerseyTitle} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>{he.jerseyIntro}</Text>

        <View style={styles.previewCard}>
          <JerseyView
            jersey={previewJersey}
            user={user}
            size={160}
            showName
            showRing
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>{he.jerseySectionColor}</Text>
          <View style={styles.swatchRow}>
            {JERSEY_COLORS.map((c) => {
              const active = c.hex === color;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => setColor(c.hex)}
                  accessibilityLabel={c.nameHe}
                  style={({ pressed }) => [
                    styles.swatch,
                    {
                      backgroundColor: c.hex,
                      borderColor: active ? colors.primary : colors.border,
                      borderWidth: active ? 3 : 1,
                    },
                    pressed && { opacity: 0.85 },
                  ]}
                />
              );
            })}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>{he.jerseySectionPattern}</Text>
          <View style={styles.patternRow}>
            {JERSEY_PATTERNS.map((p) => {
              const active = p.id === pattern;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => setPattern(p.id)}
                  style={({ pressed }) => [
                    styles.patternTile,
                    active && styles.patternTileActive,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <JerseyView
                    jersey={{
                      color,
                      pattern: p.id,
                      number: parsedNumber,
                      displayName: '',
                    }}
                    size={48}
                  />
                  <Text
                    style={[
                      styles.patternLabel,
                      active && { color: colors.primary, fontWeight: '700' },
                    ]}
                  >
                    {p.nameHe}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>{he.jerseySectionNumber}</Text>
          <TextInput
            value={number}
            onChangeText={(t) => setNumber(t.replace(/[^0-9]/g, '').slice(0, 2))}
            placeholder="7"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            textAlign="center"
            keyboardType="number-pad"
            maxLength={2}
          />
          <Text style={styles.hint}>{he.jerseyNumberHint}</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>{he.jerseySectionDisplayName}</Text>
          <TextInput
            value={displayName}
            onChangeText={(t) => setDisplayName(t.slice(0, 10))}
            placeholder={he.jerseyDisplayNamePlaceholder}
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            textAlign="right"
            maxLength={10}
          />
          <Text style={styles.hint}>{he.jerseyDisplayNameHint}</Text>
        </View>
      </ScrollView>

      <View style={{ padding: spacing.lg }}>
        <Button
          title={he.jerseySave}
          variant="primary"
          size="lg"
          fullWidth
          loading={busy}
          onPress={save}
        />
      </View>
    </SafeAreaView>
  );
}

function clampJerseyNumber(s: string): number {
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > 99) return 99;
  return n;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xl,
  },
  intro: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  previewCard: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  field: { gap: spacing.xs },
  label: { ...typography.label, color: colors.textMuted },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
    textAlign: RTL_LABEL_ALIGN,
  },
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    // Hebrew TextInput on Android needs physical 'right' to hug the
    // visual right edge. Number inputs override this with an inline
    // textAlign='center' prop on the TextInput itself.
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  swatch: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  patternRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  patternTile: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    gap: spacing.xs,
    minWidth: 80,
  },
  patternTileActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  patternLabel: { ...typography.caption, color: colors.textMuted },
});
