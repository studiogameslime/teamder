// gameCreation — making a game, without a screen.
//
// Extracted from `GameCreateScreen.submit` because the resumer has to run when
// that screen is GONE. The two paths that matter both unmount it: signing into
// an existing account replaces the session and remounts the navigator, and a
// brand-new account renders the profile confirmation over everything. A handler
// registered by the screen is null in exactly the cases a resume happens, which
// is how "your club will be created after you sign in" quietly becomes "held
// forever".
//
// So the business logic lives here, the screen calls it, and the resumer calls
// the same thing. One implementation — the alternative is a second way to make
// a game that drifts from the first.
//
// What stayed in the screen: the two confirmation dialogs (past date, holiday)
// and the navigation afterwards. Both need a UI, and both belong to the person
// looking at the form. The guest path now runs those BEFORE parking, so a
// resumed creation is unconditional.

import { gameService } from '@/services/gameService';
import { notificationsService } from '@/services/notificationsService';
import { groupService } from '@/services/groupService';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { teamSizeFromFormat } from '@/types';
import type { GameFormValues } from '@/screens/games/GameWizardForm';

export interface CreateGameContext {
  values: GameFormValues;
  /** The FULL account's uid. Never an anonymous one — see `resolveGroupId`. */
  uid: string;
  /** The club this game belongs to, or null for a standalone game. */
  groupId: string | null;
  /** Name used for the title fallback. Ignored for a standalone game, whose
   *  synthesised group has no name worth showing. */
  groupName?: string;
}

export interface CreatedGame {
  gameId: string;
  isOrphan: boolean;
}

/**
 * Which group a game goes into — and the reason this function exists at all.
 *
 * A standalone game needs the hidden personal group, and that group must belong
 * to the FULL account. `GameCreateScreen` used to provision it in a mount
 * effect, which for a guest meant a real group document written server-side
 * under an anonymous uid before anybody had typed a character — and then, if
 * they signed into an existing account, the game would have been created inside
 * a group belonging to a session that no longer existed.
 *
 * Provisioning here instead means it happens once, late, and under the identity
 * that will own it. `ensurePersonalGroup` is idempotent per user, so a person
 * who already has one gets theirs back.
 */
async function resolveGroupId(ctx: CreateGameContext): Promise<{ id: string; isOrphan: boolean }> {
  if (ctx.groupId) return { id: ctx.groupId, isOrphan: false };
  const id = await groupService.ensurePersonalGroupId();
  return { id, isOrphan: true };
}

/**
 * Create the game. Same argument mapping as the wizard's own submit, because it
 * IS the wizard's own submit — moved, not rewritten.
 *
 * Throws on failure so the caller can classify it: `GAME_OVERLAP` carries a
 * `conflict` the screen renders, and the resumer maps transport errors onto a
 * retry rather than discarding the draft.
 */
export async function createGameFromValues(ctx: CreateGameContext): Promise<CreatedGame> {
  const v = ctx.values;
  const { id: groupId, isOrphan } = await resolveGroupId(ctx);

  const parsedDuration = parseInt(v.matchDurationMinutes, 10);
  const playersPerTeam = teamSizeFromFormat(v.format);
  const regOpensAt =
    v.scheduledRegEnabled && v.registrationOpensAt > 0 ? v.registrationOpensAt : undefined;
  // publicOpenAt / guestsOpenAt are community-game scheduling knobs — only
  // meaningful for non-quick games.
  const publicOpenAt = !isOrphan && v.publicOpenAt > 0 ? v.publicOpenAt : undefined;
  const guestsOpenAt = v.guestsOpenAt > 0 ? v.guestsOpenAt : undefined;

  const created = await gameService.createGameV2({
    groupId,
    // The synthesised group has no name, so don't fall back to it for a title.
    title: v.title.trim() || (isOrphan ? 'מחזור חד־פעמי' : (ctx.groupName ?? '')),
    startsAt: v.startsAt,
    fieldName: v.fieldName.trim(),
    maxPlayers: playersPerTeam * v.numberOfTeams,
    format: v.format,
    numberOfTeams: v.numberOfTeams,
    cancelDeadlineHours: v.cancelDeadlineHours,
    fieldType: v.fieldType,
    matchDurationMinutes:
      Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : undefined,
    autoTeamGenerationMinutesBeforeStart: 60,
    visibility: v.visibility,
    requiresApproval: v.requiresApproval,
    waitlistApprovalRequired: v.waitlistApprovalRequired,
    waitlistApprovalTimeoutMinutes: Math.max(
      2,
      Math.min(120, Number(v.waitlistApprovalTimeout) || 20),
    ),
    bringBall: v.bringBall,
    bringShirts: v.bringShirts,
    notes: v.notes.trim() || undefined,
    city: v.city.trim() || undefined,
    fieldAddress: v.fieldAddress.trim() || undefined,
    fieldLat: v.coords?.lat,
    fieldLng: v.coords?.lng,
    ruleTags: v.ruleTags,
    registrationOpensAt: regOpensAt,
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
    createdBy: ctx.uid,
    isOrphanContext: isOrphan,
  });

  // Friend invites picked in step 3. Best-effort — a failed invite never blocks
  // landing on the match.
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
  if (isOrphan) {
    logEvent(AnalyticsEvent.QuickGameCreated, { gameId: created.id });
  }
  if (v.autoTeamsAt > 0) {
    logEvent(AnalyticsEvent.AutoTeamsScheduled, {
      gameId: created.id,
      method: v.autoTeamsMethod,
      leadMinutes: Math.round((v.startsAt - v.autoTeamsAt) / 60000),
      source: 'create',
    });
  }

  return { gameId: created.id, isOrphan };
}
