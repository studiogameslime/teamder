// ProfileEditScreen — edit name + profile picture (photo OR avatar).
// Mirrors the onboarding profile step: pick a photo from the gallery
// or tap one of the built-in avatars. The legacy "open jersey
// picker" button is gone — the jersey concept was retired in favour
// of real profile pictures.

import React, { useState, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { appAlert } from '@/components/AppDialog';
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
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import type { PlayerPosition } from '@/types';

const ACCENT = '#1E40AF';
const ACCENT_SOFT = '#DBEAFE';

const POSITION_OPTIONS: { value: PlayerPosition; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'gk', label: he.positionGk, icon: 'hand-left-outline' },
  { value: 'def', label: he.positionDef, icon: 'shield-outline' },
  { value: 'mid', label: he.positionMid, icon: 'sync-outline' },
  { value: 'att', label: he.positionAtt, icon: 'flame-outline' },
];

export function ProfileEditScreen() {
  const nav = useNavigation();
  const user = useUserStore((s) => s.currentUser);
  const updateProfile = useUserStore((s) => s.updateProfile);

  const [name, setName] = useState(user?.name ?? '');
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(user?.photoUrl);
  const [avatarId, setAvatarId] = useState<string | undefined>(user?.avatarId);
  const [position, setPosition] = useState<PlayerPosition | undefined>(
    user?.position,
  );
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  // The screen is kept alive by the stack navigator between visits,
  // so the useState initializers above only run once. After a save +
  // back + re-entry we'd otherwise show the previous photo/avatar.
  // Reset local form state any time the underlying store user
  // changes — same id but different photoUrl / avatarId / name.
  useEffect(() => {
    if (!user) return;
    setName(user.name ?? '');
    setPhotoUrl(user.photoUrl);
    setAvatarId(user.avatarId);
    setPosition(user.position);
  }, [user?.id, user?.name, user?.photoUrl, user?.avatarId, user?.position]);

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
  const positionDirty = position !== user.position;
  const isDirty = nameDirty || photoDirty || avatarDirty || positionDirty;
  const canSave = !busy && !uploading && isDirty;

  // Catch back-navigation attempts when there are unsaved changes.
  // Without this the user can hit the system back button and lose
  // their photo upload silently.
  //
  // CRITICAL: we read `isDirty` and `savingRef` THROUGH refs at
  // event time, not as captured closure values. Two reasons:
  //   1. The save flow calls `nav.goBack()` synchronously after
  //      `await updateProfile()`. React 18 may not have re-rendered
  //      yet when goBack fires beforeRemove, so a listener that
  //      captured `busy=false` at registration would still consider
  //      the doc dirty and pop the "unsaved changes" dialog —
  //      blocking the legitimate save→back flow. The ref pattern
  //      reads the live value at event time and skips the dialog
  //      mid-save.
  //   2. Same trick guards against multiple re-renders shifting
  //      which listener is active mid-save.
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  dirtyRef.current = isDirty;

  useEffect(() => {
    const unsub = (nav as unknown as {
      addListener: (
        e: 'beforeRemove',
        h: (e: { preventDefault: () => void; data: { action: unknown } }) => void,
      ) => () => void;
    }).addListener('beforeRemove', (e) => {
      if (!dirtyRef.current || savingRef.current) return;
      e.preventDefault();
      appAlert(
        he.profileEditUnsavedTitle,
        he.profileEditUnsavedBody,
        [
          {
            text: he.profileEditUnsavedDiscard,
            style: 'destructive',
            onPress: () => {
              (nav as unknown as { dispatch: (a: unknown) => void }).dispatch(
                e.data.action,
              );
            },
          },
          {
            text: he.profileEditUnsavedSave,
            onPress: async () => {
              await save();
            },
          },
          { text: he.cancel, style: 'cancel' },
        ],
      );
    });
    return unsub;
  }, [nav]);

  const handlePickPhoto = async () => {
    setUploading(true);
    const res = await pickAndUploadAvatar(user.id);
    setUploading(false);
    if (!res.ok) {
      // Photo is optional (built-in avatars available). Per App Store
      // guideline 5.1.1(iv) we don't nag to reconsider or send the user to
      // Settings after a denial — just fall back silently.
      if (res.reason === 'network') {
        appAlert(he.error, he.profilePhotoUploadFailed);
      } else if (res.reason === 'unavailable') {
        appAlert(he.error, he.profilePhotoUnavailable);
      }
      return;
    }
    setPhotoUrl(res.url);
    setAvatarId(undefined);
    logEvent(AnalyticsEvent.PhotoUploaded, { source: 'profile_edit' });
  };

  const handlePickAvatar = (id: string) => {
    if (photoUrl) {
      deleteUserPhoto(user.id);
    }
    setPhotoUrl(undefined);
    setAvatarId(id);
    logEvent(AnalyticsEvent.AvatarChanged, {
      source: 'profile_edit',
      avatarId: id,
    });
  };

  const save = async () => {
    // savingRef tells the beforeRemove listener to skip the dialog
    // for the goBack we trigger ourselves at the end. Set it BEFORE
    // any state mutations so the listener sees it even if React
    // doesn't re-render between updateProfile() resolving and
    // nav.goBack() firing.
    savingRef.current = true;
    setBusy(true);
    try {
      const patch: Parameters<typeof updateProfile>[0] = {};
      if (nameDirty) patch.name = name.trim();
      if (photoDirty) patch.photoUrl = photoUrl;
      if (avatarDirty) patch.avatarId = avatarId;
      if (positionDirty) patch.position = position;
      if (__DEV__) {
        console.log('[profileEdit] save start', {
          nameDirty,
          photoDirty,
          avatarDirty,
          patchKeys: Object.keys(patch),
          photoUrl: patch.photoUrl?.slice(0, 80),
        });
      }
      if (Object.keys(patch).length > 0) {
        await updateProfile(patch);
        if (__DEV__) console.log('[profileEdit] save resolved');
        // Explicitly snap local form state to the saved values RIGHT
        // NOW. The local-state-sync useEffect would do this when the
        // store update propagates, but that's an extra render cycle
        // and we need `isDirty` to be false BEFORE `nav.goBack()` —
        // otherwise the beforeRemove listener could (in some
        // interleavings) read a stale `dirtyRef.current` and pop the
        // unsaved-changes dialog despite a successful save.
        if (patch.name !== undefined) setName(patch.name);
        if (patch.photoUrl !== undefined) setPhotoUrl(patch.photoUrl);
        if (patch.avatarId !== undefined) setAvatarId(patch.avatarId);
        if (patch.position !== undefined) setPosition(patch.position);
        // dirtyRef is computed from isDirty during render; force it
        // to false directly so the beforeRemove listener that fires
        // during nav.goBack() below can never see dirty=true.
        dirtyRef.current = false;
      }
      nav.goBack();
    } catch (err) {
      // If we get here, the save FAILED — the previous version
      // swallowed this in `finally` and the user thought the click
      // did nothing. Surface the error and don't navigate away;
      // the dirty state stays so the form is recoverable.
      if (__DEV__) console.warn('[profileEdit] save failed', err);
      // Friendly Hebrew only — the technical code/message stays in the
      // __DEV__ warn above and never reaches the user.
      appAlert(he.error, he.profilePhotoUploadFailed);
      // Bail out so the finally still resets busy/saving but goBack
      // never runs.
    } finally {
      setBusy(false);
      savingRef.current = false;
    }
  };

  return (
    <ScreenContainer
      title={he.profileEdit}
      footer={
        <Button
          title={he.profileSave}
          variant="primary"
          size="lg"
          fullWidth
          disabled={!canSave}
          loading={busy}
          onPress={save}
        />
      }
    >
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
        {name.trim().length === 0 ? (
          <Text style={styles.fieldError}>{he.profileNameRequired}</Text>
        ) : null}

        <Text style={styles.label}>{he.positionLabel}</Text>
        <View style={styles.positionRow}>
          {POSITION_OPTIONS.map((opt) => {
            const active = position === opt.value;
            return (
              <Pressable
                key={opt.value}
                // Tap the active chip again to clear it.
                onPress={() => setPosition(active ? undefined : opt.value)}
                style={[styles.posChip, active && styles.posChipActive]}
                accessibilityRole="button"
                accessibilityLabel={opt.label}
              >
                <Ionicons
                  name={opt.icon}
                  size={16}
                  color={active ? '#FFFFFF' : colors.textMuted}
                />
                <Text style={[styles.posChipText, active && styles.posChipTextActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

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

        {/* Visual "OR" divider: a thin line through the row with the
            word "או" floating in the middle. Previously the label sat
            on its own line and read like a regular field label, which
            made it unclear that the avatars below are an alternative
            to the upload above. */}
        <View style={styles.orDivider}>
          <View style={styles.orDividerLine} />
          <Text style={styles.orDividerText}>{he.profileAvatarLabel}</Text>
          <View style={styles.orDividerLine} />
        </View>
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
  positionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  posChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
  },
  posChipActive: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  posChipText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
  },
  posChipTextActive: { color: '#FFFFFF' },
  fieldError: {
    ...typography.caption,
    color: colors.danger,
    textAlign: RTL_LABEL_ALIGN,
    marginTop: -spacing.xs,
    marginBottom: spacing.xs,
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
  // "OR" divider — two horizontal lines flanking the centred label.
  // Used to break the "upload from gallery" CTA above the avatar
  // grid so the user reads them as alternatives, not a sequence.
  orDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  orDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E2E8F0',
  },
  orDividerText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
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
