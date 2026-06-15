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
  Modal,
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
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/Button';
import { SpringSheet } from '@/components/anim/SpringSheet';
import { InputField } from '@/components/InputField';
import { RuleTagsInput } from '@/components/RuleTagsInput';
import { AppDateTimeField } from '@/components/DateTimeFields';
import { StepIndicator } from '@/components/StepIndicator';
import { InfoTip } from '@/components/InfoTip';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FriendsInvitePicker } from '@/components/games/FriendsInvitePicker';
import { LocationSearchSheet } from '@/components/games/LocationSearchSheet';
import { reverseGeocodeCity } from '@/services/geocodeService';
import { FieldType, GameFormat } from '@/types';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { formatDayDate } from '@/utils/format';
import { lightHaptic } from '@/utils/haptics';

const FORMATS: GameFormat[] = ['4v4', '5v5', '6v6', '7v7'];
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
  if (f === '4v4') return he.gameFormat4;
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
  return f === '4v4' ? 4 : f === '5v5' ? 5 : f === '6v6' ? 6 : 7;
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
  /** Exact coords of the picked location. Always captured now (the
   *  picker returns coords for both search hits and map taps), so the
   *  game ships with a real pin for Waze nav + the "near me" matcher
   *  instead of relying on a flaky post-create re-geocode. */
  coords?: { lat: number; lng: number };
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
  /** Recurring weekly fixture — auto-clones each week (Game.recurring).
   *  Independent of the registration-open scheduling below. */
  recurringGameEnabled: boolean;
  /** When true, the wizard surfaces the registrationOpensAt picker — the
   *  game is created 'scheduled' and a CF flips it to 'open' + pushes
   *  `newGameInCommunity` at the picked time. Independent of recurring:
   *  a one-off game can defer its registration, and a recurring game can
   *  open immediately each week. */
  scheduledRegEnabled: boolean;
  /** ms epoch — only consulted when `scheduledRegEnabled` is true.
   *  Stored on Game as `registrationOpensAt`. 0 means "not set". */
  registrationOpensAt: number;
  /** ms epoch — community games only. When >0 the game flips
   *  community→public at this time (Game.publicOpenAt). 0 = never. */
  publicOpenAt: number;
  /** ms epoch — before this, non-admins can't add guests
   *  (Game.guestsOpenAt). 0 = no restriction. */
  guestsOpenAt: number;
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
  /** Name of the community this game opens for — shown read-only in the
   *  details step (community games only) so the organiser always sees
   *  where it lands, even with a single community. */
  communityName?: string;
}

