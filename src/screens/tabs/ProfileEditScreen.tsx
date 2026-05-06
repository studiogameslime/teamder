// ProfileEditScreen — edit name + profile picture (photo OR avatar).
// Mirrors the onboarding profile step: pick a photo from the gallery
// or tap one of the built-in avatars. The legacy "open jersey
// picker" button is gone — the jersey concept was retired in favour
// of real profile pictures.

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
import { useNavigation } from '@react-navigation/native';

import { ScreenContainer } from '@/components/ScreenContainer';
import { Card } from '@/components/Card';
import { InputField } from '@/components/InputField';
import { Button } from '@/components/Button';
import { UserAvatar } from '@/components/UserAvatar';
import { AVATARS } from '@/data/avatars';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { pickAndUploadAvatar, deleteUserPhoto } from '@/services/photoService';

const ACCENT = '#1E40AF';
const ACCENT_SOFT = '#DBEAFE';

export function ProfileEditScreen() {
  const nav = useNavigation();
  const user = useUserStore((s) => s.currentUser);
  const updateProfile = useUserStore((s) => s.updateProfile);

  const [name, setName] = useState(user?.name ?? '');
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(user?.photoUrl);
  const [avatarId, setAvatarId] = useState<string | undefined>(user?.avatarId);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  if (!user) return null;

  const previewUser = {
    id: user.id,
    name: name.trim() || user.name,
    photoUrl,
    avatarId,
  };

  const nameDirty = name.trim().length > 0 && name.trim() !== user.name;
  const photoDirty = photoUrl !== user.photoUrl;
  const avatarDirty = avatarId !== user.avatarId;
  const canSave = !busy && !uploading && (nameDirty || photoDirty || avatarDirty);

  const handlePickPhoto = async () => {
    setUploading(true);
    const res = await pickAndUploadAvatar(user.id);
    setUploading(false);
    if (!res.ok) {
      if (res.reason === 'permission') {
        Alert.alert(he.error, he.profilePhotoPermissionDenied);
      } else if (res.reason === 'network') {
        Alert.alert(he.error, he.profilePhotoUploadFailed);
      }
      return;
    }
    setPhotoUrl(res.url);
    setAvatarId(undefined);
  };

  const handlePickAvatar = (id: string) => {
    if (photoUrl) {
      deleteUserPhoto(user.id);
    }
    setPhotoUrl(undefined);
    setAvatarId(id);
  };

  const save = async () => {
    setBusy(true);
    try {
      const patch: Parameters<typeof updateProfile>[0] = {};
      if (nameDirty) patch.name = name.trim();
      if (photoDirty) patch.photoUrl = photoUrl;
      if (avatarDirty) patch.avatarId = avatarId;
      if (Object.keys(patch).length > 0) {
        await updateProfile(patch);
      }
      nav.goBack();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenContainer title={he.profileEdit}>
      <Card style={styles.identityCard}>
        <View>
          <UserAvatar user={previewUser} size={120} ring />
          {uploading ? (
            <View style={styles.previewSpinner}>
              <ActivityIndicator color="#FFFFFF" />
            </View>
          ) : null}
        </View>
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

        <Text style={styles.label}>{he.profilePhotoLabel}</Text>
        <Pressable
          onPress={handlePickPhoto}
          disabled={uploading || busy}
          style={({ pressed }) => [
            styles.uploadBtn,
            pressed && { opacity: 0.92 },
            (uploading || busy) && { opacity: 0.6 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={he.profilePhotoUpload}
        >
          <Ionicons name="image-outline" size={18} color={ACCENT} />
          <Text style={styles.uploadBtnText}>
            {photoUrl ? he.profilePhotoChange : he.profilePhotoUpload}
          </Text>
        </Pressable>

        <Text style={styles.label}>{he.profileAvatarLabel}</Text>
        <View style={styles.avatarGrid}>
          {AVATARS.map((a) => (
            <Pressable
              key={a.id}
              onPress={() => handlePickAvatar(a.id)}
              style={[
                styles.avatarCell,
                avatarId === a.id && !photoUrl && styles.avatarCellActive,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`avatar-${a.id}`}
            >
              <View style={[styles.avatarDot, { backgroundColor: a.bg }]}>
                <Text style={styles.avatarGlyph}>{a.glyph}</Text>
              </View>
            </Pressable>
          ))}
        </View>
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
    paddingVertical: spacing.lg,
  },
  previewSpinner: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.5)',
    borderRadius: 60,
  },
  formCard: {
    gap: spacing.md,
  },
  label: {
    ...typography.label,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    marginBottom: spacing.xs,
    marginTop: spacing.xs,
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: ACCENT,
    backgroundColor: ACCENT_SOFT,
  },
  uploadBtnText: {
    color: ACCENT,
    fontSize: 15,
    fontWeight: '700',
  },
  avatarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-start',
  },
  avatarCell: {
    padding: 3,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  avatarCellActive: {
    borderColor: ACCENT,
  },
  avatarDot: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarGlyph: {
    fontSize: 26,
    textAlign: 'center',
  },
});
