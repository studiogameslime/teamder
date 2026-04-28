import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PlayerIdentity } from '@/components/PlayerIdentity';
import { Button } from '@/components/Button';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';

export function ProfileSetupScreen() {
  const user = useUserStore((s) => s.currentUser);
  const updateProfile = useUserStore((s) => s.updateProfile);
  const [name, setName] = useState(user?.name ?? '');
  const [busy, setBusy] = useState(false);

  const canSave = name.trim().length > 0 && !busy;
  const handleSave = async () => {
    setBusy(true);
    try {
      await updateProfile({ name: name.trim() });
    } finally {
      setBusy(false);
    }
  };

  // Show a live identity preview using the current name + the user's
  // existing jersey (or the deterministic auto-jersey when missing).
  const previewUser = user
    ? { ...user, name: name.trim() || user.name }
    : null;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{he.profileTitle}</Text>
        <View style={{ marginVertical: spacing.lg }}>
          <PlayerIdentity user={previewUser} size="xl" highlight />
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
      </ScrollView>
      <View style={{ padding: spacing.lg }}>
        <Button
          title={he.profileSave}
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
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    alignItems: 'center',
  },
  title: { ...typography.h1, color: colors.text, textAlign: 'center' },
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
});
