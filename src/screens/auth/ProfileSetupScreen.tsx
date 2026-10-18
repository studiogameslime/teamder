// Basic profile completion: the existing name gate with optional photo/avatar choice.
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { SafeKeyboardAvoidingView as KeyboardAvoidingView } from '@/components/SafeKeyboardAvoidingView';
import { ScrollSurface } from '@/components/ScrollSurface';
import { UserAvatar } from '@/components/UserAvatar';
import { appAlert } from '@/components/AppDialog';
import { AVATARS, getAvatarById } from '@/data/avatars';
import { pickAndUploadAvatar, deleteUserPhoto } from '@/services/photoService';
import { RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';

const BLUE = '#2861F4';
const FEATURED = ['a01', 'a06', 'a07', 'a22'];

export function ProfileSetupScreen({ onClose }: { onClose?: () => void } = {}) {
  const nav = useNavigation();
  const user = useUserStore((s) => s.currentUser);
  const updateProfile = useUserStore((s) => s.updateProfile);
  const [name, setName] = useState(user?.name ?? '');
  const [photoUrl, setPhotoUrl] = useState(user?.photoUrl);
  const [avatarId, setAvatarId] = useState(getAvatarById(user?.avatarId)?.id);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const locked = busy || uploading;
  const canSave = !!user && name.trim().length > 0 && !locked;

  const handlePickPhoto = async () => {
    if (!user || inFlight.current) return;
    inFlight.current = true;
    setUploading(true);
    logEvent(AnalyticsEvent.OnboardingInteraction, { action: 'photo_picker_opened', step: 'profile_setup' });
    try {
      const result = await pickAndUploadAvatar(user.id);
      if (!mounted.current || useUserStore.getState().currentUser?.id !== user.id) return;
      if (result.ok) {
        setPhotoUrl(result.url);
        logEvent(AnalyticsEvent.PhotoUploaded, { source: 'profile_setup' });
      } else if (result.reason === 'cancelled' || result.reason === 'permission') {
        logEvent(AnalyticsEvent.PhotoUploadAbandoned, { source: 'profile_setup', reason: result.reason });
        if (result.reason === 'permission') appAlert(he.error, he.profilePhotoPermissionDenied);
      } else {
        logEvent(AnalyticsEvent.PhotoUploadFailed, { source: 'profile_setup', reason: result.reason });
        appAlert(he.error, result.reason === 'unavailable' ? he.profilePhotoUnavailable : he.profilePhotoUploadFailed);
      }
    } catch {
      if (mounted.current) appAlert(he.error, he.profilePhotoUploadFailed);
    } finally {
      inFlight.current = false;
      if (mounted.current) setUploading(false);
    }
  };
  const handlePickAvatar = (id: string) => {
    if (inFlight.current) return;
    setAvatarId(id);
    setPhotoUrl(undefined);
    // Selection is only a draft. Never delete the saved photo before Save succeeds.
    logEvent(AnalyticsEvent.AvatarChanged, { source: 'profile_setup', avatarId: id });
  };
  const handleSave = async () => {
    if (!canSave || !user || inFlight.current) return;
    inFlight.current = true;
    logEvent(AnalyticsEvent.OnboardingInteraction, { action: 'profile_save_tapped', step: 'profile_setup' });
    setBusy(true);
    try {
      await updateProfile({ name: name.trim(), photoUrl, ...(avatarId ? { avatarId } : {}) });
      // Cleanup follows a successful profile write; a failed save keeps the old image intact.
      if (!photoUrl && user.photoUrl && useUserStore.getState().currentUser?.id === user.id) {
        void deleteUserPhoto(user.id);
      }
      logEvent(AnalyticsEvent.ProfileConfirmed, { source: 'profile_setup' });
    } catch (err) {
      // First-run name capture gates entry to the whole app. A silent
      // failure here strands the user on this screen with no feedback —
      // surface the error so they know to retry.
      if (__DEV__) console.warn('[profileSetup] save failed', err);
      const code =
        typeof (err as { code?: unknown })?.code === 'string'
          ? ((err as { code: string }).code)
          : '';
      logEvent(AnalyticsEvent.ProfileSaveFailed, { source: 'profile_setup', code });
      // A reserved brand name is a choice the user can fix, not a failure —
      // say which one it is instead of the generic "save failed".
      appAlert(
        he.error,
        (err as Error)?.message === 'RESERVED_NAME'
          ? he.officialNameTaken
          : (err as Error)?.message === 'EMAIL_NAME'
            ? he.emailNameNotAllowed
            : he.profileSaveError,
      );
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const previewUser = user ? { ...user, name: name.trim() || user.name, avatarId, photoUrl } : null;
  const featuredIds = avatarId && !FEATURED.includes(avatarId)
    ? [...FEATURED.slice(0, 3), avatarId] : FEATURED;
  const choices = expanded ? AVATARS : featuredIds.map(id => getAvatarById(id)!);
  const canBack = !!onClose || nav.canGoBack();

  return <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollSurface keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View pointerEvents="none" style={styles.pitch} accessible={false}>
          <Svg width={130} height={100} viewBox="0 0 100 64">
            <Rect x={2} y={2} width={96} height={60} fill="none" stroke="#D7E6FA" strokeWidth={1}/>
            <Path d="M50 2V62M2 19H17V45H2M98 19H83V45H98" fill="none" stroke="#D7E6FA" strokeWidth={1}/>
            <Circle cx={50} cy={32} r={11} fill="none" stroke="#D7E6FA" strokeWidth={1}/>
          </Svg>
        </View>
        <View style={styles.header}>
          {canBack && <Pressable onPress={() => onClose ? onClose() : nav.goBack()} disabled={locked} accessibilityRole="button" accessibilityLabel="חזרה" style={styles.back}><Ionicons name="chevron-forward" size={27} color="#0B1942"/></Pressable>}
          <Text style={styles.headerTitle}>כרטיס השחקן שלך</Text>
        </View>
        <Text style={styles.title}>איך קוראים לך על המגרש?</Text>
        <Text style={styles.subtitle}>זה השם שיראו שחקנים אחרים באפליקציה</Text>
        <View style={styles.card}>
          <Pressable onPress={handlePickPhoto} disabled={locked} accessibilityRole="button" accessibilityLabel="העלאת תמונת פרופיל" style={styles.portrait}>
            <UserAvatar user={previewUser} size={124} />
          </Pressable>
          <Pressable onPress={handlePickPhoto} disabled={locked} accessibilityRole="button" accessibilityState={{ disabled: locked, busy: uploading }} style={styles.upload}>
            <Text style={styles.uploadText}>{uploading ? 'מעלה תמונה…' : 'העלאת תמונה'}</Text><Ionicons name="camera" size={23} color={BLUE}/>
          </Pressable>
          <View style={styles.divider}><View style={styles.line}/><Text style={styles.dividerText}>או בחרו דמות מהמבחר</Text><View style={styles.line}/></View>
          <View style={styles.grid}>
            {choices.map((avatar) => {
              const selected = !photoUrl && avatarId === avatar.id;
              return <View key={avatar.id} style={styles.cell}>
                <Pressable onPress={() => handlePickAvatar(avatar.id)} disabled={locked} accessibilityRole="radio" accessibilityLabel={`דמות ${AVATARS.findIndex(a => a.id === avatar.id) + 1}`} accessibilityState={{ checked: selected, disabled: locked }} style={[styles.avatar, selected && styles.selected]}>
                  <UserAvatar user={{ id: avatar.id, name: '', avatarId: avatar.id }} size={58}/>
                  {selected && <View style={styles.check}><Ionicons name="checkmark" size={13} color="#FFFFFF"/></View>}
                </Pressable>
              </View>;
            })}
          </View>
          <Pressable onPress={() => setExpanded(v => !v)} disabled={locked} accessibilityRole="button" accessibilityState={{ expanded }} style={styles.all}>
            <Text style={styles.allText}>{expanded ? 'הצג פחות' : 'לכל הדמויות'}</Text>
          </Pressable>
          <View style={styles.labelRow}><Ionicons name="person-outline" size={22} color="#0B1942"/><Text style={styles.label}>השם שלך</Text></View>
          <TextInput value={name} onChangeText={setName} editable={!locked} placeholder={he.profileNamePlaceholder} placeholderTextColor="#7B8AA5" maxLength={40} autoComplete="name" textContentType="name" returnKeyType="done" onSubmitEditing={handleSave} accessibilityLabel="השם שלך, שדה חובה" style={styles.input}/>
        </View>
        <Pressable onPress={handleSave} disabled={!canSave} accessibilityRole="button" accessibilityState={{ disabled: !canSave, busy }} style={({pressed}) => [styles.cta, (!canSave || pressed) && styles.dim]}>
          {busy ? <ActivityIndicator color="#FFFFFF"/> : <><Text style={styles.ctaText}>יאללה, למגרש</Text><Ionicons name="football" size={25} color="#FFFFFF"/></>}
        </Pressable>
      </ScrollSurface>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2F7FE' },
  flex: { flex: 1 },
  content: { padding: 18, paddingBottom: 30, flexGrow: 1 },
  pitch: { position: 'absolute', end: -30, top: 0, transform: [{rotate: '10deg'}] },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 26, minHeight: 44 },
  back: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#0B1942', fontSize: 21, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  title: { color: '#0B1942', fontSize: 26, fontWeight: '900', textAlign: 'center' },
  subtitle: { color: '#5C6F92', fontSize: 15, textAlign: 'center', marginTop: 8, marginBottom: 24 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 27, borderWidth: 1, borderColor: '#E0ECFC', padding: 16, shadowColor: '#B2CBEA', shadowOffset: {width: 0,height: 6}, shadowOpacity: 0.15, shadowRadius: 16, elevation: 2 },
  portrait: { alignSelf: 'center', borderRadius: 70, padding: 3, borderWidth: 2, borderColor: '#D6E7FD', marginTop: 4 },
  camera: { position: 'absolute', start: -4, bottom: 1, width: 39, height: 39, backgroundColor: '#FFFFFF', borderColor: '#D6E4F6', borderWidth: 1, borderRadius: 22, alignItems: 'center', justifyContent: 'center', elevation: 2 },
  upload: { alignSelf: 'center', flexDirection: 'row', gap: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: BLUE, borderRadius: 13, paddingHorizontal: 18, minHeight: 44, marginTop: 13 },
  uploadText: { fontSize: 16, fontWeight: '700', color: BLUE },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18, marginBottom: 14 },
  line: { height: 1, backgroundColor: '#D5E2F5', flex: 1 },
  dividerText: { fontSize: 14, fontWeight: '600', color: '#5C6F92' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  cell: { width: '24%', alignItems: 'center' },
  avatar: { borderRadius: 36, borderColor: '#DCE9FA', borderWidth: 1.5, padding: 2 },
  selected: { borderColor: BLUE, borderWidth: 2.5, padding: 1 },
  check: { position: 'absolute', start: -2, bottom: -2, width: 21, height: 21, borderRadius: 12, backgroundColor: BLUE, borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  all: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', marginTop: 5, marginBottom: 12 },
  allText: { color: BLUE, fontSize: 16, fontWeight: '700', textDecorationLine: 'underline' },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  label: { fontSize: 17, fontWeight: '700', color: '#0B1942', textAlign: RTL_LABEL_ALIGN },
  input: { minHeight: 50, backgroundColor: '#F4F8FD', borderRadius: 14, borderWidth: 1, borderColor: '#D0DEF2', paddingHorizontal: 14, color: '#0B1942', fontSize: 18, fontWeight: '600', textAlign: 'right' },
  cta: { flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: BLUE, borderRadius: 18, minHeight: 56, paddingHorizontal: 14, marginTop: 17 },
  ctaText: { fontSize: 20, fontWeight: '800', color: '#FFFFFF' },
  dim: { opacity: 0.6 },
});
