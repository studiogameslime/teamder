// Create-game screen — thin shell over GameWizardForm. Handles
// community selection (when the user belongs to more than one) and
// translates the wizard's GameFormValues into a `createGameV2` call.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { appAlert } from '@/components/AppDialog';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { ScreenHeader } from '@/components/ScreenHeader';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { shouldWaitForPersonalGroup } from '@/utils/quickGameGate';
import { groupService } from '@/services/groupService';
import { logError } from '@/services/errorLog';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import {
  useAuthenticatedAction,
  useIsGuest,
} from '@/hooks/useAuthenticatedAction';
import { draftStore } from '@/services/draftStore';
import { createGameFromValues } from '@/services/gameCreation';
import { toast } from '@/components/Toast';
import { DEFAULT_FORMAT, DEFAULT_TEAM_COUNT, Group } from '@/types';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { WINDOW_START_HOUR } from '@/utils/demandSlots';
import { he } from '@/i18n/he';
import { holidayOnDate } from '@/utils/holidays';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import type { GameStackParamList } from '@/navigation/GameStack';
import {
  GameWizardForm,
  type GameFormValues,
} from '@/screens/games/GameWizardForm';
import { ConfirmDialog } from '@/components/ConfirmDialog';

type Nav = NativeStackNavigationProp<GameStackParamList, 'GameCreate'>;
type Params = RouteProp<GameStackParamList, 'GameCreate'>;

function nextThursday20(): number {
  const d = new Date();
  const delta = (4 - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + delta);
  d.setHours(20, 0, 0, 0);
  return d.getTime();
}

function buildInitial(
  // May be undefined during the brief empty-state render (no community
  // and the orphan group hasn't provisioned yet). All hooks must run
  // every render — see GameCreateScreen — so this is called even then;
  // we fall back to blank defaults rather than crash on `g.city`.
  g: Group | undefined,
  overrides?: {
    startsAt?: number;
    format?: GameFormValues['format'];
    numberOfTeams?: number;
    recurring?: boolean;
    /** Quick (orphan) game → start the name field blank so the user
     *  types a real name instead of seeing the hidden personal group's
     *  placeholder. */
    quick?: boolean;
    /** Started from the home "פנויים לשחק לידך" calendar → force acceptsFillers
     *  ON so the pulse-invite engine recruits the available players. */
    inviteAvailable?: boolean;
    /** Viewer's city, threaded from the availability calendar → seeds the game
     *  city so the pulse engine (which geocodes game.city) has a location. */
    prefillCity?: string;
  },
): GameFormValues {
  // Pre-fill the city from the community's general city. NO field /
  // schedule pre-fill anymore — the community no longer carries
  // those (refactored ownership), so the wizard starts blank for
  // those fields and the user fills them per game.
  //
  // City: copy the community's saved `city` into the strict field. If
  // the community ALREADY has a non-empty city saved, trust it as
  // canonical (it was set via the same autocomplete in
  // CreateGroup/EditGroup → `cityFromList: true`). Previously we
  // forced the admin to re-tap the suggestion every time which was
  // pure friction with no payoff — the saved value is, by
  // construction, already canonical.
  // Quick games from the availability calendar carry the viewer's city (the
  // orphan/personal group has none). Without it the pulse engine can't match
  // nearby players, so seed it here; otherwise fall back to the community city.
  const presetCity = (overrides?.prefillCity ?? g?.city ?? '').trim();
  return {
    title: overrides?.quick ? '' : g?.name ?? '',
    startsAt: overrides?.startsAt ?? nextThursday20(),
    fieldName: '',
    city: presetCity,
    cityFromList: presetCity.length > 0,
    fieldAddress: '',
    fieldType: undefined,
    format: overrides?.format ?? DEFAULT_FORMAT,
    numberOfTeams: overrides?.numberOfTeams ?? DEFAULT_TEAM_COUNT,
    matchDurationMinutes: '8',
    advancedMode: false,
    advancedFillMode: 'temporary',
    advancedTieMode: 'bothOut',
    ruleTags: [],
    // Default to PUBLIC ("פתוח לכולם") for EVERY new game — the app's whole
    // point is to fill games by reaching people, so a new game should be
    // discoverable by default. This now applies even inside a closed/private
    // community; the admin can still flip the toggle OFF per game to keep a
    // specific game internal. (User request: "פתוח לכולם" ON by default.)
    visibility: 'public',
    requiresApproval: false,
    // Default OFF (user request): the first in the waitlist enters automatically
    // when a spot frees, without a confirm step. Admins can turn confirm back on
    // per game. Existing games are unaffected (their stored value is respected).
    waitlistApprovalRequired: false,
    waitlistApprovalTimeout: '20',
    // Recurring is now an in-form toggle. Pre-set it ON when the
    // route param flagged a recurring entry; otherwise default OFF
    // and the registrationOpensAt picker stays hidden.
    recurringGameEnabled: overrides?.recurring === true,
    scheduledRegEnabled: false,
    registrationOpensAt: 0,
    publicOpenAt: 0,
    guestsOpenAt: 0,
    autoTeamsAt: 0,
    autoTeamsMethod: 'rating',
    cancelDeadlineHours: undefined,
    // Fillers are MERGED into the "מחזור פתוח לכולם" toggle (Pulse #6): a public
    // game reaches nearby strangers when short. Since visibility defaults to
    // 'public' above, fillers default ON to match. (The merged toggle keeps the
    // two in sync when the admin flips it; the engine still fires only below the
    // shortage threshold and every filler needs admin approval.)
    acceptsFillers: true,
    fillerMinTrust: 70,
    notes: '',
    bringBall: true,
    bringShirts: true,
  };
}

