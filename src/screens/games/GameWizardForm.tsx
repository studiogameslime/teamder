// 3-step wizard shared by Create / Edit Game.
//
// Step 1 (פרטים)   — required: date/time + format + fieldName + location.
//                    Title is optional.
// Step 2 (חוקים)   — optional defaults: match duration, throw-ins,
//                    referee, bring ball/shirts.
// Step 3 (מתקדם)   — optional: visibility, field type, numberOfTeams,
//                    cancel deadline (predefined options), requires
//                    approval, min players, notes — followed by a
//                    confirmation-style summary card.

import React, { useEffect, useRef, useState } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/Button';
import { InputField } from '@/components/InputField';
import { AppDateTimeField } from '@/components/DateTimeFields';
import { StepIndicator } from '@/components/StepIndicator';
import { FieldType, GameFormat } from '@/types';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

const FORMATS: GameFormat[] = ['5v5', '6v6', '7v7'];
const TEAM_COUNTS = [2, 3, 4, 5] as const;
const FIELD_TYPES = ['asphalt', 'synthetic', 'grass'] as const;
const CANCEL_DEADLINE_OPTIONS: Array<number | undefined> = [
  undefined,
  2,
  6,
  12,
  24,
];

function formatLabel(f: GameFormat): string {
  if (f === '5v5') return he.gameFormat5;
  if (f === '6v6') return he.gameFormat6;
  return he.gameFormat7;
}
function fieldTypeLabel(f: FieldType): string {
  if (f === 'asphalt') return he.fieldTypeAsphalt;
  if (f === 'synthetic') return he.fieldTypeSynthetic;
  return he.fieldTypeGrass;
}
function playersPerTeam(f: GameFormat): number {
  return f === '5v5' ? 5 : f === '6v6' ? 6 : 7;
}
function cancelOptionLabel(h: number | undefined): string {
  return h === undefined ? he.wizardCancelOptionNone : he.wizardCancelOption(h);
}

export interface GameFormValues {
  title: string;
  startsAt: number;
  fieldName: string;
  /** Single combined location string — saved into Game.fieldAddress. */
  location: string;
  format: GameFormat;
  numberOfTeams: number;
  matchDurationMinutes: string;
  extraTimeMinutes: string;
  hasReferee: boolean;
  hasPenalties: boolean;
  hasHalfTime: boolean;
  isPublic: boolean;
  fieldType: FieldType | undefined;
  /** Hours (number) or undefined for "no limit". */
  cancelDeadlineHours: number | undefined;
  requiresApproval: boolean;
  notes: string;
  bringBall: boolean;
  bringShirts: boolean;
  minPlayers: string;
}

interface Props {
  headerTitle: string;
  submitLabel: string;
  initial: GameFormValues;
  onSubmit: (values: GameFormValues) => Promise<void>;
  /**
   * Extra content rendered ABOVE the step indicator (e.g. a community
   * picker on the create screen). Lives inside the same scroll container
   * as the steps so the whole page scrolls together.
   */
  extraTopSlot?: React.ReactNode;
}

