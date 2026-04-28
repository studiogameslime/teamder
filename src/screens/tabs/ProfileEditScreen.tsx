// ProfileEditScreen — edit display name + jump to jersey customization.
//
// Identity is jersey-first across the app, so this screen no longer
// shows an avatar grid. The user previews their current jersey at the
// top, edits their name inline, and taps "ערוך גופייה" to push the
// dedicated JerseyPicker for color/pattern/number/displayName edits.

import React, { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { ScreenHeader } from '@/components/ScreenHeader';
import { PlayerIdentity } from '@/components/PlayerIdentity';
import { Button } from '@/components/Button';
import { colors, radius, spacing, typography } from '@/theme';
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
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.profileEdit} />
      <ScrollView contentContainerStyle={styles.content}>
        {/* Live preview of the user's current jersey — read-only here.
            Editing the jersey is gated to the dedicated picker so the
            entry point is unambiguous. */}
        <View style={styles.previewWrap}>
          <PlayerIdentity user={user} size="lg" highlight />
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

        <Button
          title={he.jerseyOpenPicker}
          variant="outline"
          size="md"
          fullWidth
          iconLeft="shirt-outline"
          onPress={() => nav.navigate('JerseyPicker')}
          style={{ marginTop: spacing.md }}
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
          onPress={save}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { alignItems: 'center', padding: spacing.lg, paddingTop: spacing.xl },
  previewWrap: {
    alignItems: 'center',
    marginBottom: spacing.lg,
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
});
