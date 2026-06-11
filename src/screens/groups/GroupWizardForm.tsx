// 2-step wizard shared by Create / Edit Community.
//
// Responsibility split (post-refactor):
//   • Community owns identity + membership behaviour ONLY. It is NOT
//     tied to a fixed field, format, schedule, or recurring config.
//     All those are per-Game settings now.
//
// Step 1 (זהות)   — name, description, open/private toggle.
// Step 2 (מידע)   — rules, contact phone, general city, max members.
//
// All free fields are optional; only `name` is enforced. The wizard
// is rendered identically in create and edit — the host screen wraps
// it with a different `submitLabel` and `initial` payload (empty for
// create, hydrated from the existing group for edit).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
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
import { searchCities } from '@/services/israelLocationService';
import { isValidIsraeliPhone } from '@/services/whatsappService';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN, shadows } from '@/theme';
import { he } from '@/i18n/he';

const ACCENT = '#3B82F6';

export interface GroupFormValues {
  // Step 1 — Identity
  name: string;
  description: string;
  isOpen: boolean;

  // Step 2 — Info
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
}

export function GroupWizardForm({
  headerTitle,
  submitLabel,
  initial,
  onSubmit,
  revertSignal,
  revertToStep,
  revertFields,
}: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState<GroupFormValues>(initial);

  // Parent-driven partial revert. Triggered by ticking `revertSignal`.
  // We deliberately ignore the first render (signal===undefined or 0
  // on mount) so the form doesn't snap back on initial display.
  useEffect(() => {
    if (!revertSignal) return;
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
    if (revertToStep) setStep(revertToStep);
  }, [revertSignal, revertToStep, revertFields, initial]);

  const set = <K extends keyof GroupFormValues>(
    key: K,
    val: GroupFormValues[K],
  ) => setValues((s) => ({ ...s, [key]: val }));

  const fetchCities = useCallback((q: string) => searchCities(q), []);

  // Phone + city are now REQUIRED for a community.
  const phoneEntered = values.contactPhone.trim().length > 0;
  const phoneValid = phoneEntered && isValidIsraeliPhone(values.contactPhone);
  const phoneError = phoneEntered && !phoneValid;
  const cityValid = values.city.trim().length > 0;

  const step1Valid = values.name.trim().length > 0;
  const step2Valid = phoneValid && cityValid;
  const canSubmit = step1Valid && step2Valid && !busy;

  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    fade.setValue(0);
    Animated.timing(fade, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [step, fade]);

  const goNext = () => {
    if (step === 1 && !step1Valid) return;
    if (step < 2) setStep(2);
  };
  const goBack = () => {
    if (step > 1) setStep(1);
  };

  const submit = async () => {
    // If the only thing missing is the step-1 name, don't sit on a
    // silently-disabled button — send the user back to step 1 so they
    // see and fix the required field.
    if (!step1Valid) {
      setStep(1);
      return;
    }
    if (!canSubmit) return;
    setBusy(true);
    try {
      await onSubmit(values);
    } catch (e) {
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
        <View style={styles.stickyHeader}>
          <StepIndicator
            current={step}
            labels={[he.wizardStep1, he.groupWizardStep2]}
          />
        </View>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={[styles.body, { opacity: fade }]}>
            {step === 1 ? (
              <View style={styles.stack}>
                <InputField
                  label={he.groupCreateName}
                  value={values.name}
                  onChangeText={(v) => set('name', v)}
                  placeholder="לדוגמה: חמישי כדורגל"
                  required
                />
                <InputField
                  label={he.createGroupDescription}
                  value={values.description}
                  onChangeText={(v) => set('description', v)}
                  multiline
                />

                {/* The open-join toggle defines membership behaviour
                    (auto-approve vs admin gate). It belongs to identity
                    and is the single most consequential decision at
                    create time, so it lives in step 1. */}
                <ToggleCard
                  label={he.createGroupIsOpen}
                  info={{ title: he.createGroupIsOpen, text: he.createGroupIsOpenHint }}
                  value={values.isOpen}
                  onValueChange={(v) => set('isOpen', v)}
                />
              </View>
            ) : null}

            {step === 2 ? (
              <View style={styles.stack}>
                {/* Code-of-conduct, contact + general city. All
                    optional. NO field/format/schedule fields here —
                    those are per-Game now. */}
                <InputField
                  label={he.communityDetailsRules}
                  value={values.rules}
                  onChangeText={(v) => set('rules', v)}
                  multiline
                />
                <View>
                  <InputField
                    label={he.createGroupContactPhone}
                    required
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
                <AutocompleteInput
                  label={he.createGroupCity}
                  required
                  value={values.city}
                  onChange={(v) => set('city', v)}
                  onSelect={(v) => set('city', v)}
                  placeholder={he.createGroupCityPlaceholder}
                  fetchSuggestions={fetchCities}
                />
              </View>
            ) : null}
          </Animated.View>
        </ScrollView>

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
                // Stay tappable when only the step-1 name is missing so
                // the tap can route back to step 1 (see `submit`). A missing/
                // invalid phone or city (both required) blocks the tap.
                disabled={busy || !step2Valid}
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
  stickyHeader: {
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  body: { padding: spacing.lg, gap: spacing.md },
  stack: { gap: spacing.md },

  hint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
    textAlign: RTL_LABEL_ALIGN,
    alignSelf: 'stretch',
    width: '100%',
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