export function GameWizardForm({
  headerTitle,
  submitLabel,
  initial,
  onSubmit,
  extraTopSlot,
  quick = false,
  showInviteFriends = false,
  communityName,
}: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState<GameFormValues>(initial);
  // Soft "registration opens too close / in the past" warning — styled
  // popup instead of a native Alert. `isPast` picks the body copy.
  const [regWarn, setRegWarn] = useState<{ isPast: boolean } | null>(null);
  // Summary confirmation popup shown when the user taps the final
  // "create game" button (replaces the inline summary card).
  const [summaryOpen, setSummaryOpen] = useState(false);

  const set = <K extends keyof GameFormValues>(
    key: K,
    val: GameFormValues[K],
  ) => setValues((s) => ({ ...s, [key]: val }));

  const maxPlayers = playersPerTeam(values.format) * values.numberOfTeams;

  // Subtle fade-in when transitioning between steps. We animate a fresh
  // Animated.Value PER STEP (keyed below) rather than resetting one shared
  // value to 0 — on a heavy step (step 3), swapping the body content could
  // interrupt the native-driver animation and leave it stuck at opacity 0,
  // rendering the whole step invisible. A per-step value can't get wedged
  // by a previous step's cancelled animation.
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    fade.setValue(0);
    const anim = Animated.timing(fade, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    });
    anim.start();
    // Safety net: if the animation is interrupted (content swap on a heavy
    // step), force the end value so the step never stays invisible.
    const t = setTimeout(() => fade.setValue(1), 300);
    return () => clearTimeout(t);
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
    if (!values.scheduledRegEnabled) return true;
    const v = values.registrationOpensAt;
    if (!v) {
      appAlert(he.error, he.wizardRegOpensRequired);
      return false;
    }
    if (v >= values.startsAt) {
      appAlert(he.error, he.wizardRegOpensMustBeBeforeKickoff);
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
      appAlert(he.error, he.gameWizardSubmitFailed);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!validateRegistrationOpensAt()) return;
    if (values.scheduledRegEnabled && values.registrationOpensAt > 0) {
      const now = Date.now();
      const delta = values.startsAt - values.registrationOpensAt;
      const isPast = values.registrationOpensAt <= now;
      const isShort = !isPast && delta < SHORT_OPEN_WINDOW_MS;
      if (isPast || isShort) {
        // Soft warning — admin can choose to continue. The hard
        // "must be before kickoff" check above is the only block.
        // Styled popup (ConfirmDialog) instead of a native Alert.
        setRegWarn({ isPast });
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
            {step === 1 ? (
              <Step1
                values={values}
                set={set}
                quick={quick}
                communityName={communityName}
              />
            ) : null}
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
                onPress={() => setSummaryOpen(true)}
                loading={busy}
              />
            )}
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Soft warning before creating with a too-close / past registration
          time — styled popup, "ערוך" closes, "המשך בכל זאת" proceeds. */}
      <ConfirmDialog
        visible={!!regWarn}
        tone="warning"
        title={he.wizardRegOpensWarnTitle}
        body={
          regWarn?.isPast
            ? he.wizardRegOpensWarnPastBody
            : he.wizardRegOpensWarnShortBody
        }
        cancelLabel={he.wizardRegOpensWarnEdit}
        confirmLabel={he.wizardRegOpensWarnContinue}
        onConfirm={() => {
          setRegWarn(null);
          void finalizeSubmit();
        }}
        onClose={() => setRegWarn(null)}
      />

      {/* Summary confirmation — shown when the user taps "create game".
          Replaces the inline summary card: review the details, then
          "אישור" to create or "חזרה לעריכה" to go back. */}
      <Modal
        visible={summaryOpen}
        transparent
        animationType="none"
        onRequestClose={() => setSummaryOpen(false)}
      >
        <SpringSheet
          visible={summaryOpen}
          onBackdropPress={() => setSummaryOpen(false)}
          position="center"
          fromOffsetY={60}
          panelStyle={{ paddingHorizontal: spacing.md, alignSelf: 'stretch' }}
        >
          <Pressable style={styles.summaryModalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.summaryModalTitle}>{he.wizardSummaryTitle}</Text>
            <SummaryCard values={values} maxPlayers={maxPlayers} bare />
            <View style={styles.summaryModalFooter}>
              <View style={{ flex: 1 }}>
                <Button
                  title={he.wizardSummaryBackToEdit}
                  variant="outline"
                  size="sm"
                  fullWidth
                  onPress={() => setSummaryOpen(false)}
                  disabled={busy}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title={he.wizardSummaryConfirm}
                  variant="primary"
                  size="sm"
                  fullWidth
                  loading={busy}
                  onPress={() => {
                    setSummaryOpen(false);
                    void submit();
                  }}
                />
              </View>
            </View>
          </Pressable>
        </SpringSheet>
      </Modal>
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
  quick,
  communityName,
}: {
  values: GameFormValues;
  set: SetFn;
  quick: boolean;
  communityName?: string;
}) {
  // Step 1 — "פרטים". When, where, surface, who-sees-it. For a quick game
  // the organiser names it (the name shows in the feed instead of "משחק
  // חד־פעמי"); for a community game we show which community it opens for.
  const [locOpen, setLocOpen] = useState(false);
  return (
    <View style={styles.stack}>
      {/* Quick game → name input. Community game → read-only target line. */}
      {quick ? (
        <InputField
          label={he.createGameNameLabel}
          info={{ text: he.createGameNameHint }}
          value={values.title}
          onChangeText={(t) => set('title', t)}
          placeholder={he.createGameNamePlaceholder}
          icon="football-outline"
        />
      ) : communityName ? (
        <View style={styles.targetRow}>
          <Ionicons name="people-circle-outline" size={20} color={colors.primary} />
          <Text style={styles.targetText}>
            {he.createGameForCommunity(communityName)}
          </Text>
        </View>
      ) : null}

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
          clean city the availability matcher needs, all behind the scenes. */}
      <View>
        <InputField
          label={he.createGameField}
          required
          value={values.fieldName}
          placeholder={he.createGameFieldPlaceholder}
          icon="location-outline"
          onPress={() => setLocOpen(true)}
        />
      </View>
      <LocationSearchSheet
        visible={locOpen}
        initialQuery={values.fieldName}
        initialCoords={values.coords ?? null}
        onClose={() => setLocOpen(false)}
        onSelect={(r) => {
          set('fieldName', r.label);
          set('fieldAddress', r.label);
          // The picker always returns coords now (search hit or map tap),
          // so store them on the form to ship a real pin, and derive the
          // matcher's city string from them.
          set('coords', { lat: r.lat, lng: r.lng });
          set('cityFromList', true);
          reverseGeocodeCity(r.lat, r.lng)
            .then((city) => {
              if (city) set('city', city);
            })
            .catch(() => {});
        }}
      />

      <View style={styles.section}>
        <View style={styles.labelRow}>
          <Ionicons name="layers-outline" size={16} color={colors.textMuted} />
          <Text style={[styles.label, styles.labelFlex]}>{he.createGameFieldType}</Text>
        </View>
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

      {/* Visibility moved here (was in the advanced/management step) — it's
          a core "who is this game for" decision, not an advanced setting. */}
      <View style={styles.section}>
        <View style={styles.labelRow}>
          <Ionicons name="eye-outline" size={16} color={colors.textMuted} />
          <Text style={[styles.label, styles.labelFlex]}>{he.wizardSectionVisibility}</Text>
          <InfoTip title={he.wizardSectionVisibility} text={he.wizardVisibilityHint} />
        </View>
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
          info={{ text: he.createGameMatchDurationHint }}
          value={values.matchDurationMinutes}
          onChangeText={(t) => set('matchDurationMinutes', t)}
          keyboardType="number-pad"
        />
      </View>

      {/* Free-text rule chips — replaces the old fixed toggles
          (שופט / עבירות / חוצים / זמן נוסף). The organiser types
          whatever rule they want to surface and it shows up as a
          chip on MatchDetails. */}
      <View style={styles.section}>
        <RuleTagsInput
          label={he.ruleTagsLabel}
          info={{ text: he.ruleTagsHint }}
          value={values.ruleTags}
          onChange={(next) => set('ruleTags', next)}
        />
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
  // Step 3 — "ניהול". Approval, recurring schedule, scheduled public-open
  // + guests-open, cancellation deadline, fillers, notes. (Visibility moved
  // to step 1.) Ends with the summary card.
  return (
    <View style={styles.stack}>
      <ToggleRow
        label={he.createGameRequiresApproval}
        info={{ title: he.createGameRequiresApproval, text: he.createGameRequiresApprovalHint }}
        value={values.requiresApproval}
        onChange={(v) => set('requiresApproval', v)}
      />

      {/* Two INDEPENDENT community-game options (hidden for quick one-offs):
          (1) recurring weekly fixture, (2) scheduled registration open.
          A game can be either, both, or neither. */}
      {!quick ? (
        <>
          {/* (1) Recurring weekly — auto-clones each week. */}
          <ToggleRow
            label={he.communityEditRecurringEnabled}
            info={{ title: he.communityEditRecurringEnabled, text: he.communityEditRecurringHint }}
            value={values.recurringGameEnabled}
            onChange={(v) => set('recurringGameEnabled', v)}
          />

          {/* (2) Scheduled registration open — defer when the game appears
              + opens for joins. Independent of recurring. */}
          <ToggleRow
            label={he.wizardScheduledRegToggle}
            info={{ title: he.wizardScheduledRegToggle, text: he.wizardScheduledRegHint }}
            value={values.scheduledRegEnabled}
            onChange={(v) => {
              set('scheduledRegEnabled', v);
              // Reset the picker value when turning the toggle off so a
              // stale registrationOpensAt doesn't survive into submit.
              if (!v) set('registrationOpensAt', 0);
            }}
          />
          {values.scheduledRegEnabled ? (
            <View style={styles.section}>
              <AppDateTimeField
                label={he.wizardRegOpensLabel}
                info={{ title: he.wizardRegOpensLabel, text: he.wizardRegOpensHint }}
                value={
                  values.registrationOpensAt ||
                  defaultRegOpensAt(values.startsAt)
                }
                onChange={(ms) => set('registrationOpensAt', ms)}
                required
              />
            </View>
          ) : null}
        </>
      ) : null}

      {/* Scheduled flip community→public (community games only, and only
          meaningful when the game starts as members-only). A CF flips the
          visibility at the chosen time. */}
      {!quick && values.visibility === 'community' ? (
        <>
          <ToggleRow
            label={he.wizardPublicOpenToggle}
            info={{ title: he.wizardPublicOpenToggle, text: he.wizardPublicOpenHint }}
            value={values.publicOpenAt > 0}
            onChange={(v) =>
              set('publicOpenAt', v ? values.startsAt - 4 * 60 * 60 * 1000 : 0)
            }
          />
          {values.publicOpenAt > 0 ? (
            <View style={styles.section}>
              <AppDateTimeField
                label={he.wizardPublicOpenLabel}
                value={values.publicOpenAt}
                onChange={(ms) => set('publicOpenAt', ms)}
                required
              />
            </View>
          ) : null}
        </>
      ) : null}

      {/* Gate non-admin guest-adding until a chosen time (community games). */}
      {!quick ? (
        <>
          <ToggleRow
            label={he.wizardGuestsOpenToggle}
            info={{ title: he.wizardGuestsOpenToggle, text: he.wizardGuestsOpenHint }}
            value={values.guestsOpenAt > 0}
            onChange={(v) =>
              set('guestsOpenAt', v ? values.startsAt - 24 * 60 * 60 * 1000 : 0)
            }
          />
          {values.guestsOpenAt > 0 ? (
            <View style={styles.section}>
              <AppDateTimeField
                label={he.wizardGuestsOpenLabel}
                value={values.guestsOpenAt}
                onChange={(ms) => set('guestsOpenAt', ms)}
                required
              />
            </View>
          ) : null}
        </>
      ) : null}

      {/* Cancel deadline — a toggle that reveals a date/time picker for
          the LAST moment a player may cancel. Stored as the existing
          `cancelDeadlineHours` (derived from the picked date relative to
          kickoff) so all downstream late-cancel logic is unchanged. */}
      <ToggleRow
        label={he.wizardCancelDeadlineToggle}
        info={{ title: he.wizardCancelDeadlineToggle, text: he.wizardCancelDeadlineToggleHint }}
        value={values.cancelDeadlineHours !== undefined}
        onChange={(v) => set('cancelDeadlineHours', v ? 12 : undefined)}
      />
      {values.cancelDeadlineHours !== undefined ? (
        <View style={styles.section}>
          <AppDateTimeField
            label={he.wizardCancelDeadlineLabel}
            value={
              values.startsAt - (values.cancelDeadlineHours ?? 0) * 60 * 60 * 1000
            }
            onChange={(ms) => {
              const hrs = Math.max(
                0,
                Math.round((values.startsAt - ms) / (60 * 60 * 1000)),
              );
              set('cancelDeadlineHours', hrs);
            }}
            required
          />
        </View>
      ) : null}

      {/* Filler matching — opt-in per game. When ON, the scheduled CF
          pushes nearby non-members an interest invite when the roster
          falls short. (The minimum-trust selector was removed for now.) */}
      <ToggleRow
        label={he.gameFillerAcceptToggle}
        value={values.acceptsFillers}
        onChange={(v) => set('acceptsFillers', v)}
        info={{ title: he.tipFillerTitle, text: he.tipFillerText }}
      />

      <InputField
        label={he.createGameNotes}
        value={values.notes}
        onChangeText={(t) => set('notes', t)}
        placeholder="לדוגמה: שער דרומי, חניה ברחוב"
        multiline
      />

      {/* Invite friends — moved to the bottom (above where the summary
          used to be). They get an `inviteToGame` push on creation. */}
      {showInviteFriends ? (
        <FriendsInvitePicker
          selected={values.inviteFriendIds ?? []}
          onChange={(ids) => set('inviteFriendIds', ids)}
        />
      ) : null}
    </View>
  );
}

