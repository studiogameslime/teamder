// 3-step wizard shared by Create / Edit Game.
//
// Responsibility split: a Game is the specific event. Everything
// match-related — when, where, format, who needs to know — lives
// here. The Community no longer carries field/format/schedule/
// recurring defaults; users supply them per game.
//
// Step 1 (מתי ואיפה) — date/time, field name, city/address, field type.
// Step 2 (פורמט)     — format, # teams (computed max players),
//                      match duration, extra time, half / penalties /
//                      referee toggles.
// Step 3 (ניהול)     — visibility, requires-approval, recurring game
//                      (drives registrationOpensAt), cancellation
//                      deadline, notes, bring ball / shirts. Ends with
//                      a confirmation-style summary card.

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
import { RuleTagsInput } from '@/components/RuleTagsInput';
import { AutocompleteInput } from '@/components/AutocompleteInput';
import { AppDateTimeField } from '@/components/DateTimeFields';
import { StepIndicator } from '@/components/StepIndicator';
import { InfoTip } from '@/components/InfoTip';
import { FriendsInvitePicker } from '@/components/games/FriendsInvitePicker';
import { searchPlaces, coordsForLabel } from '@/services/govmapService';
import { reverseGeocodeCity } from '@/services/geocodeService';
import { FieldType, GameFormat } from '@/types';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { formatDayDate } from '@/utils/format';
import { lightHaptic } from '@/utils/haptics';

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
/** Minimum trust score required for a candidate filler to receive
 *  the push. 0 = "everyone" (still excludes "new" users since their
 *  score is null and never passes any minimum). */
const FILLER_MIN_TRUST_OPTIONS = [0, 50, 70, 80, 90] as const;

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
function fillerMinTrustLabel(n: number): string {
  if (n === 0) return he.gameFillerMinTrustOptionAll;
  return he.gameFillerMinTrustOption(n);
}

/**
 * Default "registration opens" timestamp shown in the picker BEFORE
 * the user picks one in recurring mode. Convention: 1 day before
 * kickoff at 10:00 local. The user can override; this is purely a
 * starting position so the picker doesn't open on the Unix epoch.
 */
function defaultRegOpensAt(startsAt: number): number {
  const d = new Date(startsAt);
  d.setDate(d.getDate() - 1);
  d.setHours(10, 0, 0, 0);
  return d.getTime();
}

export interface GameFormValues {
  /** Title is set from the parent screen (defaults to community name)
   *  and not edited via this form. Kept on the type so callers can
   *  hand it through round-trip without losing it. */
  title: string;

  // Step 1 — When & Where
  startsAt: number;
  fieldName: string;
  /** Israeli city — REQUIRED, must be picked from the autocomplete
   *  list. Used by the cross-community filler matcher to match
   *  candidates by location, so free-typed values are blocked
   *  (otherwise "תל אביב" / "תל-אביב" / "ת"א" would never match
   *  a candidate whose home city was picked from the list). The
   *  `cityFromList` flag flips to true only when the user actively
   *  taps a suggestion in the dropdown. */
  city: string;
  cityFromList: boolean;
  /** Free-text address detail (street, gate, landmark) — optional.
   *  Saved into Game.fieldAddress. Players use it to find the
   *  exact spot; the matcher does not consume this field. */
  fieldAddress: string;
  fieldType: FieldType | undefined;

  // Step 2 — Match Setup
  format: GameFormat;
  numberOfTeams: number;
  matchDurationMinutes: string;
  /** Free-text rule chips — replaces the legacy hasReferee/Penalties/
   *  HalfTime/extraTime toggles. Cap: 12 entries, each ≤30 chars. */
  ruleTags: string[];

