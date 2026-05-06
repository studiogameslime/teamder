// 2-step wizard shared by Create / Edit Community.
//
// Step 1 (פרטים)   — basics: name, location autocomplete + simple field
//                    name, plus the open-join toggle.
// Step 2 (מתקדם)  — schedule (preferred days + hour, recurring toggle),
//                    capacities, address note, contact phone, free-text
//                    description + rules.
//
// All free fields are optional; only `name` is enforced. The wizard
// is rendered identically in create and edit — the host screen wraps
// it with a different `submitLabel` and `initial` payload (empty for
// create, hydrated from the existing group for edit).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
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
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/Button';
import { InputField } from '@/components/InputField';
import { AutocompleteInput } from '@/components/AutocompleteInput';
import { AppTimeField } from '@/components/DateTimeFields';
import { StepIndicator } from '@/components/StepIndicator';
import {
  searchCities,
  searchStreets,
} from '@/services/israelLocationService';
import { isValidIsraeliPhone } from '@/services/whatsappService';
import { WeekdayIndex } from '@/types';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN, shadows } from '@/theme';
import { he } from '@/i18n/he';

const ALL_DAYS: WeekdayIndex[] = [0, 1, 2, 3, 4, 5, 6];
const ACCENT = '#3B82F6';

export interface GroupFormValues {
  name: string;
  fieldName: string;
  city: string;
  street: string;
  addressNote: string;
  isOpen: boolean;
  preferredDays: WeekdayIndex[];
  preferredHour: string; // 'HH:mm' — empty string when unset.
  recurringGameEnabled: boolean;
  /** Per-game player cap. Stored as Group.defaultMaxPlayers. */
  maxPlayers: string;
  /** Community-wide member cap. Stored as Group.maxMembers. */
  maxMembers: string;
  contactPhone: string;
  description: string;
  rules: string;
}

