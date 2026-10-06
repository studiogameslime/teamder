// ContextualAuthSheet — "one more step and you're in", at the moment it is true.
//
// Replaces the `appAlert` that `guestGate` used to raise. That was a generic
// dialog saying "נדרשת הרשמה" whatever the person had been doing, and its
// confirm button SIGNED THEM OUT — which swapped the navigator, unmounted the
// screen and lost the context the wall was about.
//
// ─── Reuse, not a new design language ────────────────────────────────────
//
// `SpringSheet` is the repo's bottom-sheet animation (ConfirmDialog,
// ScreenshotReportSheet, CommunityFilterSheet all use it). The provider rows
// are the same Pressable + Ionicons + ACCENT composition as `SignInScreen`, so
// the buttons a person meets here are the buttons they would have met there.
// Nothing new is invented: light ground, white card, brand blue, existing type.

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SpringSheet } from '@/components/anim/SpringSheet';
import { colors, radius, spacing, typography } from '@/theme';
import { RTL_LABEL_ALIGN } from '@/theme/rtl';
import { he } from '@/i18n/he';
import type { PendingActionKind } from '@/services/pendingAction';
import { upgradeAnonymous, type AuthMethod, type UpgradeOutcome } from '@/services/authUpgrade';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { isAppleSignInAvailable } from '@/firebase/auth';
import { useUserStore } from '@/store/userStore';

const ACCENT = '#3B82F6';

/**
 * Why we are asking.
 *
 * Usually the action being gated. `account_upgrade` is the one reason that is
 * NOT an action: the person tapped "register" with nothing waiting to be
 * finished. It deliberately does not become a PendingActionKind — there is no
 * pending action, and inventing one would mean a resumer with nothing to
 * resume and a stash that outlives the sheet.
 */
export type AuthPromptReason = PendingActionKind | 'account_upgrade';

/** Title + body per reason. Exhaustive over the union so a new kind is a
 *  compile error here rather than a sheet that says nothing useful. */
const COPY: Record<AuthPromptReason, { title: string; body: string }> = {
  account_upgrade: { title: he.ctxAuthUpgradeTitle, body: he.ctxAuthUpgradeBody },
  join_game: { title: he.ctxAuthJoinGameTitle, body: he.ctxAuthJoinGameBody },
  join_club: { title: he.ctxAuthJoinClubTitle, body: he.ctxAuthJoinClubBody },
  apply_filler: {
    title: he.ctxAuthApplyFillerTitle,
    body: he.ctxAuthApplyFillerBody,
  },
  create_club: { title: he.ctxAuthCreateClubTitle, body: he.ctxAuthCreateClubBody },
  create_game: { title: he.ctxAuthCreateGameTitle, body: he.ctxAuthCreateGameBody },
  save_availability: {
    title: he.ctxAuthAvailabilityTitle,
    body: he.ctxAuthAvailabilityBody,
  },
  // Navigate-only kinds never reach a wall; present for exhaustiveness.
  open_game: { title: he.ctxAuthGenericTitle, body: he.ctxAuthGenericBody },
  open_club: { title: he.ctxAuthGenericTitle, body: he.ctxAuthGenericBody },
  open_invite: { title: he.ctxAuthGenericTitle, body: he.ctxAuthGenericBody },
};

interface Props {
  visible: boolean;
  kind: AuthPromptReason;
  /**
   * Say something other than `COPY[kind]`.
   *
   * One caller needs it: "התחברות לחשבון קיים" on the entry screen. Its
   * `kind` is `account_upgrade` — the same authentication, the same outcome
   * handling — but that kind's line is "פותחים לך חשבון", and answering
   * somebody who just said they HAVE an account by offering to open one is a
   * contradiction on the one screen where it matters most.
   *
   * An override rather than a new kind: `AuthPromptReason` is
   * `PendingAction['kind']`, and this action deliberately parks no pending
   * action, so it has no business widening that union. An override rather
   * than a second sheet, because everything below the two lines — the
   * providers, the cancel, the outcome, the email hand-off — must stay the
   * one implementation.
   *
   * Omitted everywhere else, and `COPY[kind]` is untouched.
   */
  copy?: { title: string; body: string };
  /** Whether to say "what you filled in is saved" — true for the form kinds,
   *  where leaving the screen is the thing somebody is afraid of. */
  hasDraft?: boolean;
  /** Backed out. The caller keeps the pending action and stays put. */
  onCancel: () => void;
  /** Authenticated. `isNewAccount` decides whether a profile confirmation is
   *  owed before the action resumes. */
  onAuthenticated: (r: { uid: string; isNewAccount: boolean }) => void;
}