  // Step 3 — Game Management
  visibility: 'public' | 'community';
  requiresApproval: boolean;
  /** When true, the wizard surfaces the registrationOpensAt picker
   *  and the game is created in 'scheduled' state; a Cloud Function
   *  flips it to 'open' at the picked time and pushes
   *  `newGameInCommunity`. When false, the game opens immediately. */
  recurringGameEnabled: boolean;
  /** ms epoch — only consulted when `recurringGameEnabled` is true.
   *  Stored on Game as `registrationOpensAt`. 0 means "not set". */
  registrationOpensAt: number;
  /** Hours (number) or undefined for "no limit". */
  cancelDeadlineHours: number | undefined;
  /** When true, the game's roster is open to filler push to non-members
   *  in the same city. Defaults true for community.isOpen, false otherwise. */
  acceptsFillers: boolean;
  /** Minimum trust score required for a candidate filler to receive
   *  the push. 0 = no minimum. Common values: 0/50/70/80/90. */
  fillerMinTrust: number;
  notes: string;
  bringBall: boolean;
  bringShirts: boolean;
  /** Quick-game only: friend ids to invite the moment the game is created
   *  (each gets an `inviteToGame` push). Optional so the community flow and
   *  existing initial-value builders round-trip without it. */
  inviteFriendIds?: string[];
}

interface Props {
  headerTitle: string;
  submitLabel: string;
  initial: GameFormValues;
  onSubmit: (values: GameFormValues) => Promise<void>;
  /**
   * Quick-game mode (no community). Mode-gates the step-3 surface:
   * relabels visibility as "פרטי / פומבי", hides the recurring schedule
   * (a community concept), requires the location fields, and shows the
   * "הזמן חברים" picker. Defaults false → the community flow is byte-for-
   * byte unchanged.
   */
  quick?: boolean;
  /**
   * Extra content rendered ABOVE the step indicator (e.g. a community
   * picker on the create screen). Lives inside the same scroll container
   * as the steps so the whole page scrolls together.
   */
  extraTopSlot?: React.ReactNode;
  // The legacy `mode` prop ('standard' | 'recurring') was removed —
  // recurring is now an in-form toggle on step 3 driven by
  // `initial.recurringGameEnabled`. Callers pre-set the flag on the
  // initial values when they want the toggle to start ON; the user
  // can then flip it inside the wizard.
  /**
   * Render the "הזמן חברים" picker in step 3. True for game CREATION
   * (quick + community); the edit flow leaves it false since invites
   * fire only at creation time.
   */
  showInviteFriends?: boolean;
}