export const EMPTY_GROUP_FORM_VALUES: GroupFormValues = {
  name: '',
  fieldName: '',
  city: '',
  street: '',
  addressNote: '',
  isOpen: false,
  preferredDays: [],
  preferredHour: '',
  recurringGameEnabled: false,
  maxPlayers: '15',
  maxMembers: '40',
  contactPhone: '',
  description: '',
  rules: '',
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

  // Resetting the dependent street whenever the city changes prevents
  // a stale street from one city sticking around when the user picks
  // another.
  const handleCityChange = (next: string) => {
    setValues((s) => ({
      ...s,
      city: next,
      street: s.street.length > 0 ? '' : s.street,
    }));
  };

  const fetchCities = useCallback((q: string) => searchCities(q), []);
  const fetchStreets = useCallback(
    (q: string) => searchStreets(values.city, q),
    [values.city],
  );

  const phoneEntered = values.contactPhone.trim().length > 0;
  const phoneValid = !phoneEntered || isValidIsraeliPhone(values.contactPhone);
  const phoneError = phoneEntered && !phoneValid;

  const step1Valid = values.name.trim().length > 0;
  const canSubmit = step1Valid && phoneValid && !busy;

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
    if (!canSubmit) return;
    setBusy(true);
    try {
      await onSubmit(values);
    } catch (e) {
      Alert.alert(he.error, String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const cityChosen = values.city.trim().length > 0;

  const toggleDay = (d: WeekdayIndex) => {
    setValues((s) => ({
      ...s,
      preferredDays: s.preferredDays.includes(d)
        ? s.preferredDays.filter((x) => x !== d)
        : [...s.preferredDays, d].sort(),
    }));
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
                  label={he.groupCreateField}
                  value={values.fieldName}
                  onChangeText={(v) => set('fieldName', v)}
                />
                <AutocompleteInput
                  label={he.createGroupCity}
                  value={values.city}
                  onChange={handleCityChange}
                  onSelect={(v) => {
                    setValues((s) => ({
                      ...s,
                      city: v,
                      street: s.street.length > 0 ? '' : s.street,
                    }));
                  }}
                  placeholder={he.createGroupCityPlaceholder}
                  fetchSuggestions={fetchCities}
                />
                <AutocompleteInput
                  label={he.createGroupStreet}
                  value={values.street}
                  onChange={(v) => set('street', v)}
                  onSelect={(v) => set('street', v)}
                  placeholder={
                    cityChosen
                      ? he.createGroupStreetPlaceholder
                      : he.createGroupStreetDisabledHint
                  }
                  disabled={!cityChosen}
                  fetchSuggestions={fetchStreets}
                />

                {/* The open-join toggle is consequential at create time
                    (decides whether new players need approval) so it
                    lives in step 1 right after the location identity. */}
                <ToggleCard
                  label={he.createGroupIsOpen}
                  hint={he.createGroupIsOpenHint}
                  value={values.isOpen}
                  onValueChange={(v) => set('isOpen', v)}
                />
              </View>
            ) : null}

            {step === 2 ? (
              <View style={styles.stack}>
                {/* ─── Schedule ───────────────────────────── */}
                <View>
                  <Text style={styles.fieldLabel}>
                    {he.communityEditPreferredDaysLabel}
                  </Text>
                  <View style={styles.pillRow}>
                    {ALL_DAYS.map((d) => (
                      <DayChip
                        key={d}
                        label={he.availabilityDayShort[d]}
                        active={values.preferredDays.includes(d)}
                        onPress={() => toggleDay(d)}
                      />
                    ))}
                  </View>
                </View>
                <AppTimeField
                  label={`${he.communityEditPreferredHourLabel}  (${he.communityEditOptional})`}
                  value={values.preferredHour}
                  onChange={(v) => set('preferredHour', v)}
                  placeholder={
                    values.preferredHour ? '' : he.communityEditTimeUnset
                  }
                />
                <ToggleCard
                  label={he.communityEditRecurringEnabled}
                  hint={he.communityEditRecurringHint}
                  value={values.recurringGameEnabled}
                  onValueChange={(v) => set('recurringGameEnabled', v)}
                />

                {/* ─── Capacities ─────────────────────────── */}
                <View style={styles.numberRow}>
                  <View style={styles.numberCell}>
                    <InputField
                      label={he.createGroupMaxPlayers}
                      value={values.maxPlayers}
                      onChangeText={(v) => set('maxPlayers', v)}
                      keyboardType="number-pad"
                    />
                  </View>
                  <View style={styles.numberCell}>
                    <InputField
                      label={he.createGroupMaxMembers}
                      value={values.maxMembers}
                      onChangeText={(v) => set('maxMembers', v)}
                      keyboardType="number-pad"
                    />
                  </View>
                </View>

                {/* ─── Contact + free-text ────────────────── */}
                <View>
                  <InputField
                    label={he.createGroupContactPhone}
                    value={values.contactPhone}
                    onChangeText={(v) => set('contactPhone', v)}
                    placeholder={he.createGroupContactPhonePlaceholder}
                    keyboardType="phone-pad"
                  />
                  {phoneError ? (
                    <Text style={styles.hintError}>
                      {he.createGroupContactPhoneInvalid}
                    </Text>
                  ) : phoneEntered ? (
                    <Text style={styles.hint}>
                      {he.createGroupContactPhoneHint}
                    </Text>
                  ) : null}
                </View>
                <InputField
                  label={he.createGroupAddressNote}
                  value={values.addressNote}
                  onChangeText={(v) => set('addressNote', v)}
                  placeholder={he.createGroupAddressNotePlaceholder}
                />
                <InputField
                  label={he.createGroupDescription}
                  value={values.description}
                  onChangeText={(v) => set('description', v)}
                  multiline
                />
                <InputField
                  label={he.communityDetailsRules}
                  value={values.rules}
                  onChangeText={(v) => set('rules', v)}
                  multiline
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

function DayChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.dayPill,
        active && styles.dayPillActive,
        pressed && { opacity: 0.85 },
      ]}
    >
      <Text style={[styles.dayPillText, active && styles.dayPillTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function ToggleCard({
  label,
  hint,
  value,
  onValueChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      style={styles.toggleCard}
    >
      <View style={styles.toggleText}>
        <Text style={styles.toggleLabel} numberOfLines={2}>
          {label}
        </Text>
        {hint ? (
          <Text style={styles.toggleHint} numberOfLines={2}>
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch
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

  fieldLabel: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.xs,
    textAlign: RTL_LABEL_ALIGN,
    alignSelf: 'stretch',
    width: '100%',
  },
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

  // Day-letter chip — fixed square so all 7 letters line up evenly.
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  dayPill: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayPillActive: {
    backgroundColor: 'rgba(59,130,246,0.12)',
    borderColor: ACCENT,
  },
  dayPillText: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 14,
  },
  dayPillTextActive: {
    color: ACCENT,
    fontWeight: '700',
  },

  numberRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  numberCell: {
    flex: 1,
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