// ─── Summary preview (Step 3 footer) ─────────────────────────────────────

function SummaryCard({
  values,
  maxPlayers,
  bare,
}: {
  values: GameFormValues;
  maxPlayers: number;
  /** Rows only — no bordered container or header title. Used inside the
   *  confirm popup, which already provides its own title. */
  bare?: boolean;
}) {
  const dateLabel = formatDateLong(values.startsAt);
  // fieldName is the picker's full label (already includes the city), so
  // prefer it alone; fall back to city only when there's no field name.
  const placeLabel =
    values.fieldName.trim() || values.city.trim() || '—';
  const formatStr = `${formatLabel(values.format)} · ${maxPlayers} שחקנים`;
  const visibilityStr =
    values.visibility === 'public'
      ? he.wizardVisibilityPublic
      : he.wizardVisibilityCommunity;
  // Extra rows worth confirming before creating.
  const titleStr = values.title.trim();
  const cancelStr =
    values.cancelDeadlineHours !== undefined
      ? formatDateLong(
          values.startsAt - values.cancelDeadlineHours * 60 * 60 * 1000,
        )
      : null;
  const recurringStr = values.recurringGameEnabled ? he.yes : null;
  const regOpensStr =
    values.scheduledRegEnabled && values.registrationOpensAt > 0
      ? formatDateLong(values.registrationOpensAt)
      : null;

  const rows = (
    <>
      {titleStr ? (
        <SummaryRow icon="football-outline" label={he.createGameNameLabel} value={titleStr} />
      ) : null}
      <SummaryRow icon="calendar-outline" label={he.wizardSummaryDate} value={dateLabel} />
      <SummaryRow icon="location-outline" label={he.wizardSummaryWhere} value={placeLabel} />
      <SummaryRow icon="people-outline" label={he.wizardSummaryFormat} value={formatStr} />
      <SummaryRow icon="eye-outline" label={he.wizardSummaryVisibility} value={visibilityStr} />
      {recurringStr ? (
        <SummaryRow icon="repeat-outline" label={he.communityEditRecurringEnabled} value={recurringStr} />
      ) : null}
      {regOpensStr ? (
        <SummaryRow icon="timer-outline" label={he.wizardRegOpensLabel} value={regOpensStr} />
      ) : null}
      {cancelStr ? (
        <SummaryRow icon="time-outline" label={he.wizardCancelDeadlineLabel} value={cancelStr} />
      ) : null}
    </>
  );

  if (bare) return <View style={styles.summaryBare}>{rows}</View>;

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
      {rows}
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
      <BallSwitch
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
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    width: '100%',
  },
  labelFlex: { flexShrink: 1, width: undefined, alignSelf: 'auto' },
  summaryBare: { gap: spacing.sm },
  summaryModalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
    // Fill the (now slimmer-padded) panel so the popup is wider.
    alignSelf: 'stretch',
  },
  summaryModalTitle: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  summaryModalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  // Read-only "this game opens for <community>" row (details step).
  targetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  targetText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '700',
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    width: '100%',
  },
  toggleLabel: {
    ...typography.body,
    color: colors.text,
    fontWeight: '500',
    textAlign: RTL_LABEL_ALIGN,
    // Content-width so the ⓘ sits immediately to the LEFT of the label
    // (the label+ⓘ cluster at the right; the Switch is at the far left).
    flexShrink: 1,
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