export function GameCreateScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Params>();
  const params = route.params ?? {};
  const user = useUserStore((s) => s.currentUser);
  const allMyCommunities = useGroupStore((s) => s.groups);
  // Game creation is admin-only — non-admin members must ask the
  // community's admin to create a game on their behalf. We filter
  // here at the UI layer so the picker, the auto-selection of the
  // first community, and the empty state all agree. The Firestore
  // rule for /games create independently enforces `isGroupMember`
  // (which includes admin), but the create rule itself doesn't
  // require admin — that's an in-app product decision.
  const myCommunities = useMemo(() => {
    if (!user) return [];
    return allMyCommunities.filter((g) => g.adminIds.includes(user.id));
  }, [allMyCommunities, user]);

  // Orphan / "no-community" mode. When set, the wizard renders with a
  // synthesized Group built from the caller's hidden personal group;
  // submit stamps `isOrphanContext: true` on the new game so MatchDetails
  // labels it "מחזור חד־פעמי" instead of showing the (placeholder)
  // community name. The group id itself is real (Firestore rules expect
  // a non-null group), it just stays hidden until the post-game
  // promote prompt converts it into a real community.
  const [orphanGroup, setOrphanGroup] = useState<Group | null>(null);
  const isGuest = useIsGuest();
  const authAction = useAuthenticatedAction();
  const draftIdRef = useRef(`game-${Date.now()}`);
  /** Values recovered from a draft, plus any field the restore refused. */
  const [restored, setRestored] = useState<{
    values: GameFormValues;
    needsAttention: string[];
  } | null>(null);
  const [checkedDraft, setCheckedDraft] = useState(false);
  const [orphanLoading, setOrphanLoading] = useState(false);
  // Provisioning threw. Without this the quick-entry spinner below would hold
  // forever on `!orphanGroup` — the user dismisses the error alert and is left
  // watching it spin. On failure we fall through to the ordinary gate, which
  // carries the CTA that retries.
  const [orphanFailed, setOrphanFailed] = useState(false);
  // Styled single-button notice popup (overlap / reg-after-kickoff) —
  // replaces the native Alert so it matches the app's other popups.
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(
    null,
  );

  const startOrphanFlow = async () => {
    if (!user) return;
    setOrphanLoading(true);
    setOrphanFailed(false);
    logEvent(AnalyticsEvent.QuickGameFlowStarted);
    try {
      const groupId = await groupService.ensurePersonalGroupId();
      // Synthesize a minimal Group object — the wizard only reads
      // name/city/isOpen and we want all of those to be neutral
      // defaults for orphan mode (blank title, blank city, public
      // visibility, fillers ON).
      const synthesized: Group = {
        id: groupId,
        name: '',
        normalizedName: '',
        adminIds: [user.id],
        playerIds: [user.id],
        pendingPlayerIds: [],
        inviteCode: '',
        // Quick games default to PRIVATE visibility (isOpen:false →
        // buildInitial seeds visibility='community', relabelled "פרטי" in
        // quick mode). Fillers, however, default ON for quick games (see
        // buildInitial's acceptsFillers) so the pulse engine recruits nearby
        // players — that's the whole point of the availability-calendar flow.
        isOpen: false,
        isPersonal: true,
        hidden: true,
        createdAt: Date.now(),
      };
      setOrphanGroup(synthesized);
    } catch (err) {
      setOrphanFailed(true);
      logError('ensurePersonalGroupId', err, {
        screen: 'GameCreateScreen',
        userId: user.id,
      });
      appAlert(
        he.createGameOrphanErrorTitle,
        he.createGameOrphanErrorBody,
      );
      if (__DEV__) console.warn('[gameCreate] orphan flow failed', err);
    } finally {
      setOrphanLoading(false);
    }
  };

  // Quick-game entry from the "+" chooser: provision the hidden
  // personal group immediately so the wizard opens straight into quick
  // mode (no community picker). Runs once — params.quick is stable.
  useEffect(() => {
    // NOT for a guest. `startOrphanFlow` calls the `ensurePersonalGroup`
    // callable, which writes a real group document server-side — and doing that
    // on mount, before anybody has typed a character, would leave a group
    // belonging to an anonymous session that may be abandoned. A guest gets the
    // wizard without it; the group is provisioned when they come back signed in.
    if (isGuest) return;
    if (params.quick && !orphanGroup && !orphanLoading) {
      startOrphanFlow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.quick, isGuest]);

  // Funnel entry: the create wizard mounted. `mode` says which of the three
  // entry points opened it (recurring clone / quick "+" / community create),
  // `prefilled` marks arrivals from the home availability calendar.
  useEffect(() => {
    logEvent(AnalyticsEvent.GameCreateStarted, {
      stage: 'wizard',
      mode: params.recurring
        ? 'recurring'
        : params.quick
          ? 'quick'
          : 'community',
      prefilled: !!params.prefillDateMs,
      communityCount: myCommunities.length,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // NOTE: the quick-path loading spinner is rendered LOWER DOWN, in the
  // main return after every hook — NOT here. GameCreateScreen calls
  // several hooks (useState / useMemo) AFTER the empty-state early-
  // returns below, so a conditional early-return *here* that toggles as
  // `orphanGroup` lands would change the hook count and crash with
  // "rendered more hooks than during the previous render". The auto-
  // start effect above provisions the orphan group; see the
  // `params.quick && !orphanGroup` guard just before the GameWizardForm.

  // NOTE: the "no community" empty states are rendered LOWER DOWN, after
  // every hook below — NOT here. They used to early-return at this point,
  // but that ran BEFORE the useState/useMemo hooks further down, so when
  // `orphanGroup` provisioned (or communities loaded) the component
  // flipped between the early-return path (fewer hooks) and the full
  // render (more hooks) → "rendered more hooks than during the previous
  // render" crash. This is exactly what bit the quick-game flow for users
  // with no community. All hooks now run unconditionally; the empty-state
  // returns happen at the very end.

  const isRecurring = params.recurring === true;
  // Quick mode is a UI STATE, not a group.
  //
  // A guest reaches the wizard in quick mode with NO group at all — the personal
  // group is provisioned after they sign in, under their real uid, inside
  // `createGameFromValues`. Deriving the mode from `orphanGroup !== null` alone
  // meant a guest fell through every gate below into an infinite spinner: no
  // allocation, so no group, so the quick-mode loader never resolved.
  //
  // A guest can only ever be in quick mode anyway: community mode needs a club
  // they administer, and they have none.
  const isOrphan = orphanGroup !== null || isGuest;
  // In recurring mode the route locks us to the originating community
  // (passed via params). In standard mode the user can pick from a
  // dropdown across the communities they admin. If the route asks for
  // a community the user no longer admins, fall through to the first
  // admin-eligible one rather than crashing.
  const paramGroupIsAdmin =
    isRecurring &&
    params.groupId &&
    myCommunities.some((g) => g.id === params.groupId);
  const lockedGroupId = paramGroupIsAdmin ? params.groupId! : null;
  // Orphan mode locks us to the synthesized personal group; admin
  // mode uses the dropdown / locked param. Keep the unconditional
  // first-community fallback so `myCommunities[]` stays accessed even
  // in orphan branch (non-empty by precondition above when reached
  // without orphanGroup).
  const initialGroupId =
    orphanGroup?.id ?? lockedGroupId ?? myCommunities[0]?.id ?? '';

  const [groupId, setGroupId] = useState<string>(initialGroupId);
  const selectedGroup = useMemo<Group | undefined>(
    () =>
      orphanGroup ?? myCommunities.find((g) => g.id === groupId),
    [orphanGroup, myCommunities, groupId],
  );

  // Reset the form whenever the user picks a different community so the
  // pre-filled values (title, fieldName, address) match.
  const [initialKey, setInitialKey] = useState(0);
  // From the home availability calendar: turn (start-of-day + window) into a
  // concrete kickoff time. Default hour per window; the user can still edit it.
  // Shared with the demand card, which uses the same hours to decide whether
  // today's window has already gone — two copies is how they drifted before.
  const WINDOW_HOUR = WINDOW_START_HOUR;
  const prefillStartsAt =
    typeof params.prefillDateMs === 'number' && params.prefillWindow
      ? (() => {
          // Set the hour via the local wall clock (setHours), not by adding
          // fixed ms — a DST transition would otherwise shift the kickoff by
          // an hour off the intended window.
          const d = new Date(params.prefillDateMs);
          d.setHours(WINDOW_HOUR[params.prefillWindow] ?? 19, 0, 0, 0);
          return d.getTime();
        })()
      : undefined;
  // Recover a draft once, on mount. `restoreGameValues` is what refuses a
  // kick-off that has already passed: it puts the field back to what a fresh
  // form would show and NAMES it, rather than inventing a replacement date —
  // scheduling a game for a day nobody chose is worse than asking again.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const d = await draftStore.read('game');
        if (!alive || !d) return;
        draftIdRef.current = d.id;
        const base = buildInitial(selectedGroup ?? myCommunities[0], {
          recurring: isRecurring,
        });
        const r = draftStore.restoreGameValues(
          base as unknown as Record<string, unknown>,
          d.values,
          Date.now(),
        );
        setRestored({
          values: r.values as unknown as GameFormValues,
          needsAttention: r.needsAttention,
        });
        logEvent(AnalyticsEvent.DraftRestored, {
          kind: 'game',
          age_ms: Math.max(0, Date.now() - d.updatedAt),
          needs_attention: r.needsAttention.join(',') || undefined,
        });
        if (r.needsAttention.includes('startsAt')) {
          toast.info(he.createGameDraftPickNewTime);
        }
      } finally {
        if (alive) setCheckedDraft(true);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initial = useMemo(
    () =>
      buildInitial(selectedGroup ?? myCommunities[0], {
        startsAt: prefillStartsAt ?? params.startsAt,
        format: params.format,
        numberOfTeams: params.numberOfTeams,
        recurring: isRecurring,
        quick: isOrphan,
        inviteAvailable: params.inviteAvailable === true,
        prefillCity: params.prefillCity,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedGroup?.id, initialKey, isRecurring],
  );

  const handleGroupChange = (id: string) => {
    setGroupId(id);
    setInitialKey((n) => n + 1);
    logEvent(AnalyticsEvent.GameCreateCommunityChanged, {
      groupId: id,
      communityCount: myCommunities.length,
    });
  };

  // Empty states with an "ללא קבוצה" CTA — rendered AFTER all hooks (see
  // the note above) so the hook count never changes. Both show the same
  // primary CTA ("צור מחזור חד־פעמי"): the answer for "no community to
  // create in" is to make a one-off game without one.
  // Arriving with `quick` means the decision is already made: this user is
  // creating a one-off game. Provisioning the hidden personal group happens in
  // an effect, which runs AFTER the first paint — and on that paint
  // orphanGroup is null and the user administers no club, so the "רק מנהל
  // יכול ליצור מחזור" gate below matched and rendered for as long as the
  // round-trip took. The user tapped "מחזור חד־פעמי" and was told, for a
  // second, that they were not allowed to create one.
  //
  // Keyed on params.quick rather than on orphanLoading: the flag is false on
  // that first paint too (it is set inside the effect), and seeding it true
  // instead would deadlock the screen — the effect is guarded by
  // `!orphanLoading` and would never run.
  //
  // The manual CTA path is deliberately NOT covered here. There the gate is a
  // true answer the user has already read, and OrphanCta spins in place;
  // replacing the whole screen with a bare spinner would be a step backwards.
  //
  // This is now the ONLY quick-provisioning guard. A second copy used to sit
  // further down, just before GameWizardForm, testing the bare
  // `params.quick && !orphanGroup` — and because it ran last it decided the
  // screen. Two live people it decided wrongly:
  //
  //   • a GUEST, who is never allocated a group (see the effect above) and so
  //     sat on "מכינים מחזור מהיר…" forever with no way out but Back. Quick is
  //     a UI state, not a group; a guest needs no group to fill the form, and
  //     the personal one is provisioned after sign-in under the real uid.
  //   • anyone whose provisioning THREW. `orphanFailed` exists to let that
  //     case fall through to the retry CTA below, which is exactly what the
  //     second copy undid for a user who happens to administer a club.
  //
  // Both are the same mistake: waiting for a group that is not coming. The
  // predicate lives in `quickGameGate` so it can be asserted without a
  // renderer — see the tests there for the full truth table.
  if (
    shouldWaitForPersonalGroup({
      isGuest,
      quick: params.quick === true,
      hasPersonalGroup: orphanGroup !== null,
      provisioningFailed: orphanFailed,
    })
  ) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.createGameTitle} />
        <View style={styles.emptyAll}>
          <SoccerBallLoader size={48} />
          <Text style={styles.emptyText}>{he.createGameQuickLoading}</Text>
        </View>
      </SafeAreaView>
    );
  }
  if (!isGuest && !orphanGroup && allMyCommunities.length === 0) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.createGameTitle} />
        <View style={styles.emptyAll}>
          <Ionicons name="people-outline" size={64} color={colors.textMuted} />
          <Text style={styles.emptyText}>{he.createGameNoCommunities}</Text>
          <OrphanCta loading={orphanLoading} onPress={startOrphanFlow} />
        </View>
      </SafeAreaView>
    );
  }
  if (!isGuest && !orphanGroup && myCommunities.length === 0) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.createGameTitle} />
        <View style={styles.emptyAll}>
          <Ionicons name="shield-outline" size={64} color={colors.textMuted} />
          <Text style={styles.emptyText}>{he.createGameNoAdmin}</Text>
          <OrphanCta loading={orphanLoading} onPress={startOrphanFlow} />
        </View>
      </SafeAreaView>
    );
  }

  const submit = async (v: GameFormValues) => {
    if (!user) return;
    // Past-date guard: if kickoff is already behind us, confirm before
    // creating (the picker happily allows past times). Recurring games
    // legitimately open in the past, so skip the check for those.
    if (!v.recurringGameEnabled && v.startsAt < Date.now()) {
      const proceed = await new Promise<boolean>((resolve) => {
        appAlert(
          he.createGamePastDateTitle,
          he.createGamePastDateBody,
          [
            { text: he.cancel, style: 'cancel', onPress: () => resolve(false) },
            { text: he.createGamePastDateConfirm, onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        );
      });
      logEvent(AnalyticsEvent.GameFormWarningShown, {
        mode: 'create',
        reason: 'past_date',
        confirmed: proceed,
      });
      if (!proceed) return;
    }
    // Holiday guard: warn (don't block) if kickoff lands on a Jewish "no-play"
    // holiday — a yom-tov or major fast (Rosh Hashana, Yom Kippur, Sukkot I,
    // Shmini Atzeret, Pesach I/VII, Shavuot, Tisha B'Av). The organizer can
    // still proceed. Applies to recurring too (warns on the anchor date; the
    // backend scan separately notifies the organizer for clones on holidays).
    const holiday = holidayOnDate(v.startsAt);
    if (holiday) {
      const proceed = await new Promise<boolean>((resolve) => {
        appAlert(
          he.createGameHolidayTitle,
          he.createGameHolidayBody(holiday),
          [
            { text: he.cancel, style: 'cancel', onPress: () => resolve(false) },
            { text: he.createGameHolidayConfirm, onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        );
      });
      logEvent(AnalyticsEvent.GameFormWarningShown, {
        mode: 'create',
        reason: 'holiday',
        confirmed: proceed,
      });
      if (!proceed) return;
    }
    // ── The save gate for a guest ──────────────────────────────────────────
    //
    // Placed AFTER the two confirmation dialogs on purpose. Those are questions
    // about the form — a date in the past, a game on Yom Kippur — and the right
    // moment to ask them is while the person is looking at the form, not after
    // they have signed in. So a parked draft is one they have already confirmed,
    // which is what lets the resume be unconditional.
    if (isGuest) {
      await authAction.request({
        kind: 'create_game',
        origin: 'in_app',
        // A club game carries its group; a standalone one deliberately does not
        // — the resumer provisions the personal group under the REAL uid, and a
        // group made for an anonymous session must never own a game.
        targetId: isOrphan ? undefined : selectedGroup?.id,
        draft: {
          kind: 'game',
          id: draftIdRef.current,
          values: v as unknown as Record<string, unknown>,
        },
        // Never called: this branch only runs for a guest, and the coordinator
        // parks rather than executing. The real work is the registered resumer.
        execute: async () => {
          throw new Error('unreachable: guest actions resume via their resumer');
        },
      });
      return;
    }
    if (!selectedGroup) return;
    try {
      // The creation itself lives in `gameCreation.ts` so the resumer can run it
      // when this screen is gone — both resume paths unmount it. What stays here
      // is what needs a UI: the two confirmations above, the error dialogs
      // below, and this navigation.
      const { gameId } = await createGameFromValues({
        values: v,
        uid: user.id,
        groupId: isOrphan ? null : selectedGroup.id,
        groupName: selectedGroup.name,
      });
      (nav as { replace: (s: string, p: unknown) => void }).replace(
        'MatchDetails',
        { gameId, celebrate: true },
      );
    } catch (err) {
      // Overlap guard hit — show the user the existing game's title +
      // time so they understand WHY we blocked the create. Other
      // errors fall through to the wizard's generic error alert.
      const e = err as Error & {
        code?: string;
        conflict?: { title: string; startsAt: number };
      };
      logEvent(AnalyticsEvent.GameSaveBlocked, {
        mode: 'create',
        reason: e.code ?? 'unknown',
      });
      if (e.code === 'GAME_OVERLAP' && e.conflict) {
        const ts = new Date(e.conflict.startsAt);
        const when = `${ts.getDate()}.${ts.getMonth() + 1} ${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`;
        setNotice({
          title: he.createGameOverlapTitle,
          body: he.createGameOverlapBody(
            e.conflict.title || he.createGameOverlapUnknownTitle,
            when,
          ),
        });
        return;
      }
      if (e.code === 'GAME_REG_AFTER_KICKOFF') {
        setNotice({
          title: he.editGameRegAfterKickoffTitle,
          body: he.editGameRegAfterKickoffBody,
        });
        return;
      }
      if (e.code === 'VALIDATION_ERROR') {
        setNotice({ title: he.validationErrorTitle, body: e.message });
        return;
      }
      throw err;
    }
  };

  // Multi-community: render the picker as the wizard's top slot so the
  // whole page (header, picker, step indicator, form) shares one scroll.
  // Compact dropdown variant (rather than expanded card list) — keeps
  // step 1 short and scannable when the user has multiple groups.
  // Recurring mode hides the picker entirely — the route param locks
  // the community.
  const extraTopSlot =
    !lockedGroupId && !isOrphan && myCommunities.length > 1 ? (
      <CommunityDropdown
        options={myCommunities}
        selected={selectedGroup}
        onSelect={handleGroupChange}
      />
    ) : isOrphan ? (
      <View style={styles.orphanBanner}>
        <Ionicons name="flash" size={16} color="#1D4ED8" />
        <Text style={styles.orphanBannerText}>
          {he.createGameOrphanBanner}
        </Text>
      </View>
    ) : null;

  // (The quick-game provisioning guard used to be repeated here. It is one
  // gate now, above — see the note there for the two people the duplicate
  // stranded. There are no hooks between that gate and this return, so moving
  // it up cannot change the hook count.)

  return (
    <>
      {authAction.sheet}
      <GameWizardForm
        // Force a remount whenever the user picks a different community
        // from the dropdown. Without this, GameWizardForm's internal
        // `useState(initial)` only seeds on first mount and never re-
        // syncs when `initial` changes — so the form fields kept showing
        // the FIRST community's pre-fill (title/fieldName/address) even
        // after the user picked a different community.
        key={`${selectedGroup?.id ?? 'none'}-${initialKey}-${restored ? draftIdRef.current : 'fresh'}`}
        headerTitle={
          isRecurring ? he.createGameRecurringTitle : he.createGameTitle
        }
        submitLabel={he.createGameSubmit}
        initial={restored?.values ?? initial}
        onSubmit={submit}
        extraTopSlot={extraTopSlot}
        quick={isOrphan}
        // Show the read-only "opens for <community>" label ONLY when the
        // interactive community picker isn't shown (single community /
        // locked) — otherwise the dropdown already names the target.
        communityName={
          isOrphan || extraTopSlot ? undefined : selectedGroup?.name
        }
        internalRating={!isOrphan && selectedGroup?.internalRating === true}
        showInviteFriends
        // Confirm before leaving the create wizard with filled-in fields
        // (back / tab-switch) instead of silently discarding them (Pulse #9).
        enableUnsavedGuard
      />
      <ConfirmDialog
        visible={!!notice}
        tone="warning"
        title={notice?.title ?? ''}
        body={notice?.body}
        confirmLabel={he.infoTipGotIt}
        onConfirm={() => setNotice(null)}
        onClose={() => setNotice(null)}
      />
    </>
  );
}

function OrphanCta({
  loading,
  onPress,
}: {
  loading: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [
        styles.orphanCta,
        loading && { opacity: 0.6 },
        pressed && !loading && { opacity: 0.88 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={he.createGameOrphanCta}
    >
      <Ionicons name="flash" size={20} color="#FFFFFF" />
      <View style={{ flex: 1 }}>
        <Text style={styles.orphanCtaTitle}>{he.createGameOrphanCta}</Text>
        <Text style={styles.orphanCtaSub}>
          {he.createGameOrphanCtaSub}
        </Text>
      </View>
      <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
    </Pressable>
  );
}

function CommunityDropdown({
  options,
  selected,
  onSelect,
}: {
  options: Group[];
  selected: Group | undefined;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.communityPickerWrap}>
      <Text style={styles.communityPickerLabel}>{he.createGameCommunity}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.dropdownTrigger,
          pressed && { opacity: 0.85 },
        ]}
      >
        <Text style={styles.dropdownValue} numberOfLines={1}>
          {selected?.name ?? '—'}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          style={styles.dropdownBackdrop}
          onPress={() => setOpen(false)}
        >
          <Pressable
            style={styles.dropdownCard}
            onPress={(e) => e.stopPropagation()}
          >
            {options.map((g) => {
              const isSelected = g.id === selected?.id;
              return (
                <Pressable
                  key={g.id}
                  onPress={() => {
                    onSelect(g.id);
                    setOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.dropdownOption,
                    isSelected && styles.dropdownOptionSelected,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text
                    style={[
                      styles.dropdownOptionText,
                      isSelected && styles.dropdownOptionTextSelected,
                    ]}
                    numberOfLines={1}
                  >
                    {g.name}
                  </Text>
                  {isSelected ? (
                    <Ionicons
                      name="checkmark"
                      size={18}
                      color={colors.primary}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  emptyAll: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  orphanCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: '#1D4ED8',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 16,
    marginTop: spacing.md,
    alignSelf: 'stretch',
    shadowColor: '#1D4ED8',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  orphanCtaTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  orphanCtaSub: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '500',
    textAlign: RTL_LABEL_ALIGN,
    marginTop: 2,
  },
  orphanBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  orphanBannerText: {
    color: '#1D4ED8',
    fontSize: 13,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
  communityPickerWrap: {
    gap: spacing.xs,
    alignItems: 'stretch',
  },
  communityPickerLabel: {
    ...typography.label,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    alignSelf: 'stretch',
    width: '100%',
  },
  // Dropdown trigger — compact pill that opens a modal list. Same
  // visual language as InputField (light surface, rounded corners) so
  // it sits naturally next to the form fields.
  dropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F5F5F5',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 52,
  },
  dropdownValue: {
    ...typography.body,
    color: colors.text,
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
    fontWeight: '600',
  },
  dropdownBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  dropdownCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xs,
    gap: 2,
  },
  dropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  dropdownOptionSelected: {
    backgroundColor: colors.primaryLight,
  },
  dropdownOptionText: {
    ...typography.body,
    color: colors.text,
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  dropdownOptionTextSelected: {
    color: colors.primary,
    fontWeight: '700',
  },
});
