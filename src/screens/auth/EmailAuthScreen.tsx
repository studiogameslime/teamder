// EmailAuthScreen — email + password sign-in / sign-up, reached from the
// "המשך עם מייל" button on SignInScreen. One screen toggles between the two
// modes; "שכחת סיסמה?" sends a reset email. On success the user store sets
// currentUser and RootNavigator routes onward (onboarding fills name/avatar,
// exactly like an Apple sign-in — the provider gives us neither).

import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { appAlert } from '@/components/AppDialog';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useUserStore } from '@/store/userStore';
import { EmailRegisteredWithProviderError } from '@/firebase/auth';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { logError } from '@/services/errorLog';
import { resumePendingAction } from '@/services/actionCoordinator';
import { reportResumeOutcome } from '@/services/resumeFeedback';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { AuthStackParamList } from '@/navigation/AuthStack';

const ACCENT = '#1E40AF';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'EmailAuth'>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function EmailAuthScreen() {
  const nav = useNavigation<Nav>();
  const signInWithEmail = useUserStore((s) => s.signInWithEmail);
  const signUpWithEmail = useUserStore((s) => s.signUpWithEmail);
  const sendPasswordReset = useUserStore((s) => s.sendPasswordReset);

  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

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
    if (!canSubmit) return;
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
      if (mode === 'signIn') {
        await finishParkedAction();
      }
    } catch (err) {
      handleAuthError(err);
    } finally {
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
    if (!emailOk) {
      logEvent(AnalyticsEvent.PasswordResetRequested, {
        result: 'blocked',
        reason: 'invalid_email',
      });
      appAlert(he.error, he.emailAuthResetNeedEmail);
      return;
    }
    try {
      await sendPasswordReset(email);
      logEvent(AnalyticsEvent.PasswordResetRequested, { result: 'sent' });
      appAlert(he.emailAuthResetSentTitle, he.emailAuthResetSentBody(email.trim()));
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
        appAlert(he.emailAuthResetSentTitle, he.emailAuthResetSentBody(email.trim()));
      }
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader
        title={isSignUp ? he.emailAuthSignUpTitle : he.emailAuthSignInTitle}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.body}>
          <Text style={styles.label}>{he.emailAuthEmailLabel}</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder={he.emailAuthEmailPlaceholder}
            placeholderTextColor={colors.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            style={styles.input}
            textAlign="right"
          />

          <Text style={styles.label}>{he.emailAuthPasswordLabel}</Text>
          <View style={styles.passwordRow}>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder={he.emailAuthPasswordPlaceholder}
              placeholderTextColor={colors.textMuted}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete={isSignUp ? 'password-new' : 'password'}
              textContentType={isSignUp ? 'newPassword' : 'password'}
              style={[styles.input, styles.passwordInput]}
              textAlign="right"
            />
            <Pressable
              onPress={() => setShowPassword((v) => !v)}
              hitSlop={8}
              style={styles.eyeBtn}
              accessibilityLabel={showPassword ? 'הסתר סיסמה' : 'הצג סיסמה'}
            >
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={20}
                color={colors.textMuted}
              />
            </Pressable>
          </View>

          {/* Sign-up only: re-enter the password to catch typos. Shares the
              same show/hide eye state as the password above. */}
          {isSignUp ? (
            <>
              <Text style={styles.label}>{he.emailAuthConfirmPasswordLabel}</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder={he.emailAuthConfirmPasswordPlaceholder}
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="password-new"
                  textContentType="newPassword"
                  style={[
                    styles.input,
                    styles.passwordInput,
                    confirmError && styles.inputError,
                  ]}
                  textAlign="right"
                />
                <Pressable
                  onPress={() => setShowPassword((v) => !v)}
                  hitSlop={8}
                  style={styles.eyeBtn}
                  accessibilityLabel={showPassword ? 'הסתר סיסמה' : 'הצג סיסמה'}
                >
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color={colors.textMuted}
                  />
                </Pressable>
              </View>
              {confirmError ? (
                <Text style={styles.errorText}>{he.emailAuthPasswordMismatch}</Text>
              ) : null}
            </>
          ) : null}

          {!isSignUp ? (
            <Pressable onPress={onForgotPassword} hitSlop={8} style={styles.forgot}>
              <Text style={styles.forgotText}>{he.emailAuthForgot}</Text>
            </Pressable>
          ) : null}

          <Pressable
            onPress={submit}
            disabled={!canSubmit}
            style={({ pressed }) => [
              styles.cta,
              pressed && { opacity: 0.92 },
              !canSubmit && { opacity: 0.5 },
            ]}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.ctaText}>
                {isSignUp ? he.emailAuthSignUpCta : he.emailAuthSignInCta}
              </Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => {
              switchMode(isSignUp ? 'signIn' : 'signUp', 'link');
              setConfirmPassword('');
            }}
            hitSlop={8}
            style={styles.toggle}
          >
            <Text style={styles.toggleText}>
              {isSignUp ? he.emailAuthToggleToSignIn : he.emailAuthToggleToSignUp}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  body: { padding: spacing.lg, gap: spacing.sm },
  label: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
    marginTop: spacing.sm,
  },
  input: {
    height: 50,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    color: colors.text,
    ...typography.body,
  },
  passwordRow: { position: 'relative', justifyContent: 'center' },
  passwordInput: { paddingLeft: 44 },
  inputError: { borderColor: colors.danger },
  errorText: {
    ...typography.caption,
    color: colors.danger,
    textAlign: RTL_LABEL_ALIGN,
    marginTop: -2,
  },
  eyeBtn: {
    position: 'absolute',
    left: spacing.md,
    height: 50,
    justifyContent: 'center',
  },
  forgot: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
  forgotText: { ...typography.caption, color: ACCENT, fontWeight: '700' },
  cta: {
    marginTop: spacing.md,
    backgroundColor: ACCENT,
    borderRadius: 999,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
  toggle: { alignSelf: 'center', paddingVertical: spacing.md },
  toggleText: { ...typography.body, color: ACCENT, fontWeight: '700' },
});