export function GameWizardForm({
  headerTitle,
  submitLabel,
  initial,
  onSubmit,
  extraTopSlot,
}: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState<GameFormValues>(initial);

  const set = <K extends keyof GameFormValues>(
    key: K,
    val: GameFormValues[K],
  ) => setValues((s) => ({ ...s, [key]: val }));

  const maxPlayers = playersPerTeam(values.format) * values.numberOfTeams;

  // No required fields — every input on every step is optional. The
  // organizer can submit a minimal game and edit details later.

  // Subtle fade-in when transitioning between steps.
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
    if (step < 3) setStep(((step + 1) as 1 | 2 | 3));
  };
  const goBack = () => {
    if (step > 1) setStep(((step - 1) as 1 | 2 | 3));
  };
  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit(values);
    } catch (e) {
      Alert.alert(he.error, String((e as Error).message ?? e));
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
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Wizard step indicator sits at the top of the page, above
              any caller-supplied extras (community picker, etc.).
              The community dropdown only belongs to step 1 — once the
              user has confirmed the group there's no value in showing
              it on later steps, so we hide it from step 2 onward. */}
          <StepIndicator
            current={step}
            labels={[he.wizardStep1, he.wizardStep2, he.wizardStep3]}
          />
          {extraTopSlot && step === 1 ? (
            <View style={styles.extraSlot}>{extraTopSlot}</View>
          ) : null}
          <Animated.View style={[styles.body, { opacity: fade }]}>
            {step === 1 ? (
              <Step1 values={values} maxPlayers={maxPlayers} set={set} />
            ) : null}
            {step === 2 ? <Step2 values={values} set={set} /> : null}
            {step === 3 ? (
              <Step3 values={values} set={set} maxPlayers={maxPlayers} />
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
            {step < 3 ? (
              <Button
                title={he.wizardStepNext}
                variant="primary"
                size="lg"
                fullWidth
                onPress={goNext}
                disabled={busy}
              />
            ) : (
              <Button
                title={submitLabel}
                variant="primary"
                size="lg"
                fullWidth
                onPress={submit}
                loading={busy}
              />
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Step bodies ─────────────────────────────────────────────────────────

type SetFn = <K extends keyof GameFormValues>(
  key: K,
  val: GameFormValues[K],
) => void;

function Step1({
  values,
  maxPlayers,
  set,
}: {
  values: GameFormValues;
  maxPlayers: number;
  set: SetFn;
}) {
  return (
    <View style={styles.stack}>
      <AppDateTimeField
        label={he.createGameDateTime}
        value={values.startsAt}
        onChange={(n) => set('startsAt', n)}
      />

      {/* Location is the most-asked field after date — promoted up the
          form, with a pin icon to make it the visual anchor of step 1. */}
      <InputField
        label={he.wizardLocation}
        value={values.location}
        onChangeText={(t) => set('location', t)}
        placeholder={he.wizardLocationPlaceholder}
        icon="location-outline"
      />

      <PillRow
        label={he.createGameFormat}
        options={FORMATS.map((f) => ({ value: f, label: formatLabel(f) }))}
        selected={values.format}
        onSelect={(v) => set('format', v as GameFormat)}
      />

      <PillRow
        label={he.createGameNumberOfTeams}
        options={TEAM_COUNTS.map((n) => ({ value: n, label: String(n) }))}
        selected={values.numberOfTeams}
        onSelect={(v) => set('numberOfTeams', v as number)}
      />

      <View style={styles.totalRow}>
        <Ionicons name="people-outline" size={18} color={colors.primary} />
        <Text style={styles.totalText}>
          {he.createGameTotalShort(maxPlayers)}
        </Text>
      </View>

      <InputField
        label={he.createGameField}
        value={values.fieldName}
        onChangeText={(t) => set('fieldName', t)}
      />
    </View>
  );
}

function Step2({ values, set }: { values: GameFormValues; set: SetFn }) {
  return (
    <View style={styles.stack}>
      <View style={styles.durationRow}>
        <View style={styles.durationCell}>
          <InputField
            label={he.createGameMatchDuration}
            value={values.matchDurationMinutes}
            onChangeText={(t) => set('matchDurationMinutes', t)}
            keyboardType="number-pad"
          />
        </View>
        <View style={styles.durationCell}>
          <InputField
            label={he.createGameExtraTime}
            value={values.extraTimeMinutes}
            onChangeText={(t) => set('extraTimeMinutes', t)}
            keyboardType="number-pad"
          />
        </View>
      </View>
      <Text style={styles.hint}>{he.createGameMatchDurationHint}</Text>

      <ToggleRow
        label={he.wizardHasReferee}
        hint={he.wizardHasRefereeHint}
        value={values.hasReferee}
        onChange={(v) => set('hasReferee', v)}
      />
      <ToggleRow
        label={he.wizardHasPenalties}
        hint={he.wizardHasPenaltiesHint}
        value={values.hasPenalties}
        onChange={(v) => set('hasPenalties', v)}
      />
      <ToggleRow
        label={he.wizardHasHalfTime}
        hint={he.wizardHasHalfTimeHint}
        value={values.hasHalfTime}
        onChange={(v) => set('hasHalfTime', v)}
      />
      <ToggleRow
        label={he.createGameBringBall}
        value={values.bringBall}
        onChange={(v) => set('bringBall', v)}
      />
      <ToggleRow
        label={he.createGameBringShirts}
        value={values.bringShirts}
        onChange={(v) => set('bringShirts', v)}
      />
    </View>
  );
}

function Step3({
  values,
  set,
  maxPlayers,
}: {
  values: GameFormValues;
  set: SetFn;
  maxPlayers: number;
}) {
  return (
    <View style={styles.stack}>
      <View style={styles.section}>
        <Text style={styles.label}>{he.wizardSectionVisibility}</Text>
        <View style={styles.pillRow}>
          <Pill
            active={!values.isPublic}
            label={he.wizardVisibilityCommunity}
            onPress={() => set('isPublic', false)}
          />
          <Pill
            active={values.isPublic}
            label={he.wizardVisibilityPublic}
            onPress={() => set('isPublic', true)}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>{he.createGameFieldType}</Text>
        <View style={styles.pillRow}>
          {FIELD_TYPES.map((f) => (
            <Pill
              key={f}
              active={values.fieldType === f}
              label={fieldTypeLabel(f)}
              onPress={() =>
                set('fieldType', values.fieldType === f ? undefined : f)
              }
            />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>{he.wizardCancelDeadline}</Text>
        <View style={styles.pillRow}>
          {CANCEL_DEADLINE_OPTIONS.map((opt, i) => (
            <Pill
              key={i}
              active={values.cancelDeadlineHours === opt}
              label={cancelOptionLabel(opt)}
              onPress={() => set('cancelDeadlineHours', opt)}
            />
          ))}
        </View>
      </View>

      <ToggleRow
        label={he.createGameRequiresApproval}
        hint={he.createGameRequiresApprovalHint}
        value={values.requiresApproval}
        onChange={(v) => set('requiresApproval', v)}
      />

      <View>
        <InputField
          label={he.createGameMinPlayers}
          value={values.minPlayers}
          onChangeText={(t) => set('minPlayers', t)}
          keyboardType="number-pad"
        />
        <Text style={styles.hint}>{he.createGameMinPlayersHint}</Text>
      </View>

      <InputField
        label={he.createGameNotes}
        value={values.notes}
        onChangeText={(t) => set('notes', t)}
        placeholder="לדוגמה: שער דרומי, חניה ברחוב"
        multiline
      />

      <SummaryCard values={values} maxPlayers={maxPlayers} />
    </View>
  );
}

// ─── Summary preview (Step 3 footer) ─────────────────────────────────────

function SummaryCard({
  values,
  maxPlayers,
}: {
  values: GameFormValues;
  maxPlayers: number;
}) {
  const dateLabel = formatDateLong(values.startsAt);
  const placeLabel =
    [values.fieldName, values.location].filter((s) => s.trim().length > 0)
      .join(' · ') || '—';
  const formatStr = `${formatLabel(values.format)} · ${maxPlayers} שחקנים`;
  const visibilityStr = values.isPublic
    ? he.wizardVisibilityPublic
    : he.wizardVisibilityCommunity;

  return (
    <View style={styles.summary}>
      <View style={styles.summaryHeader}>
        <Ionicons
          name="document-text-outline"
          size={16}
          color={colors.primary}
        />
        <Text style={styles.summaryTitle}>{he.wizardSummaryTitle}</Text>
      </View>
      <SummaryRow icon="calendar-outline" label={he.wizardSummaryDate} value={dateLabel} />
      <SummaryRow icon="location-outline" label={he.wizardSummaryWhere} value={placeLabel} />
      <SummaryRow icon="football-outline" label={he.wizardSummaryFormat} value={formatStr} />
      <SummaryRow icon="eye-outline" label={he.wizardSummaryVisibility} value={visibilityStr} />
    </View>
  );
}

function SummaryRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.summaryRow}>
      <Ionicons name={icon} size={14} color={colors.textMuted} />
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function formatDateLong(ms: number): string {
  const d = new Date(ms);
  const days = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `יום ${days[d.getDay()]} ${dd}/${mm} ${hh}:${mi}`;
}

// ─── Sub-controls ────────────────────────────────────────────────────────

function PillRow<T>({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  selected: T;
  onSelect: (v: T) => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.pillRow}>
        {options.map((opt, i) => (
          <Pill
            key={i}
            active={selected === opt.value}
            label={opt.label}
            onPress={() => onSelect(opt.value)}
          />
        ))}
      </View>
    </View>
  );
}

function Pill({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        active && styles.pillActive,
        pressed && { opacity: 0.85 },
      ]}
    >
      <Text style={[styles.pillText, active && styles.pillTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor="#fff"
      />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    paddingBottom: spacing.xl,
  },
  extraSlot: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  body: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  stack: { gap: spacing.md },

  // Step bodies
  section: { gap: spacing.xs, alignItems: 'stretch' },
  // RTL labels — On Android with `I18nManager.forceRTL(true)`,
  // `textAlign:'right'` is interpreted as "end of paragraph" which
  // under RTL becomes the visual LEFT (Yoga + Android TextView swap
  // it via writingDirection). The portable fix: use `textAlign:'left'`
  // on Android (mapped to "start of paragraph" = visual RIGHT) and
  // keep `'right'` on iOS where it stays physical-right.
  label: {
    ...typography.label,
    color: colors.textMuted,
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

  // Step 2: match duration + extra time share a row so the pair reads
  // as one unit. `flex:1` cells let each input claim half the width.
  durationRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  durationCell: {
    flex: 1,
  },

  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: -spacing.xs,
  },
  totalText: {
    ...typography.label,
    color: colors.primary,
    fontWeight: '700',
  },

  pillRow: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  pill: {
    flexGrow: 1,
    flexBasis: 0,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    minWidth: 64,
  },
  pillActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  pillText: { ...typography.body, color: colors.textMuted },
  pillTextActive: { color: colors.primary, fontWeight: '600' },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  toggleLabel: {
    ...typography.body,
    color: colors.text,
    fontWeight: '500',
    textAlign: RTL_LABEL_ALIGN,
    alignSelf: 'stretch',
    width: '100%',
  },

  // Summary card (Step 3)
  summary: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    gap: 6,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  summaryTitle: {
    ...typography.bodyBold,
    color: colors.text,
    fontWeight: '800',
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
  },
  summaryLabel: {
    ...typography.caption,
    color: colors.textMuted,
    minWidth: 56,
  },
  summaryValue: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
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
