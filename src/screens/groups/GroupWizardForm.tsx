// Two-step wizard shared by Create / Edit Community (rolling-ball
// StepIndicator, mirroring the create-game flow):
//   • Step 1 "פרטים"  — name, city, contact phone, description, rules.
//   • Step 2 "מתקדם"  — open/private toggle, max members, internal-rating
//                        toggle (+ hide-rating), cards master toggle and
//                        (when on) the yellow/red validity fields.
// `revertSignal`/`revertToStep` are functional again: on a server-side
// rejection the host bumps the signal and the wizard jumps to the named
// step and re-syncs the listed fields (used for GROUP_MAX_BELOW_CURRENT →
// step 2, where the maxMembers field lives).
//
// Responsibility split:
//   • Community owns identity + membership behaviour ONLY. It is NOT
//     tied to a fixed field, format, schedule, or recurring config.
//     All those are per-Game settings now.
// All free fields are optional; name + city are enforced (phone valid if
// typed). The form is rendered identically in create and edit — the host
// screen wraps it with a different `submitLabel` and `initial` payload.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BallSwitch } from '@/components/anim/BallSwitch';
import { appAlert } from '@/components/AppDialog';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/Button';
import { InputField } from '@/components/InputField';
import { AutocompleteInput } from '@/components/AutocompleteInput';
import { InfoTip } from '@/components/InfoTip';
import { StepIndicator } from '@/components/StepIndicator';
import { RichRulesInput } from '@/components/community/RichRulesInput';
import { searchCities } from '@/services/israelLocationService';
import { isValidIsraeliPhone } from '@/services/whatsappService';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN, shadows } from '@/theme';
import { he } from '@/i18n/he';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';

const ACCENT = '#3B82F6';

export interface GroupFormValues {
  // Identity
  name: string;
  description: string;
  isOpen: boolean;
  /** Admins set player ratings themselves (vs. peer-voted). Stored as Group.internalRating. */
  internalRating: boolean;
  /** Hide the admins' ratings from regular members (admins-only signal). Only
   *  meaningful when `internalRating` is on. Stored as Group.hideInternalRating. */
  hideInternalRating: boolean;

  /** Master switch for the per-community cards feature (yellow/red). When off,
   *  admins can't issue cards and the validity fields are hidden. Stored on the
   *  group as cardsEnabled. */
  cardsEnabled: boolean;
  /** Card validity in days (as text; empty = no expiry). Stored on the group as
   *  yellow/redCardValidityDays. Yellow is display-only; an active red blocks
   *  registration. */
  yellowCardValidityDays: string;
  redCardValidityDays: string;

  // Info
  rules: string;
  contactPhone: string;
  city: string;
  /** Community-wide member cap. Stored as Group.maxMembers. */
  maxMembers: string;
}

export const EMPTY_GROUP_FORM_VALUES: GroupFormValues = {
  name: '',
  description: '',
  isOpen: false,
  internalRating: false,
  hideInternalRating: false,
  cardsEnabled: false,
  yellowCardValidityDays: '',
  redCardValidityDays: '',
  rules: '',
  contactPhone: '',
  city: '',
  maxMembers: '40',
};

interface Props {
  headerTitle: string;
  submitLabel: string;
  initial: GroupFormValues;
  onSubmit: (values: GroupFormValues) => Promise<void>;
  /**
   * Tick counter the parent bumps to force the wizard to revert
   * specific fields back to `initial` after a server-side rejection.
   * Used by CommunityEditScreen when `GROUP_MAX_BELOW_CURRENT` fires
   * — the form jumps back to step 2 and re-syncs `maxMembers` so the
   * user isn't stuck staring at the rejected number. Other fields
   * the user typed keep their values.
   */
  revertSignal?: number;
  /** Step (1 or 2) to surface when `revertSignal` ticks. */
  revertToStep?: 1 | 2;
  /**
   * Subset of GroupFormValues keys to revert. Only these fields are
   * pulled from `initial`; everything else is left as the user typed.
   */
  revertFields?: Array<keyof GroupFormValues>;
  /** Warn on leave when there are unsaved edits (edit flow only). */
  enableUnsavedGuard?: boolean;
}