export function GameWizardForm({
  headerTitle,
  submitLabel,
  initial,
  onSubmit,
  extraTopSlot,
  quick = false,
  showInviteFriends = false,
}: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState<GameFormValues>(initial);

  const set = <K extends keyof GameFormValues>(
    key: K,
    val: GameFormValues[K],
  ) => setValues((s) => ({ ...s, [key]: val }));

  const maxPlayers = playersPerTeam(values.format) * values.numberOfTeams;

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

  // Step 1 gate: a game needs a location, but it may be free text — the
  // user isn't forced to pick from the autocomplete. Picking a suggestion
  // still gives us coords + a derived city for the matcher; a free-typed
  // value simply ships without them (the matcher just can't place it).
  const step1Valid = values.fieldName.trim().length > 0;
  // Human-readable list of what's still missing — surfaced under the
  // disabled "המשך" button so the user isn't left guessing why it's grey.
  const step1Missing: string[] = [];
  if (values.fieldName.trim().length === 0)
    step1Missing.push(he.createGameField);
  const goNext = () => {
    if (step === 1 && !step1Valid) return;
    if (step < 3) setStep(((step + 1) as 1 | 2 | 3));
  };
  const goBack = () => {
    if (step > 1) setStep(((step - 1) as 1 | 2 | 3));
  };

  // Recurring-game mode (driven by the step-3 toggle) requires the
  // user to pick a "registration opens at" time. Hard constraints:
  //   1. value must be set (not 0)
  //   2. value must be strictly before kickoff (`startsAt`)
  // Past values are ALLOWED — the create path treats them as "open
  // immediately". A submit-time confirm dialog warns the admin when
  // they pick a past value or one less than 4h before kickoff.
  const SHORT_OPEN_WINDOW_MS = 4 * 60 * 60 * 1000;
  const validateRegistrationOpensAt = (): boolean => {
    if (!values.recurringGameEnabled) return true;
    const v = values.registrationOpensAt;
    if (!v) {
      Alert.alert(he.error, he.wizardRegOpensRequired);
      return false;
    }
    if (v >= values.startsAt) {
      Alert.alert(he.error, he.wizardRegOpensMustBeBeforeKickoff);
      return false;
    }
    return true;
  };

  const finalizeSubmit = async () => {
    setBusy(true);
    try {
      await onSubmit(values);
    } catch (e) {
      if (__DEV__) console.warn('[gameWizard] submit failed', e);
      Alert.alert(he.error, he.gameWizardSubmitFailed);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!validateRegistrationOpensAt()) return;
    if (values.recurringGameEnabled && values.registrationOpensAt > 0) {
      const now = Date.now();
      const delta = values.startsAt - values.registrationOpensAt;
      const isPast = values.registrationOpensAt <= now;
      const isShort = !isPast && delta < SHORT_OPEN_WINDOW_MS;
      if (isPast || isShort) {
        // Soft warning — admin can choose to continue. The hard
        // "must be before kickoff" check above is the only block.
        Alert.alert(
          he.wizardRegOpensWarnTitle,
          isPast
            ? he.wizardRegOpensWarnPastBody
            : he.wizardRegOpensWarnShortBody,
          [
            { text: he.wizardRegOpensWarnEdit, style: 'cancel' },
            {
              text: he.wizardRegOpensWarnContinue,
              onPress: finalizeSubmit,
            },
          ],
        );
        return;
      }
    }
    await finalizeSubmit();
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={headerTitle} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Pinned step indicator — stays visible while the user
            scrolls the form so they always see which step they're on
            (and the surface area for tapping back/next stays
            predictable). Lives OUTSIDE the ScrollView for that
            reason. The optional caller extras (community picker on
            create) and the actual step body still scroll normally. */}
        <View style={styles.stickyHeader}>
          <StepIndicator
            current={step}
            labels={[he.wizardStep1, he.wizardStep2, he.wizardStep3]}
          />
        </View>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {extraTopSlot && step === 1 ? (
            <View style={styles.extraSlot}>{extraTopSlot}</View>
          ) : null}
          <Animated.View style={[styles.body, { opacity: fade }]}>
            {step === 1 ? <Step1 values={values} set={set} /> : null}
            {step === 2 ? (
              <Step2 values={values} maxPlayers={maxPlayers} set={set} />
            ) : null}
            {step === 3 ? (
              <Step3
                values={values}
                set={set}
                maxPlayers={maxPlayers}
                quick={quick}
                showInviteFriends={showInviteFriends}
              />
            ) : null}
          </Animated.View>
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
            {step < 3 ? (
              <Button
                title={he.wizardStepNext}
                variant="primary"
                size="lg"
                fullWidth
                onPress={goNext}
                disabled={busy || (step === 1 && !step1Valid)}
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
  set,
}: {
  values: GameFormValues;
  set: SetFn;
}) {
  // Step 1 — "מתי ואיפה". Identity of the event in physical space:
  // when, a single picked location (govmap), surface type.
  return (
    <View style={styles.stack}>
      <AppDateTimeField
        label={he.createGameDateTime}
        value={values.startsAt}
        onChange={(n) => set('startsAt', n)}
        required
      />

      {/* SINGLE location field (govmap). The picked place IS the full
          address — it already contains the city — so the organiser fills
          ONE field instead of separate venue + city + address inputs. On
          select we keep govmap's precise coords and reverse-geocode the
          clean city the availability matcher needs, all behind the scenes.
          The underlying Game.fieldName / fieldAddress / city fields are
          still populated, so existing games + the matcher + map are
          unaffected. */}
      <View>
        <AutocompleteInput
          label={he.createGameField}
          required
          value={values.fieldName}
          onChange={(t) => {
            // Free typing is allowed — mirror to address. It's not a
            // confirmed pick (no coords/city yet); if the user later taps a
            // suggestion, onSelect fills those in for the matcher.
            set('fieldName', t);
            set('fieldAddress', t);
            set('cityFromList', false);
          }}
          onSelect={(label) => {
            set('fieldName', label);
            set('fieldAddress', label);
            set('cityFromList', true);
            // Coords are available synchronously from the just-fetched
            // govmap results; city via a best-effort reverse geocode.
            const coords = coordsForLabel(label);
            if (coords) {
              reverseGeocodeCity(coords.lat, coords.lng)
                .then((city) => {
                  if (city) set('city', city);
                })
                .catch(() => {});
            }
          }}
          placeholder={he.createGameFieldPlaceholder}
          fetchSuggestions={(q) => searchPlaces(q).then((r) => r.map((p) => p.label))}
        />
        {/* Picking a suggestion is optional but helps location matching —
            surface that as a gentle hint, not a blocking error. */}
        {values.fieldName.trim().length > 0 && !values.cityFromList ? (
          <Text style={styles.hint}>{he.createGameLocationFreeTextHint}</Text>
        ) : null}
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
    </View>
  );
}

function Step2({
  values,
  maxPlayers,
  set,
}: {
  values: GameFormValues;
  maxPlayers: number;
  set: SetFn;
}) {
  // Step 2 — "פורמט". Match shape: format + team count → derived max
  // players, plus duration + game-rule toggles (penalties / referee /
  // halves). Bring-ball / bring-shirts moved to step 3 — they're a
  // logistics concern, not a match rule.
  return (
    <View style={styles.stack}>
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

      <View style={styles.section}>
        <InputField
          label={he.createGameMatchDuration}
          value={values.matchDurationMinutes}
          onChangeText={(t) => set('matchDurationMinutes', t)}
          keyboardType="number-pad"
        />
        <Text style={styles.hint}>{he.createGameMatchDurationHint}</Text>
      </View>

      {/* Free-text rule chips — replaces the old fixed toggles
          (שופט / עבירות / חוצים / זמן נוסף). The organiser types
          whatever rule they want to surface and it shows up as a
          chip on MatchDetails. */}
      <View style={styles.section}>
        <RuleTagsInput
          label={he.ruleTagsLabel}
          value={values.ruleTags}
          onChange={(next) => set('ruleTags', next)}
        />
        <Text style={styles.hint}>{he.ruleTagsHint}</Text>
      </View>
    </View>
  );
}

function Step3({
  values,
  set,
  maxPlayers,
  quick,
  showInviteFriends,
}: {
  values: GameFormValues;
  set: SetFn;
  maxPlayers: number;
  quick: boolean;
  showInviteFriends: boolean;
}) {
  // Step 3 — "ניהול". Visibility, approval, recurring schedule,
  // cancellation deadline, plus the logistics toggles (bring ball /
  // shirts) and free-text notes. Ends with the summary card.
  return (
    <View style={styles.stack}>
      <View style={styles.section}>
        <Text style={styles.label}>{he.wizardSectionVisibility}</Text>
        <Text style={styles.hint}>{he.wizardVisibilityHint}</Text>
        <View style={styles.pillRow}>
          <Pill
            active={values.visibility === 'community'}
            label={quick ? he.wizardVisibilityPrivate : he.wizardVisibilityCommunity}
            onPress={() => set('visibility', 'community')}
          />
          <Pill
            active={values.visibility === 'public'}
            label={quick ? he.wizardVisibilityPublicOpen : he.wizardVisibilityPublic}
            onPress={() => set('visibility', 'public')}
          />
        </View>
      </View>

      {/* Invite friends directly — they get an `inviteToGame` push the
          moment the game is created. Shown on creation for both quick
          and community games. */}
      {showInviteFriends ? (
        <FriendsInvitePicker
          selected={values.inviteFriendIds ?? []}
          onChange={(ids) => set('inviteFriendIds', ids)}
        />
      ) : null}

      <ToggleRow
        label={he.createGameRequiresApproval}
        hint={he.createGameRequiresApprovalHint}
        value={values.requiresApproval}
        onChange={(v) => set('requiresApproval', v)}
      />

      {/* Recurring game — a COMMUNITY concept (a regular weekly game),
          hidden for quick one-offs. When on, the wizard surfaces a
          "registration opens at" picker; the game is created in
          'scheduled' state and a Cloud Function flips it to 'open' at
          the picked time. */}
      {!quick ? (
        <>
          <ToggleRow
            label={he.communityEditRecurringEnabled}
            hint={he.communityEditRecurringHint}
            value={values.recurringGameEnabled}
            onChange={(v) => {
              set('recurringGameEnabled', v);
              // Reset the picker value when turning the toggle off so a
              // stale registrationOpensAt from a prior on/off cycle
              // doesn't survive into submit.
              if (!v) set('registrationOpensAt', 0);
            }}
          />
          {values.recurringGameEnabled ? (
            <View style={styles.section}>
              <AppDateTimeField
                label={he.wizardRegOpensLabel}
                value={
                  values.registrationOpensAt ||
                  defaultRegOpensAt(values.startsAt)
                }
                onChange={(ms) => set('registrationOpensAt', ms)}
                required
              />
              <Text style={styles.hint}>
                {values.registrationOpensAt > 0 &&
                values.registrationOpensAt <= Date.now()
                  ? he.wizardRegOpensHintPast
                  : he.wizardRegOpensHint}
              </Text>
            </View>
          ) : null}
        </>
      ) : null}

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

      {/* Filler matching — opt-in per game. When ON, the scheduled
          CF will scan users from outside the community whose
          available cities include this game's city, and push them an
          interest invitation when the roster falls below the
          shortage threshold. The minTrust pill row sets the floor:
          a candidate must have a trust score ≥ this to receive the
          push. */}
      <ToggleRow
        label={he.gameFillerAcceptToggle}
        hint={he.gameFillerAcceptToggleHint}
        value={values.acceptsFillers}
        onChange={(v) => set('acceptsFillers', v)}
        info={{ title: he.tipFillerTitle, text: he.tipFillerText }}
      />
      {values.acceptsFillers ? (
        <View style={styles.section}>
          <Text style={styles.label}>{he.gameFillerMinTrust}</Text>
          <View style={styles.pillRow}>
            {FILLER_MIN_TRUST_OPTIONS.map((opt, i) => (
              <Pill
                key={i}
                active={values.fillerMinTrust === opt}
                label={fillerMinTrustLabel(opt)}
                onPress={() => set('fillerMinTrust', opt)}
              />
            ))}
          </View>
          <Text style={styles.hint}>{he.gameFillerMinTrustHint}</Text>
        </View>
      ) : null}

      <InputField
        label={he.createGameNotes}
        value={values.notes}
        onChangeText={(t) => set('notes', t)}
        placeholder="לדוגמה: שער דרומי, חניה ברחוב"
        multiline
      />

      {/* The "מי יביא כדור/גופיות" toggles used to live here but were
          removed per product decision — the question is settled at
          the community level and surfaces inline on the match details
          screen for the actual game-day signal. The two underlying
          `bringBall` / `bringShirts` values still default to true so
          downstream consumers (the match details flagged badges)
          don't suddenly see undefined. */}

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
    [values.fieldName, values.city, values.fieldAddress]
      .filter((s) => s.trim().length > 0)
      .join(' · ') || '—';
  const formatStr = `${formatLabel(values.format)} · ${maxPlayers} שחקנים`;
  const visibilityStr =
    values.visibility === 'public'
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

// Compact preview in the wizard — "יום א׳ DD/MM HH:MM". Slashes
// + short day letters keep the line tight on small screens.
function formatDateLong(ms: number): string {
  return formatDayDate(ms, {
    day: 'short',
    dayPrefix: true,
    separator: ' ',
    dateSeparator: '/',
    withTime: true,
    timeSeparator: ' ',
  });
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
  info,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  info?: { title?: string; text: string };
}) {
  // Wrap the whole row in a Pressable so tapping anywhere on the
  // label or hint also flips the Switch — the bare Switch was a tiny
  // target on the LEFT edge. A light haptic on flip makes the toggle
  // feel physical.
  const flip = (v: boolean) => {
    lightHaptic();
    onChange(v);
  };
  return (
    <Pressable onPress={() => flip(!value)} style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <View style={styles.toggleLabelRow}>
          <Text style={styles.toggleLabel}>{label}</Text>
          {info ? <InfoTip title={info.title} text={info.text} /> : null}
        </View>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={flip}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor="#fff"
      />
    </Pressable>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    paddingBottom: spacing.xl,
  },
  stickyHeader: {
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
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
  hintError: {
    ...typography.caption,
    color: colors.danger,
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
  toggleLabelRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
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
    textAlign: RTL_LABEL_ALIGN,
  },

  // Footer carries the next/back buttons. Earlier the bottom ad
  // banner sat flush against the buttons (no margin), which created
  // a visual tug between the CTA and the ad. Extra bottom padding +
  // a subtle inner shadow lift the footer off the ad strip so the
  // CTA stays unambiguously the next action.
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.lg,
    paddingBottom: spacing.lg + spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.bg,
    alignItems: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 4,
  },
  missingHint: {
    ...typography.caption,
    color: colors.danger,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
});
