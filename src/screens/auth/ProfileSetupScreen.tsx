// ProfileSetupScreen — first-run name capture.
//
// Redesign: ScreenContainer + Card layout. Title at top, centred avatar
// preview, InputField for the name, full-width primary CTA pinned to
// the bottom.

import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { appAlert } from '@/components/AppDialog';

import { ScreenContainer } from '@/components/ScreenContainer';
import { Card } from '@/components/Card';
import { InputField } from '@/components/InputField';
import { PlayerIdentity } from '@/components/PlayerIdentity';
import { Button } from '@/components/Button';
import { colors, spacing, typography } from '@/theme';
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
    } catch (err) {
      // First-run name capture gates entry to the whole app. A silent
      // failure here strands the user on this screen with no feedback —
      // surface the error so they know to retry.
      if (__DEV__) console.warn('[profileSetup] save failed', err);
      appAlert(he.error, he.profileSaveError);
    } finally {
      setBusy(false);
    }
  };

  const previewUser = user
    ? { ...user, name: name.trim() || user.name }
    : null;

  return (
    <ScreenContainer>
      {/* KAV so the bottom-pinned CTA isn't hidden by the keyboard that
          opens for the name field — this screen gates entry to the app. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Text style={styles.title}>{he.profileTitle}</Text>

        <Card style={styles.identityCard}>
          <PlayerIdentity user={previewUser} size="xl" />
        </Card>

        <Card>
          <InputField
            label={he.profileName}
            value={name}
            onChangeText={setName}
            placeholder={he.profileNamePlaceholder}
            maxLength={40}
            icon="person-outline"
            required
            returnKeyType="done"
            onSubmitEditing={() => {
              if (canSave) handleSave();
            }}
          />
        </Card>

        <View style={{ marginTop: 'auto' }}>
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
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.h1,
    color: colors.text,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  identityCard: {
    alignItems: 'center',
  },
});