export function ContextualAuthSheet({
  visible,
  kind,
  copy: copyOverride,
  hasDraft,
  onCancel,
  onAuthenticated,
}: Props) {
  const nav = useNavigation<{ navigate: (s: string) => void }>();
  // The app is edge-to-edge on Android, so a Modal draws UNDER the system
  // navigation bar. Without this the cancel row sits behind the gesture pill.
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<AuthMethod | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appleOk, setAppleOk] = useState(Platform.OS === 'ios');

  React.useEffect(() => {
    if (Platform.OS !== 'ios') return;
    void isAppleSignInAvailable().then(setAppleOk);
  }, []);

  // Announce ONCE per appearance, not per attempt. Two cancelled tries at the
  // same intent are two attempts on one prompt, and counting them as two
  // prompts would read as two different people wanting two different things.
  React.useEffect(() => {
    if (!visible) return;
    logEvent(AnalyticsEvent.AuthPromptShown, { action_kind: kind, has_draft: !!hasDraft });
    setError(null);
  }, [visible, kind, hasDraft]);

  const attempt = async (method: AuthMethod) => {
    if (busy) return;
    setError(null);
    logEvent(AnalyticsEvent.AuthMethodSelected, { action_kind: kind, auth_method: method });

    // Email is a screen, not a sheet: it needs two fields, validation and a
    // reset path, and `EmailAuthScreen` already has all three. The pending
    // action is already persisted, so the resume happens when that screen's
    // sign-in lands — the sheet's job is done the moment it hands over.
    if (method === 'email') {
      onCancel();
      nav.navigate('EmailAuth');
      return;
    }

    setBusy(method);
    let outcome: UpgradeOutcome;
    try {
      outcome = await upgradeAnonymous(method);
    } finally {
      setBusy(null);
    }

    if (outcome.status === 'cancelled') {
      // NOT a failure. Nothing is lost, nothing is said, and the sheet closes
      // so it cannot sit there implying the app is waiting on something.
      logEvent(AnalyticsEvent.AuthCancelled, { action_kind: kind, auth_method: method });
      onCancel();
      return;
    }
    if (outcome.status === 'failed') {
      logEvent(AnalyticsEvent.AuthFailed, {
        action_kind: kind,
        auth_method: method,
        code: outcome.code,
      });
      // Stay open, in context, with a retry available. Navigating away here is
      // how somebody loses a half-filled form to a flaky network.
      setError(outcome.message || he.ctxAuthFailed);
      return;
    }

    // `required_profile` is read from the GATE, not inferred from
    // `is_existing_account`. They are close but not the same: a linked account
    // always owes a profile, while an existing one usually does not — unless it
    // predates `onboardingCompleted`, in which case it does. Deriving one from
    // the other would quietly mislabel exactly those accounts.
    const requiredProfile = !useUserStore.getState().hasCompletedOnboarding();
    logEvent(AnalyticsEvent.AuthCompleted, {
      action_kind: kind,
      auth_method: method,
      is_existing_account: outcome.status === 'switched',
      required_profile: requiredProfile,
    });
    onAuthenticated({ uid: outcome.uid, isNewAccount: outcome.isNewAccount });
  };

  const copy = copyOverride ?? COPY[kind];

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onCancel}>
      <SpringSheet
        visible={visible}
        onBackdropPress={busy ? undefined : onCancel}
        // `panelBottom` is a BOX from 10% down to the bottom edge, not a
        // bottom-anchored row — it sets `top:'10%'` so children with a
        // percentage height have something to resolve against (the filter
        // sheets rely on that). A card sized by its content therefore lands at
        // the TOP of that box, which is why this sheet rendered over the header
        // with the dim showing underneath it. `flex-end` pushes it back down.
        //
        // Done here rather than in SpringSheet because the same box is shared
        // by every sheet in the app, and several of them have not been looked
        // at in this round.
        panelStyle={{ justifyContent: 'flex-end' }}
      >
        <View style={[styles.sheet, { paddingBottom: spacing.xl + insets.bottom }]}>
          <View style={styles.handle} />

          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.body}>{copy.body}</Text>

          <View style={styles.actions}>
            <ProviderButton
              icon="logo-google"
              label={he.signInGoogle}
              busy={busy === 'google'}
              disabled={!!busy}
              onPress={() => void attempt('google')}
            />
            {Platform.OS === 'ios' && appleOk ? (
              <ProviderButton
                icon="logo-apple"
                label={he.signInApple}
                busy={busy === 'apple'}
                disabled={!!busy}
                onPress={() => void attempt('apple')}
              />
            ) : null}
            <ProviderButton
              icon="mail-outline"
              label={he.signInEmail}
              busy={false}
              disabled={!!busy}
              onPress={() => void attempt('email')}
            />
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {hasDraft ? <Text style={styles.reassure}>{he.ctxAuthReassure}</Text> : null}

          <Pressable
            onPress={busy ? undefined : onCancel}
            disabled={!!busy}
            style={({ pressed }) => [styles.cancel, pressed && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel={he.cancel}
          >
            <Text style={styles.cancelText}>{he.cancel}</Text>
          </Pressable>
        </View>
      </SpringSheet>
    </Modal>
  );
}

