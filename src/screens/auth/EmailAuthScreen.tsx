// EmailAuthScreen — email + password sign-in / sign-up, reached from the
// "המשך עם מייל" button on SignInScreen. One screen toggles between the two
// modes; "שכחת סיסמה?" sends a reset email. On success the user store sets
// currentUser and RootNavigator routes onward (onboarding fills name/avatar,
// exactly like an Apple sign-in — the provider gives us neither).

import React, { useEffect, useRef, useState } from 'react';
import { useEntryStore } from '@/store/entryStore';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  type ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeKeyboardAvoidingView as KeyboardAvoidingView } from '@/components/SafeKeyboardAvoidingView';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { appAlert } from '@/components/AppDialog';
import { ScrollSurface } from '@/components/ScrollSurface';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { upgradeAnonymous } from '@/services/authUpgrade';
import { useUserStore } from '@/store/userStore';
import { EmailRegisteredWithProviderError } from '@/firebase/auth';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { logError } from '@/services/errorLog';
import { resumePendingAction } from '@/services/actionCoordinator';
import { reportResumeOutcome } from '@/services/resumeFeedback';
import { colors, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { AuthStackParamList } from '@/navigation/AuthStack';

const ACCENT = '#2861F4';

/** Four brand colours; vector stays crisp at native display density. */
function GoogleMark() {
  return <Svg width={25} height={25} viewBox="0 0 24 24" accessible={false}>
    <Path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.89-1.74 2.98-4.3 2.98-7.36Z"/>
    <Path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.42l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.81-1.76-5.6-4.13H3.05v2.59A10 10 0 0 0 12 22Z"/>
    <Path fill="#FBBC05" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.51H3.05a10 10 0 0 0 0 8.98L6.4 13.9Z"/>
    <Path fill="#EA4335" d="M12 5.97c1.47 0 2.79.5 3.82 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.95 5.51L6.4 10.1c.79-2.37 3-4.13 5.6-4.13Z"/>
  </Svg>;
}

type Nav = NativeStackNavigationProp<AuthStackParamList, 'EmailAuth'>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function EmailAuthScreen() {
  const nav = useNavigation<Nav>();
  useEffect(() => nav.addListener('beforeRemove', () => {
    logEvent(AnalyticsEvent.OnboardingInteraction, { action: 'email_screen_left', step: 'authentication' });
    // A real back gesture cancels this journey. Successful sign-in is handled
    // by RootNavigator before the old stack unmounts; do not clear its marker.
    const user = useUserStore.getState().currentUser;
    if (!user || user.isGuest) useEntryStore.getState().endExistingAccountAttempt();
  }), [nav]);
  const signInWithEmail = useUserStore((s) => s.signInWithEmail);
  const signUpWithEmail = useUserStore((s) => s.signUpWithEmail);
  const sendPasswordReset = useUserStore((s) => s.sendPasswordReset);

  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState<'google' | 'apple' | null>(null);
  const [resetting, setResetting] = useState(false);
  const inFlight = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (focusTimer.current) clearTimeout(focusTimer.current); }, []);

  const isSignUp = mode === 'signUp';
  const emailOk = EMAIL_RE.test(email.trim());
  const passwordOk = password.length >= 6;
  // Sign-up requires the confirmation to match. Only flag a mismatch once
  // the user has started typing the confirmation (avoids a premature error).
  const passwordsMatch = password === confirmPassword;
  const confirmError = isSignUp && confirmPassword.length > 0 && !passwordsMatch;
  const canSubmit =
    emailOk && passwordOk && (!isSignUp || passwordsMatch && confirmPassword.length > 0) && !busy;

  // Both the error dialog's "עבור להתחברות" action and the bottom toggle link
  // flip modes — route them through here so the switch is logged once.
  const switchMode = (to: 'signIn' | 'signUp', trigger: 'dialog' | 'link') => {
    logEvent(AnalyticsEvent.AuthModeSwitched, {
      to: to === 'signUp' ? 'signup' : 'signin',
      trigger,
    });
    setMode(to);
    setConfirmPassword('');
  };

  /**
   * Leave this screen and finish whatever was waiting behind the auth wall.
   *
   * Deliberately the same two steps, in the same order, that the sheet's own
   * `onAuthenticated` performs: the pending action is resumed through its
   * REGISTERED RESUMER — which asks the server fresh — and never by replaying
   * a caller's executor. `resumePendingAction` returns `none` when there is
   * nothing parked, which is the ordinary case for somebody who reached this
   * screen from the sign-in screen rather than from a wall.
   *
   * `currentUser` is already correct here: `signInWithEmail` sets it. That is
   * why this does not repeat the store refresh the sheet needs.
   */
  const finishParkedAction = async () => {
    if (nav.canGoBack()) nav.goBack();
    try {
      const out = await resumePendingAction();
      if (out.status === 'ran') reportResumeOutcome(out.kind, out.result);
    } catch (err) {
      logError('emailAuthResume', err, {});
    }
  };

  const submit = async () => {
    if (!canSubmit || inFlight.current) return;
    inFlight.current = true;
    logEvent(AnalyticsEvent.OnboardingInteraction, { action: 'email_submit_tapped', step: 'authentication', mode });
    setBusy(true);
    try {
      if (mode === 'signIn') {
        await signInWithEmail(email, password);
      } else {
        await signUpWithEmail(email, password);
      }
      // ── When this screen was opened BY the contextual auth sheet ──────────
      //
      // "המשך עם מייל" is the one provider the sheet does not handle itself:
      // it needs two fields, validation and a reset path, so it closes and
      // navigates here. The sheet is then unmounted, and its `onAuthenticated`
      // — which refreshes the store and resumes the parked action — never runs.
      //
      // Nothing picked that up. Signing in from a create-club or create-game
      // wall left the person looking at a cleared sign-in form, with the club
      // they had filled in still parked and nothing to finish it. The comment
      // that used to sit here said "RootNavigator swaps the stack", and for a
      // guest it does not: a guest is already inside MainTabs, so signing in
      // changes nothing about which tree is rendered and no one pops this
      // screen.
      //
      // A fresh account is the exception and is left alone: its user document
      // carries `onboardingCompleted: false`, RootNavigator DOES swap to the
      // profile screen, and the coordinator's boot pass resumes after it saves.
      if (mode === 'signIn' && useUserStore.getState().hasCompletedOnboarding()) {
        await finishParkedAction();
      }
    } catch (err) {
      handleAuthError(err);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const handleAuthError = (err: unknown) => {
    if (err instanceof EmailRegisteredWithProviderError) {
      logEvent(AnalyticsEvent.SignInProviderConflict, { provider: err.provider });
      appAlert(
        he.error,
        err.provider === 'google'
          ? he.emailAuthRegisteredWithGoogle
          : he.emailAuthRegisteredWithApple,
      );
      return;
    }
    const code = (err as { code?: string })?.code ?? '';
    logEvent(AnalyticsEvent.SignInFailed, {
      method: 'email',
      code,
      mode: mode === 'signUp' ? 'signup' : 'signin',
    });
    let msg: string = he.emailAuthGenericError;
    if (code === 'auth/invalid-email') msg = he.emailAuthInvalidEmail;
    else if (code === 'auth/weak-password') msg = he.emailAuthWeakPassword;
    else if (code === 'auth/email-already-in-use') {
      // The address is taken. Email-enumeration protection makes the
      // provider undetectable (fetchSignInMethodsForEmail returns []), so
      // the message covers both "you have an email account → sign in" and
      // "you used Google/Apple → use that button". Offer to flip to sign-in.
      appAlert(he.error, he.emailAuthAlreadyInUse, [
        { text: he.cancel, style: 'cancel' },
        { text: he.emailAuthSwitchToSignIn, onPress: () => switchMode('signIn', 'dialog') },
      ]);
      return;
    } else if (
      code === 'auth/wrong-password' ||
      code === 'auth/user-not-found' ||
      code === 'auth/invalid-credential'
    ) {
      msg = he.emailAuthWrongCredentials;
    } else if (code === 'auth/too-many-requests') {
      msg = he.emailAuthTooManyAttempts;
    } else if (code === 'auth/network-request-failed') {
      msg = he.signInNetworkError;
    } else {
      // Unknown — log it so it surfaces in the error panel for triage.
      logError('signInEmailScreen', err, { screen: 'EmailAuthScreen', mode, code });
    }
    if (__DEV__) console.warn('[emailAuth] failed', err);
    appAlert(he.error, msg);
  };

  const onForgotPassword = async () => {
    if (inFlight.current) return;
    if (!emailOk) {
      logEvent(AnalyticsEvent.PasswordResetRequested, {
        result: 'blocked',
        reason: 'invalid_email',
      });
      appAlert(he.error, he.emailAuthResetNeedEmail);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setResetting(true);
    const resetEmail = email.trim();
    try {
      await sendPasswordReset(resetEmail);
      logEvent(AnalyticsEvent.PasswordResetRequested, { result: 'sent' });
      appAlert(he.emailAuthResetSentTitle, he.emailAuthResetSentBody(resetEmail));
    } catch (err) {
      // Don't reveal whether the address exists — generic confirmation either
      // way is the safe default, but a network/invalid error is worth showing.
      const code = (err as { code?: string })?.code ?? '';
      if (code === 'auth/invalid-email') {
        logEvent(AnalyticsEvent.PasswordResetRequested, { result: 'failed', code });
        appAlert(he.error, he.emailAuthInvalidEmail);
      } else if (code === 'auth/network-request-failed') {
        logEvent(AnalyticsEvent.PasswordResetRequested, { result: 'failed', code });
        appAlert(he.error, he.signInNetworkError);
      } else {
        // user-not-found etc. → still show "sent" so we don't leak accounts.
        logEvent(AnalyticsEvent.PasswordResetRequested, { result: 'sent', code });
        appAlert(he.emailAuthResetSentTitle, he.emailAuthResetSentBody(resetEmail));
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
      setResetting(false);
    }
  };

  // Use the same credential-linking path as the contextual sign-in sheet.
  // New profiles stay with RootNavigator; only completed profiles resume an action.
  const onProvider = async (method: 'google' | 'apple') => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setProvider(method);
    logEvent(AnalyticsEvent.SignInAttempted, { method });
    try {
      const outcome = await upgradeAnonymous(method);
      if (outcome.status === 'cancelled') {
        logEvent(AnalyticsEvent.SignInCancelled, { method });
      } else if (outcome.status === 'failed') {
        logEvent(AnalyticsEvent.SignInFailed, { method, code: outcome.code });
        appAlert(he.error, /network|unavailable|offline/i.test(outcome.code) ? he.signInNetworkError : he.signInFailed);
      } else {
        await useUserStore.getState().refreshFromSession(outcome.uid);
        logEvent(AnalyticsEvent.SignInSuccess, { method });
        if (useUserStore.getState().hasCompletedOnboarding()) await finishParkedAction();
      }
    } catch (err) {
      // refreshFromSession keeps a failed profile restore retryable at the root.
      appAlert(he.error, he.signInFailed);
    } finally {
      inFlight.current = false;
      setBusy(false);
      setProvider(null);
    }
  };

  const fieldLabel = (text: string, icon: keyof typeof Ionicons.glyphMap) => (
    <View style={styles.labelRow}><Ionicons name={icon} size={20} color="#53678D" /><Text style={styles.label}>{text}</Text></View>
  );
  const passwordField = (confirmation = false) => (
    <View style={[styles.passwordRow, confirmation && confirmError && styles.inputError]}>
      <TextInput
        onFocus={() => {
          // Wait for the IME resize before exposing the last field and submit.
          if (focusTimer.current) clearTimeout(focusTimer.current);
          if (confirmation) focusTimer.current = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 350);
        }}
        value={confirmation ? confirmPassword : password}
        onChangeText={confirmation ? setConfirmPassword : setPassword}
        placeholder={confirmation ? he.emailAuthConfirmPasswordPlaceholder : he.emailAuthPasswordPlaceholder}
        accessibilityLabel={confirmation ? he.emailAuthConfirmPasswordLabel : he.emailAuthPasswordLabel}
        placeholderTextColor="#6D7E9E" secureTextEntry={!showPassword}
        editable={!busy} autoCapitalize="none" autoCorrect={false}
        autoComplete={isSignUp ? 'password-new' : 'password'}
        textContentType={isSignUp ? 'newPassword' : 'password'}
        style={styles.passwordInput} textAlign="right"
      />
      <Pressable onPress={() => {
        logEvent(AnalyticsEvent.OnboardingInteraction, { action: confirmation ? 'confirmation_visibility_toggled' : 'password_visibility_toggled', step: 'authentication' });
        setShowPassword(v => !v);
      }} hitSlop={8} style={styles.eyeBtn} accessibilityRole="button" accessibilityLabel={showPassword ? 'הסתר סיסמה' : 'הצג סיסמה'}>
        <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={23} color="#53678D" />
      </Pressable>
    </View>
  );

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => nav.canGoBack() && nav.goBack()} hitSlop={8} style={styles.back} accessibilityRole="button" accessibilityLabel="חזרה">
          <Ionicons name="chevron-forward" size={25} color="#0B1A47" />
          <Text style={styles.headerTitle}>{isSignUp ? 'הרשמה' : 'התחברות'}</Text>
        </Pressable>
        <View style={styles.brand}><Text style={styles.brandName}>Teamder</Text><Ionicons name="football" color={ACCENT} size={25} /></View>
        <View style={styles.headerSpacer} />
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollSurface ref={scrollRef} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
          <View pointerEvents="none" style={styles.pitch} accessible={false}>
            <Svg width={150} height={110} viewBox="0 0 185 145">
              <Rect x={2} y={2} width={180} height={136} fill="none" stroke="#D8E7F9" strokeWidth={1.5}/>
              <Line x1={92} y1={2} x2={92} y2={138} stroke="#D8E7F9" strokeWidth={1.5}/>
              <Circle cx={92} cy={70} r={27} fill="none" stroke="#D8E7F9" strokeWidth={1.5}/>
              <Circle cx={92} cy={70} r={2} fill="#D8E7F9"/>
              <Rect x={2} y={35} width={27} height={70} fill="none" stroke="#D8E7F9" strokeWidth={1.5}/>
              <Rect x={155} y={35} width={27} height={70} fill="none" stroke="#D8E7F9" strokeWidth={1.5}/>
            </Svg>
          </View>
          <View style={styles.hero}>
            <Image source={require('../../assets/images/form-toggle-football-3d.png')} style={styles.ball} resizeMode="contain" accessible={false}/>
            <Text style={styles.heroTitle}>{isSignUp ? 'מצטרפים למגרש' : 'טוב שחזרת למגרש'}</Text>
            <Text style={styles.subtitle}>{isSignUp ? 'פותחים חשבון ומתחילים לשחק' : 'נכנסים לחשבון וממשיכים לשחק'}</Text>
          </View>
          <View style={styles.card}>
            <View style={styles.tabs} accessibilityRole="tablist">
              {(['signIn', 'signUp'] as const).map(tab => <Pressable key={tab} onPress={() => switchMode(tab, 'link')} disabled={busy} accessibilityRole="tab" accessibilityState={{ selected: mode === tab, disabled: busy }} style={[styles.tab, mode === tab && styles.activeTab]}>
                <Text style={[styles.tabText, mode === tab && styles.activeTabText]}>{tab === 'signIn' ? 'כניסה' : 'הרשמה'}</Text>
              </Pressable>)}
            </View>
            {fieldLabel('כתובת דואר אלקטרוני', 'mail-outline')}
            <TextInput value={email} onChangeText={setEmail} placeholder="name@example.com" accessibilityLabel={he.emailAuthEmailLabel} placeholderTextColor="#6D7E9E" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" editable={!busy} style={styles.input} textAlign="right" />
            {fieldLabel(he.emailAuthPasswordLabel, 'lock-closed-outline')}
            {passwordField()}
            {isSignUp && <>{fieldLabel(he.emailAuthConfirmPasswordLabel, 'lock-closed-outline')}{passwordField(true)}{confirmError && <Text style={styles.errorText}>{he.emailAuthPasswordMismatch}</Text>}</>}
            {!isSignUp && <Pressable onPress={onForgotPassword} disabled={busy} hitSlop={8} style={styles.forgot} accessibilityRole="button" accessibilityLabel={he.emailAuthForgot} accessibilityState={{ disabled: busy, busy: resetting }}>{resetting ? <ActivityIndicator color={ACCENT}/> : <Text style={styles.forgotText}>{he.emailAuthForgot}</Text>}</Pressable>}
            <Pressable onPress={submit} disabled={!canSubmit} accessibilityRole="button" accessibilityState={{ disabled: !canSubmit, busy: busy && !provider }} style={({ pressed }) => [styles.cta, pressed && styles.pressed, !canSubmit && styles.ctaDisabled]}>
              {busy && !provider && !resetting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.ctaText}>{isSignUp ? 'יצירת חשבון' : 'כניסה לחשבון'}</Text>}
            </Pressable>
            <View style={styles.divider}><View style={styles.line}/><Text style={styles.dividerText}>או באמצעות</Text><View style={styles.line}/></View>
            <View style={styles.providers}>
              {(['google', ...(Platform.OS === 'ios' ? ['apple'] as const : [])] as const).map(method => <Pressable key={method} onPress={() => onProvider(method)} disabled={busy} accessibilityRole="button" accessibilityLabel={method === 'google' ? he.signInGoogle : he.signInApple} accessibilityState={{ disabled: busy, busy: provider === method }} style={({ pressed }) => [styles.provider, pressed && styles.pressed]}>
                {provider === method ? <ActivityIndicator color={ACCENT}/> : <><Text style={styles.providerText}>{method === 'google' ? 'גוגל' : 'אפל'}</Text>{method === 'google' ? <GoogleMark/> : <Ionicons name="logo-apple" size={25} color="#111111"/>}</>}
              </Pressable>)}
            </View>
            <View style={styles.privacy}><Ionicons name="shield-checkmark-outline" size={20} color="#64779A"/><Text style={styles.privacyText}>הפרטים שלך נשארים מוגנים</Text></View>
          </View>
        </ScrollSurface>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2F7FE' },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 12 },
  back: { flex: 1, flexDirection: 'row', gap: 4, alignItems: 'center', minHeight: 44 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#0B1A47' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  brandName: { fontSize: 25, fontWeight: '900', color: ACCENT },
  headerSpacer: { flex: 1 },
  body: { paddingHorizontal: 22, paddingBottom: 28, flexGrow: 1 },
  pitch: { position: 'absolute', end: -32, top: 0, transform: [{ rotate: '17deg' }] },
  hero: { alignItems: 'center', paddingTop: 5, paddingBottom: 22 },
  ball: { width: 104, height: 104, marginBottom: 6 },
  heroTitle: { fontSize: 29, fontWeight: '900', color: '#091943', textAlign: 'center' },
  subtitle: { fontSize: 17, color: '#5C6E91', textAlign: 'center', marginTop: 5 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 28, padding: 18, shadowColor: '#ACC7EC', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.16, shadowRadius: 22, elevation: 2 },
  tabs: { flexDirection: 'row', backgroundColor: '#F0F6FE', borderRadius: 19, padding: 3, marginBottom: 8 },
  tab: { flex: 1, minHeight: 48, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  activeTab: { backgroundColor: ACCENT },
  tabText: { fontSize: 19, fontWeight: '800', color: '#163566' },
  activeTabText: { color: '#FFFFFF' },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 17, marginBottom: 8 },
  label: { fontSize: 15, color: '#0B1A47', fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  input: { height: 48, backgroundColor: '#F7F9FD', borderRadius: 11, borderWidth: 1, borderColor: '#CDDAED', paddingHorizontal: 13, color: '#0B1A47', ...typography.body },
  passwordRow: { flexDirection: 'row', alignItems: 'center', height: 48, backgroundColor: '#F7F9FD', borderRadius: 11, borderWidth: 1, borderColor: '#CDDAED' },
  passwordInput: { flex: 1, height: '100%', paddingHorizontal: 13, color: '#0B1A47', ...typography.body },
  eyeBtn: { minWidth: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  inputError: { borderColor: colors.danger },
  errorText: { ...typography.caption, color: colors.danger, textAlign: RTL_LABEL_ALIGN, marginTop: 5 },
  forgot: { alignSelf: 'flex-start', paddingVertical: 12, minHeight: 44 },
  forgotText: { fontSize: 14, color: ACCENT, textDecorationLine: 'underline' },
  cta: { marginTop: 10, backgroundColor: ACCENT, borderRadius: 15, minHeight: 54, alignItems: 'center', justifyContent: 'center' },
  ctaDisabled: { backgroundColor: '#4B78E8' },
  ctaText: { color: '#FFFFFF', fontSize: 19, fontWeight: '800' },
  pressed: { opacity: 0.8 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 23 },
  line: { flex: 1, height: 1, backgroundColor: '#CDDAED' },
  dividerText: { fontSize: 14, color: '#64779A' },
  providers: { flexDirection: 'row', gap: 12 },
  provider: { flex: 1, flexDirection: 'row', minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: 12, borderRadius: 12, borderWidth: 1, borderColor: '#CDDAED' },
  providerText: { fontSize: 18, fontWeight: '700', color: '#0B1A47' },
  privacy: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 26, marginBottom: 6 },
  privacyText: { fontSize: 12, color: '#64779A' },
});