export function GroupWizardForm({
  headerTitle,
  submitLabel,
  initial,
  onSubmit,
  revertSignal,
  revertToStep,
  revertFields,
  enableUnsavedGuard = false,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState<GroupFormValues>(initial);
  // Two-step wizard (rolling-ball indicator, like the create-game flow):
  // step 1 "פרטים" (identity/contact) + step 2 "מתקדם" (rating + cards).
  const [step, setStep] = useState<1 | 2>(1);

  // Unsaved-changes guard (edit flow): dirty = any field differs from initial.
  const savingRef = useRef(false);
  useUnsavedChangesGuard({
    isDirty:
      enableUnsavedGuard &&
      JSON.stringify(values) !== JSON.stringify(initial),
    savingRef,
    title: he.groupEditUnsavedTitle,
    body: he.groupEditUnsavedBody,
    onSave: async () => {
      savingRef.current = true;
      try {
        await onSubmit(values);
      } finally {
        savingRef.current = false;
      }
    },
  });

  // Parent-driven partial revert. Triggered by ticking `revertSignal`.
  // We deliberately ignore the first render (signal===undefined or 0
  // on mount) so the form doesn't snap back on initial display. Jumps
  // back to the requested step so the user lands on the rejected field.
  useEffect(() => {
    if (!revertSignal) return;
    if (revertToStep) setStep(revertToStep);
    if (revertFields && revertFields.length > 0) {
      setValues((s) => {
        const next = { ...s };
        for (const k of revertFields) {
          // Type-safe partial copy: each key/value pair stays aligned.
          (next as unknown as Record<string, unknown>)[k as string] = (
            initial as unknown as Record<string, unknown>
          )[k as string];
        }
        return next;
      });
    }
  }, [revertSignal, revertFields, initial]);

  const set = <K extends keyof GroupFormValues>(
    key: K,
    val: GroupFormValues[K],
  ) => setValues((s) => ({ ...s, [key]: val }));

  const fetchCities = useCallback((q: string) => searchCities(q), []);

  // Phone is now OPTIONAL (the community chat covers contact) — but if typed
  // it must be a valid Israeli number. City stays required.
  const phoneEntered = values.contactPhone.trim().length > 0;
  const phoneOk = !phoneEntered || isValidIsraeliPhone(values.contactPhone);
  const phoneError = phoneEntered && !phoneOk;
  const cityValid = values.city.trim().length > 0;

  const nameValid = values.name.trim().length > 0;
  // Everything required lives on step 1 (name + city; phone valid if typed).
  const step1Valid = nameValid && cityValid && phoneOk;
  const canSubmit = step1Valid && !busy;

  // Which required step-1 fields are still missing — surfaced under the
  // "המשך" button so a disabled button isn't a silent dead-end.
  const step1Missing: string[] = [];
  if (!nameValid) step1Missing.push(he.groupCreateName);
  if (!cityValid) step1Missing.push(he.createGroupCity);

  const goNext = () => {
    if (step === 1 && !step1Valid) return;
    if (step < 2) setStep(2);
  };
  const goBack = () => {
    if (step > 1) setStep(1);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    // Mark the save as intentional BEFORE onSubmit (which navigates back on
    // success) so the unsaved-changes guard doesn't pop "שינויים שלא נשמרו"
    // on the way out — the form values still differ from `initial` at that
    // point, so without this flag the guard mistakes a save for a discard.
    savingRef.current = true;
    try {
      await onSubmit(values);
    } catch (e) {
      savingRef.current = false; // save failed → still genuinely dirty
      if (__DEV__) console.warn('[groupWizard] submit failed', e);
      appAlert(he.error, he.groupWizardSubmitFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={headerTitle} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Pinned rolling-ball step indicator (same component as the
            create-game wizard). "פרטים" holds the everyday identity +
            contact fields; "מתקדם" holds the internal-rating + cards config
            so the create screen isn't a wall of options. */}
        <View style={styles.stickyHeader}>
          <StepIndicator
            current={step}
            labels={[he.groupFormTabDetails, he.groupFormTabAdvanced]}
          />
        </View>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.body}>
            {step === 1 ? (
              <>
                <InputField
                  label={he.groupCreateName}
                  value={values.name}
                  onChangeText={(v) => set('name', v)}
                  placeholder="לדוגמה: חמישי כדורגל"
                  required
                  maxLength={80}
                />
                <AutocompleteInput
                  label={he.createGroupCity}
                  required
                  value={values.city}
                  onChange={(v) => set('city', v)}
                  onSelect={(v) => set('city', v)}
                  placeholder={he.createGroupCityPlaceholder}
                  fetchSuggestions={fetchCities}
                />
                <View>
                  <InputField
                    label={he.createGroupContactPhone}
                    info={{ title: he.createGroupContactPhone, text: he.createGroupContactPhoneHint }}
                    value={values.contactPhone}
                    onChangeText={(v) => set('contactPhone', v)}
                    placeholder={he.createGroupContactPhonePlaceholder}
                    keyboardType="phone-pad"
                  />
                  {phoneError ? (
                    <Text style={styles.hintError}>
                      {he.createGroupContactPhoneInvalid}
                    </Text>
                  ) : null}
                </View>

                <InputField
                  label={he.createGroupDescription}
                  value={values.description}
                  onChangeText={(v) => set('description', v)}
                  multiline
                  maxLength={500}
                />

                {/* Code-of-conduct (rich text: **bold** + bullets). Stored
                    as the raw markdown-lite string; RichRulesText renders
                    it on the community details screen. */}
                <RichRulesInput
                  label={he.communityDetailsRules}
                  value={values.rules}
                  // Hard-cap at 2000 (the createGroup rule's limit) so a long rules
                  // block can't fail submission with "rules too long" (report nfn19l).
                  maxLength={2000}
                  onChangeText={(v) => set('rules', v.slice(0, 2000))}
                  placeholder={'לדוגמה:\n- מגיעים בזמן\n- **אסור** לעשן במגרש'}
                />
              </>
            ) : (
              <>
                {/* Open-join toggle — membership behaviour (auto-approve vs
                    admin gate). Lives in "מתקדם" alongside the other
                    membership/rating switches. */}
                <ToggleCard
                  label={he.createGroupIsOpen}
                  info={{ title: he.createGroupIsOpen, text: he.createGroupIsOpenHint }}
                  value={values.isOpen}
                  onValueChange={(v) => set('isOpen', v)}
                />

                {/* Community-wide member cap. Lives on step 2 so the
                    GROUP_MAX_BELOW_CURRENT revert (revertToStep={2}) lands on a
                    real field. Empty = no explicit cap (server default). */}
                <InputField
                  label={he.createGroupMaxMembers}
                  value={values.maxMembers}
                  onChangeText={(v) => set('maxMembers', v.replace(/[^0-9]/g, '').slice(0, 4))}
                  keyboardType="number-pad"
                  placeholder="40"
                />

                {/* Internal rating — admins set player skill levels themselves
                    instead of the peer-voting system. The chosen rating is what
                    the community / match-details surfaces display. */}
                <ToggleCard
                  label={he.createGroupInternalRating}
                  info={{
                    title: he.createGroupInternalRating,
                    text: he.createGroupInternalRatingHint,
                  }}
                  value={values.internalRating}
                  onValueChange={(v) => {
                    set('internalRating', v);
                    // Turning internal rating off makes "hide" meaningless — reset
                    // it so a stale `true` doesn't get persisted.
                    if (!v) set('hideInternalRating', false);
                  }}
                />

                {/* Hide-internal-rating — only relevant when internal rating is on.
                    Makes the admins' ratings private to admins (members see nothing). */}
                {values.internalRating ? (
                  <ToggleCard
                    label={he.createGroupHideInternalRating}
                    info={{
                      title: he.createGroupHideInternalRating,
                      text: he.createGroupHideInternalRatingHint,
                    }}
                    value={values.hideInternalRating}
                    onValueChange={(v) => set('hideInternalRating', v)}
                  />
                ) : null}

                {/* Cards master toggle — when on, admins can issue yellow/red
                    cards from the community player menu. The validity fields
                    only appear once it's enabled. */}
                <ToggleCard
                  label={he.cardsToggleLabel}
                  info={{ title: he.cardsToggleLabel, text: he.cardsToggleHint }}
                  value={values.cardsEnabled}
                  onValueChange={(v) => set('cardsEnabled', v)}
                />

                {values.cardsEnabled ? (
                  <View style={styles.cardsFields}>
                    <Text style={styles.cardsHint}>{he.cardValidityDaysHint}</Text>
                    {/* Card validity (days) — empty = no expiry. Yellow is
                        display-only; an ACTIVE red card blocks a member from
                        registering to games. */}
                    <InputField
                      label={he.redCardValidityLabel}
                      value={values.redCardValidityDays}
                      onChangeText={(v) => set('redCardValidityDays', v.replace(/[^0-9]/g, '').slice(0, 4))}
                      placeholder={he.cardValidityNoExpiry}
                      keyboardType="number-pad"
                    />
                    <InputField
                      label={he.yellowCardValidityLabel}
                      value={values.yellowCardValidityDays}
                      onChangeText={(v) => set('yellowCardValidityDays', v.replace(/[^0-9]/g, '').slice(0, 4))}
                      placeholder={he.cardValidityNoExpiry}
                      keyboardType="number-pad"
                    />
                  </View>
                ) : null}
              </>
            )}
          </View>
        </ScrollView>

        {/* Tell the user WHY "המשך" is disabled — otherwise the grey
            button just silently does nothing on tap. */}
        {step === 1 && !step1Valid && step1Missing.length > 0 ? (
          <Text style={styles.missingHint}>
            {he.gameWizardMissingFields(step1Missing.join(', '))}
          </Text>
        ) : null}

        <View style={styles.footer}>
          {step > 1 ? (
            <Button
              title={he.wizardStepBack}
              variant="outline"
              size="lg"
              onPress={goBack}
              disabled={busy}
            />
          ) : null}
          <View style={{ flex: 1 }}>
            {step < 2 ? (
              <Button
                title={he.wizardStepNext}
                variant="primary"
                size="lg"
                fullWidth
                onPress={goNext}
                disabled={busy || !step1Valid}
              />
            ) : (
              <Button
                title={submitLabel}
                variant="primary"
                size="lg"
                fullWidth
                onPress={submit}
                loading={busy}
                disabled={!canSubmit}
              />
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function ToggleCard({
  label,
  hint,
  info,
  value,
  onValueChange,
}: {
  label: string;
  hint?: string;
  info?: { title?: string; text: string };
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      style={styles.toggleCard}
    >
      <View style={styles.toggleText}>
        <View style={styles.toggleLabelRow}>
          <Text style={[styles.toggleLabel, styles.toggleLabelFlex]} numberOfLines={2}>
            {label}
          </Text>
          {info ? <InfoTip title={info.title ?? label} text={info.text} /> : null}
        </View>
        {hint ? (
          <Text style={styles.toggleHint} numberOfLines={2}>
            {hint}
          </Text>
        ) : null}
      </View>
      <BallSwitch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: ACCENT }}
        thumbColor="#fff"
      />
    </Pressable>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingBottom: spacing.xl },
  body: { padding: spacing.lg, gap: spacing.md },

  stickyHeader: {
    backgroundColor: colors.surface,
  },
  missingHint: {
    ...typography.caption,
    color: colors.danger,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
  },

  cardsFields: { gap: spacing.md },
  cardsHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },

  hintError: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.xs,
    textAlign: RTL_LABEL_ALIGN,
    alignSelf: 'stretch',
    width: '100%',
  },

  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
    ...shadows.card,
  },
  toggleText: {
    flexShrink: 1,
    alignItems: 'flex-start',
  },
  toggleLabel: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    textAlign: RTL_LABEL_ALIGN,
  },
  toggleLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  toggleLabelFlex: { flexShrink: 1 },
  toggleHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: RTL_LABEL_ALIGN,
  },

  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.bg,
    alignItems: 'center',
  },
});

