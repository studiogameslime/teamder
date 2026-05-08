// Post-sign-in onboarding — single profile-customisation step.
// The previous flow had three intermediate screens (welcome → how
// → profile) but the user already saw the value pitch on the
// pre-sign-in slides; repeating it here just adds taps before the
// app actually starts working. Now it's one screen: name + a
// profile picture (photo upload OR built-in avatar), save → main app.

import React, { useState } from 'react';
import {
  ActivityIndicator,
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

import { InputField } from '@/components/InputField';
import { Card } from '@/components/Card';
import { UserAvatar } from '@/components/UserAvatar';
import { AVATARS, pickRandomAvatarId } from '@/data/avatars';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { pickAndUploadAvatar, deleteUserPhoto } from '@/services/photoService';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';

const HERO_GRADIENT = ['#1E3A8A', '#1E40AF', '#3B82F6'] as const;
const ACCENT = '#1E40AF';
const ACCENT_SOFT = '#DBEAFE';

export function PostSignInOnboardingScreen() {
  const user = useUserStore((s) => s.currentUser);
  const complete = useUserStore((s) => s.completePostSignInOnboarding);

  const [name, setName] = useState(user?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Photo / avatar state. We track them independently — picking an
  // avatar clears the photo (and vice versa) so the on-screen
  // preview always reflects exactly one choice.
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(user?.photoUrl);
  const [avatarId, setAvatarId] = useState<string | undefined>(
    user?.avatarId ?? (user ? pickRandomAvatarId() : undefined),
  );

  const previewUser = user
    ? {
        id: user.id,
        name: name.trim() || user.name,
        photoUrl,
        avatarId,
      }
    : null;

  const canSave = name.trim().length > 0 && !busy && !uploading;

  const handlePickPhoto = async () => {
    if (!user) return;
    setUploading(true);
    const res = await pickAndUploadAvatar(user.id);
    setUploading(false);
    if (!res.ok) {
      if (res.reason === 'permission') {
        Alert.alert(he.error, he.profilePhotoPermissionDenied);
      } else if (res.reason === 'network') {
        Alert.alert(he.error, he.profilePhotoUploadFailed);
      } else if (res.reason === 'unavailable') {
        Alert.alert(he.error, he.profilePhotoUnavailable);
      }
      return;
    }
    setPhotoUrl(res.url);
    // The user just picked a photo — drop the previously-picked
    // avatar selection so the preview / save reflect the photo.
    setAvatarId(undefined);
    logEvent(AnalyticsEvent.PhotoUploaded, { source: 'onboarding' });
  };

  const handlePickAvatar = (id: string) => {
    // Picking a built-in avatar drops the photo. We also delete the
    // uploaded file from Storage best-effort so we don't leave it
    // orphaned (the user explicitly opted for an avatar instead).
    if (photoUrl && user) {
      deleteUserPhoto(user.id);
    }
    setPhotoUrl(undefined);
    setAvatarId(id);
    logEvent(AnalyticsEvent.AvatarChanged, {
      source: 'onboarding',
      avatarId: id,
    });
  };

  const handleSave = async () => {
    setBusy(true);
    try {
      await complete({
        name: name.trim(),
        avatarId: photoUrl ? undefined : avatarId,
        photoUrl,
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
        {/* Live preview — pulled up onto the curved hero bottom. */}
        <View style={styles.previewWrap}>
          <View style={styles.previewRing}>
            <UserAvatar user={previewUser} size={132} ring />
            {uploading ? (
              <View style={styles.previewSpinner}>
                <ActivityIndicator color="#FFFFFF" />
              </View>
            ) : null}
          </View>
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
                <View
                  style={[
                    styles.avatarDot,
                    { backgroundColor: a.bg },
                  ]}
                >
                  <Text style={styles.avatarGlyph}>{a.glyph}</Text>
                </View>
              </Pressable>
            ))}
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

  previewWrap: {
    alignItems: 'center',
    marginTop: -spacing.xxl,
  },
  previewRing: {
    padding: spacing.xs,
    backgroundColor: 'transparent',
  },
  previewSpinner: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.5)',
    borderRadius: 80,
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

  email: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
  },

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