/** The same composition as SignInScreen's rows — icon + label, ACCENT on a
 *  white card. Kept local because it is three lines and sharing it would mean
 *  touching the sign-in screen, which is out of scope. */
function ProviderButton({
  icon,
  label,
  busy,
  disabled,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.ctaBtn,
        pressed && { opacity: 0.92 },
        disabled && { opacity: 0.6 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {busy ? (
        <ActivityIndicator color={ACCENT} />
      ) : (
        <>
          {/* Label FIRST in source order → rightmost under forceRTL, with the
              provider mark closing the row on its left (owner, 26.09). The
              icon used to lead, which put it on the right and pushed the
              sentence away from the edge the eye starts at. */}
          <Text style={styles.ctaText}>{label}</Text>
          <Ionicons name={icon} size={20} color={ACCENT} />
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  // ── Alignment ───────────────────────────────────────────────────────────
  //
  // `RTL_LABEL_ALIGN`, not `'right'`. Under `I18nManager.forceRTL(true)` — set
  // in App.tsx — RN reads `textAlign:'right'` as "end of paragraph", and the
  // end of an RTL paragraph is the visual LEFT. This sheet was written with
  // `'right'` plus `writingDirection:'rtl'`, which is the double-apply the
  // helper's own comment warns about, and it rendered every line of Hebrew
  // flush left while the 142 files that use the helper rendered right. Visual
  // QA caught it; the styles looked correct the whole time.
  title: {
    ...typography.h2,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
    marginBottom: spacing.xs,
  },
  body: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    marginBottom: spacing.lg,
  },
  actions: { gap: spacing.sm },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // The provider rows are centred by their container, so this one stays
  // 'center' — it is a button label, not a paragraph.
  ctaText: {
    ...typography.body,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  error: {
    ...typography.caption,
    color: colors.danger,
    textAlign: RTL_LABEL_ALIGN,
    marginTop: spacing.md,
  },
  reassure: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    marginTop: spacing.md,
  },
  cancel: { alignSelf: 'center', paddingVertical: spacing.md, marginTop: spacing.xs },
  cancelText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
