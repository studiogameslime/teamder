// ProfileEditScreen — edit display name + jump to jersey customization.
//
// Redesign: ScreenContainer + Card sections. Avatar preview at top, name
// in an InputField, jersey edit as an outline PrimaryButton, save as a
// full-width green PrimaryButton pinned to the bottom.

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { ScreenContainer } from '@/components/ScreenContainer';
import { Card } from '@/components/Card';
import { InputField } from '@/components/InputField';
import { PlayerIdentity } from '@/components/PlayerIdentity';
import { Button } from '@/components/Button';
import { spacing } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';

export function ProfileEditScreen() {
  const nav = useNavigation<any>();
  const user = useUserStore((s) => s.currentUser);
  const updateProfile = useUserStore((s) => s.updateProfile);
  const [name, setName] = useState(user?.name ?? '');
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const nameDirty = name.trim().length > 0 && name.trim() !== user.name;
  const canSave = !busy && nameDirty;

  const save = async () => {
    setBusy(true);
    try {
      if (nameDirty) {
        await updateProfile({ name: name.trim() });
      }
      nav.goBack();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenContainer title={he.profileEdit}>
      <Card style={styles.identityCard}>
        <PlayerIdentity user={user} size="lg" />
      </Card>

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
        <Button
          title={he.jerseyOpenPicker}
          variant="outline"
          size="md"
          fullWidth
          iconLeft="shirt-outline"
          onPress={() => nav.navigate('JerseyPicker')}
          style={{ marginTop: spacing.lg }}
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
          onPress={save}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  identityCard: {
    alignItems: 'center',
  },
  formCard: {
    gap: spacing.md,
  },
});
