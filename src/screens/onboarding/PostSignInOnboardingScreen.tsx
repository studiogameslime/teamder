// Post-sign-in onboarding — single profile-customisation step.
// The previous flow had three intermediate screens (welcome → how
// → profile) but the user already saw the value pitch on the
// pre-sign-in slides; repeating it here just adds taps before the
// app actually starts working. Now it's one screen: name + a
// profile picture (photo upload OR built-in avatar), save → main app.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { appAlert } from '@/components/AppDialog';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InputField } from '@/components/InputField';
import { AutocompleteInput } from '@/components/AutocompleteInput';
import { Card } from '@/components/Card';
import { UserAvatar } from '@/components/UserAvatar';
import { AVATARS, getAvatarById, pickRandomAvatarId } from '@/data/avatars';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { pickAndUploadAvatar, deleteUserPhoto } from '@/services/photoService';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { readPendingAction } from '@/services/pendingAction';
import { searchCities } from '@/services/israelLocationService';
import { geocodeCity } from '@/services/geocodeService';

const HERO_GRADIENT = ['#1E3A8A', '#1E40AF', '#3B82F6'] as const;
const ACCENT = '#1E40AF';
const ACCENT_SOFT = '#DBEAFE';

export function PostSignInOnboardingScreen() {
  const user = useUserStore((s) => s.currentUser);
  const complete = useUserStore((s) => s.completePostSignInOnboarding);

  const [name, setName] = useState(user?.name ?? '');
  /** Whether the provider gave us a name to start from — the difference between
   *  "confirm this" and "type this", which is worth knowing when reading the
   *  drop-off on this screen. */
  const prefilledRef = useRef(!!user?.name);
  /** What the person was trying to do. Reported so this screen's drop-off can
   *  be attributed to the intent that led here rather than read as generic
   *  onboarding abandonment. */
  const [pendingKind, setPendingKind] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void readPendingAction()
      .then((a) => {
        if (!alive) return;
        setPendingKind(a?.kind ?? null);
        logEvent(AnalyticsEvent.ProfileConfirmationViewed, {
          action_kind: a?.kind ?? 'none',
          had_prefill: prefilledRef.current,
        });
      })
      .catch(() => {
        if (alive) {
          logEvent(AnalyticsEvent.ProfileConfirmationViewed, { action_kind: 'none' });
        }
      });
    return () => {
      alive = false;
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  /**
   * Home city. OPTIONAL, and the same field the availability editor and the
   * club wizard write — `availability.homeCity`, picked from the same
   * `searchCities` autocomplete. No new data model, no second "where do you
   * live" on the user document.
   *
   * Optional because this screen is a confirmation, not a form: requiring it
   * would put a network-backed autocomplete on the critical path of every
   * sign-up, and a person who has just tapped "join" is here to finish that,
   * not to fill in a profile.
   */
  const [city, setCity] = useState<string>(user?.availability?.homeCity ?? '');
  const fetchCities = useCallback((q: string) => searchCities(q), []);

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
    logEvent(AnalyticsEvent.OnboardingInteraction, { action: 'photo_picker_opened', step: 'profile' });
    if (!user) return;
    setUploading(true);
    const res = await pickAndUploadAvatar(user.id);
    setUploading(false);
    if (!res.ok) {
      // Photo is optional — a built-in avatar grid sits right below. When
      // the user denies gallery access we must NOT nag them to reconsider
      // or point them to Settings (App Store guideline 5.1.1(iv)); just
      // fall back silently and let them pick an avatar instead.
      if (res.reason === 'cancelled' || res.reason === 'permission') {
        logEvent(AnalyticsEvent.PhotoUploadAbandoned, {
          source: 'onboarding',
          reason: res.reason === 'permission' ? 'permission_denied' : 'cancelled',
        });
      } else {
        logEvent(AnalyticsEvent.PhotoUploadFailed, {
          source: 'onboarding',
          reason: res.reason,
        });
      }
      if (res.reason === 'network') {
        appAlert(he.error, he.profilePhotoUploadFailed);
      } else if (res.reason === 'unavailable') {
        appAlert(he.error, he.profilePhotoUnavailable);
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
    if (busy) return;
    logEvent(AnalyticsEvent.OnboardingInteraction, { action: 'profile_save_tapped', step: 'profile' });
    setBusy(true);
    try {
      const trimmedCity = city.trim();
      // Best-effort geocode. The matcher wants coordinates, but a Nominatim
      // round-trip must never be what stands between somebody and their
      // account: a failure, a timeout or an unrecognised spelling all fall
      // through to saving the name on its own, which is still a useful answer
      // and is exactly what the availability editor tolerates.
      let coords: { lat: number; lng: number } | null = null;
      if (trimmedCity) {
        coords = await geocodeCity(trimmedCity).catch(() => null);
      }
      await complete({
        name: name.trim(),
        avatarId: photoUrl ? undefined : avatarId,
        photoUrl,
        ...(trimmedCity ? { homeCity: trimmedCity } : {}),
        ...(coords ? { homeCityLat: coords.lat, homeCityLng: coords.lng } : {}),
      });
      // Closes the funnel leg that starts at auth_prompt_shown. `complete`
      // flips `onboardingCompleted`, which is what lets RootNavigator's resume
      // effect run — so the action the person originally asked for finishes
      // immediately after this, without them tapping anything again.
      logEvent(AnalyticsEvent.ProfileConfirmed, {
        action_kind: pendingKind ?? 'none',
        had_prefill: prefilledRef.current,
        // The city is optional, so the only way to know whether asking for it
        // was worth the extra field is to count how often it is answered.
        // The VALUE never travels — a home city is a person's location.
        has_city: trimmedCity.length > 0,
        city_geocoded: !!coords,
      });
    } catch (err) {
      if (__DEV__) console.warn('[onboarding] complete failed', err);
      logEvent(AnalyticsEvent.ProfileSaveFailed, {
        source: 'post_signin_onboarding',
        code: (err as { code?: string } | null)?.code ?? 'unknown',
      });
      appAlert(he.error, he.signInFailed);
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
            onFocus={() => logEvent(AnalyticsEvent.OnboardingInteraction, { action: 'field_focused', field: 'name', step: 'profile' })}
            onBlur={() => logEvent(AnalyticsEvent.OnboardingInteraction, { action: 'field_edited', field: 'name', has_value: !!name.trim(), step: 'profile' })}
            placeholder={he.profileNamePlaceholder}
            maxLength={40}
            icon="person-outline"
            required
          />

          {/* City — after the name, before the picture. The reference puts
              identity (who) above location (where), and both above the
              avatar grid, which is the longest thing on the screen. */}
          <AutocompleteInput
            label={he.psoCityLabel}
            value={city}
            onChange={setCity}
            onSelect={(value) => { setCity(value); logEvent(AnalyticsEvent.OnboardingInteraction, { action: 'city_selected', has_value: !!value, step: 'profile' }); }}
            placeholder={he.psoCityPlaceholder}
            fetchSuggestions={fetchCities}
          />
          <Text style={styles.cityHint}>{he.psoCityHint}</Text>

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
            <Text style={styles.uploadBtnText}>
              {photoUrl ? he.profilePhotoChange : he.profilePhotoUpload}
            </Text>
            <Ionicons name="image-outline" size={18} color={ACCENT} />
          </Pressable>

          <Text style={styles.label}>{he.profileAvatarLabel}</Text>
          <View style={styles.avatarGrid}>
            {AVATARS.map((a) => (
              <Pressable
                key={a.id}
                onPress={() => handlePickAvatar(a.id)}
                style={[
                  styles.avatarCell,
                  getAvatarById(avatarId)?.id === a.id && !photoUrl && styles.avatarCellActive,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`avatar-${a.id}`}
              >
                <UserAvatar user={{ id: a.id, name: '', avatarId: a.id }} size={48} />
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
  cityHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
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
