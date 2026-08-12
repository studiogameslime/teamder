// Create-game screen — thin shell over GameWizardForm. Handles
// community selection (when the user belongs to more than one) and
// translates the wizard's GameFormValues into a `createGameV2` call.

import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { appAlert } from '@/components/AppDialog';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { ScreenHeader } from '@/components/ScreenHeader';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { gameService } from '@/services/gameService';
import { groupService } from '@/services/groupService';
import { notificationsService } from '@/services/notificationsService';
import { logError } from '@/services/errorLog';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { Group } from '@/types';
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
    format: overrides?.format ?? '5v5',
    numberOfTeams: overrides?.numberOfTeams ?? 2,
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
  const [orphanLoading, setOrphanLoading] = useState(false);
  // Styled single-button notice popup (overlap / reg-after-kickoff) —
  // replaces the native Alert so it matches the app's other popups.
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(
    null,
  );

  const startOrphanFlow = async () => {
    if (!user) return;
    setOrphanLoading(true);
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
    if (params.quick && !orphanGroup && !orphanLoading) {
      startOrphanFlow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.quick]);

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
  const isOrphan = orphanGroup !== null;
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
  };

  // Empty states with an "ללא קבוצה" CTA — rendered AFTER all hooks (see
  // the note above) so the hook count never changes. Both show the same
  // primary CTA ("צור מחזור חד־פעמי"): the answer for "no community to
  // create in" is to make a one-off game without one.
  if (!orphanGroup && allMyCommunities.length === 0) {
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
  if (!orphanGroup && myCommunities.length === 0) {
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
    if (!user || !selectedGroup) return;
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
      if (!proceed) return;
    }
    const parsedDuration = parseInt(v.matchDurationMinutes, 10);
    const playersPerTeam =
      v.format === '4v4'
        ? 4
        : v.format === '6v6'
          ? 6
          : v.format === '7v7'
            ? 7
            : 5;
    // Recurring is now an in-form toggle (step 3). When enabled with
    // a real timestamp, persist `registrationOpensAt`; otherwise omit
    // and the game opens immediately. Past values are allowed and
    // fall through to immediate-open behaviour server-side.
    const regOpensAt =
      v.scheduledRegEnabled && v.registrationOpensAt > 0
        ? v.registrationOpensAt
        : undefined;
    // publicOpenAt / guestsOpenAt are community-game scheduling knobs —
    // only meaningful for non-quick games. Pass through when set (>0).
    const publicOpenAt =
      !isOrphan && v.publicOpenAt > 0 ? v.publicOpenAt : undefined;
    const guestsOpenAt = v.guestsOpenAt > 0 ? v.guestsOpenAt : undefined;
    try {
      const created = await gameService.createGameV2({
        groupId: selectedGroup.id,
        // Orphan flow: the synthesized group has no name, so don't
        // fall back to it for the title.
        title: v.title.trim() || (isOrphan ? 'מחזור חד־פעמי' : selectedGroup.name),
        startsAt: v.startsAt,
        fieldName: v.fieldName.trim(),
        maxPlayers: playersPerTeam * v.numberOfTeams,
        format: v.format,
        numberOfTeams: v.numberOfTeams,
        cancelDeadlineHours: v.cancelDeadlineHours,
        fieldType: v.fieldType,
        matchDurationMinutes:
          Number.isFinite(parsedDuration) && parsedDuration > 0
            ? parsedDuration
            : undefined,
        autoTeamGenerationMinutesBeforeStart: 60,
        visibility: v.visibility,
        requiresApproval: v.requiresApproval,
        waitlistApprovalRequired: v.waitlistApprovalRequired,
        waitlistApprovalTimeoutMinutes:
          Math.max(2, Math.min(120, Number(v.waitlistApprovalTimeout) || 20)),
        bringBall: v.bringBall,
        bringShirts: v.bringShirts,
        notes: v.notes.trim() || undefined,
        city: v.city.trim() || undefined,
        fieldAddress: v.fieldAddress.trim() || undefined,
        // Exact coords from the location picker — guarantees a real pin
        // (Waze nav + "near me" matcher) without depending on a flaky
        // post-create re-geocode.
        fieldLat: v.coords?.lat,
        fieldLng: v.coords?.lng,
        ruleTags: v.ruleTags,
        registrationOpensAt: regOpensAt,
        // Recurring weekly fixture (community games only) — the CF clones
        // it ~3h after kickoff into next week with the same settings.
        recurring: !isOrphan && v.recurringGameEnabled,
        publicOpenAt,
        guestsOpenAt,
        autoTeamsAt: v.autoTeamsAt > 0 ? v.autoTeamsAt : undefined,
        autoTeamsMethod: v.autoTeamsAt > 0 ? v.autoTeamsMethod : undefined,
        acceptsFillers: v.acceptsFillers,
        fillerMinTrust: v.acceptsFillers ? v.fillerMinTrust : undefined,
        advancedMode: v.advancedMode,
        advancedFillMode: v.advancedFillMode,
        advancedTieMode: v.advancedTieMode,
        createdBy: user.id,
        isOrphanContext: isOrphan,
      });
      // Quick-game: fire off the friend invites the organizer picked in
      // step 3. Best-effort — a failed invite never blocks landing on
      // the match. Each goes through the trusted sendGameInvite path.
      const inviteIds = v.inviteFriendIds ?? [];
      if (inviteIds.length > 0) {
        await Promise.all(
          inviteIds.map((rid) =>
            notificationsService
              .inviteToGame({ recipientId: rid, gameId: created.id })
              .catch(() => {
                /* best-effort per-invite */
              }),
          ),
        );
        logEvent(AnalyticsEvent.FriendsInvitedToGame, {
          gameId: created.id,
          count: inviteIds.length,
        });
      }
      // Distinguish quick (orphan) creates from regular community
      // creates — adoption of the no-community path is one of the
      // signals we want to chart.
      if (isOrphan) {
        logEvent(AnalyticsEvent.QuickGameCreated, { gameId: created.id });
      }
      (nav as { replace: (s: string, p: unknown) => void }).replace(
        'MatchDetails',
        { gameId: created.id, celebrate: true },
      );
    } catch (err) {
      // Overlap guard hit — show the user the existing game's title +
      // time so they understand WHY we blocked the create. Other
      // errors fall through to the wizard's generic error alert.
      const e = err as Error & {
        code?: string;
        conflict?: { title: string; startsAt: number };
      };
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

  // Quick-game provisioning guard: while the hidden personal group is
  // still being created (params.quick, ~1-2s), do NOT render the wizard.
  // It would otherwise flash the community-mode form (picker + a
  // community's pre-filled title/field) for that window before snapping
  // into quick mode the instant `orphanGroup` lands. Render a centered
  // loader instead. This sits AFTER every hook above, so the hook count
  // never changes between renders.
  if (params.quick && !orphanGroup) {
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

  return (
    <>
      <GameWizardForm
        // Force a remount whenever the user picks a different community
        // from the dropdown. Without this, GameWizardForm's internal
        // `useState(initial)` only seeds on first mount and never re-
        // syncs when `initial` changes — so the form fields kept showing
        // the FIRST community's pre-fill (title/fieldName/address) even
        // after the user picked a different community.
        key={`${selectedGroup?.id ?? 'none'}-${initialKey}`}
        headerTitle={
          isRecurring ? he.createGameRecurringTitle : he.createGameTitle
        }
        submitLabel={he.createGameSubmit}
        initial={initial}
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
