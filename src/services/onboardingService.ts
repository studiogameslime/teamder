// onboardingService — what the first-run in-app collects, and what the app does
// with it.
//
// The wizard is an HTML document served under script-src 'none': it can show,
// it can branch, and it can hold what somebody typed, but it cannot call
// anything. Everything past that line happens here, driven by a single
// `data-action="submit"` the shim turns into one call.
//
// Deliberately NOT a place where the club-creation rules are re-implemented:
// groupService.createGroup is the one path that makes a club, with its own
// rate limit, its own invite code and its own defaults. This assembles its
// argument and nothing more.

import { Share } from 'react-native';

import { groupService } from '@/services/groupService';
import { createShortInviteUrl } from '@/services/inviteLinkService';
import { buildInviteUrl } from '@/services/deepLinkService';
import { recordRole } from '@/services/roleService';
import { logError } from '@/services/errorLog';
import { useUserStore } from '@/store/userStore';
import { he } from '@/i18n/he';
import type { UserRole } from '@/utils/appLinks';

export interface SubmitResult {
  ok: boolean;
  /** Radio id the wizard should move to when this succeeded. */
  advanceTo: string | null;
  groupId?: string;
  /** The new club's own invite link, ready to share. */
  inviteUrl?: string;
  message?: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * The new club's invite link — a link INTO the club, not into the app.
 *
 * Which is why the club is created a step before it is shared: a club invite
 * carries the club's id, and there is no id until something makes one. The
 * wizard therefore submits at the DETAILS screen, and the invite screen is
 * reached with a real club behind it. Sharing a generic app link here would
 * credit the inviter and still leave whoever tapped it outside the club.
 *
 * Short form when the code can be written, the long form otherwise — the
 * fallback lives inside createShortInviteUrl, so a share is never broken.
 */
async function clubInviteUrl(groupId: string, userId: string): Promise<string> {
  if (!groupId) return '';
  const long = buildInviteUrl({ type: 'team', id: groupId, invitedBy: userId });
  try {
    return await createShortInviteUrl({
      type: 'team',
      id: groupId,
      invitedBy: userId,
      fallbackLong: long,
    });
  } catch (err) {
    logError('onboardingInviteUrl', err, { groupId });
    return long;
  }
}

/**
 * Everything the wizard gathered, in one call.
 *
 * `role` decides what there is to do: an organiser gets a club, a player gets
 * their answer recorded and nothing else — they left the wizard at the second
 * screen and never reached a form.
 */
async function submit(fields: Record<string, unknown>): Promise<SubmitResult> {
  const role: UserRole = str(fields.role) === 'player' ? 'player' : 'organiser';
  void recordRole(role);

  const me = useUserStore.getState().currentUser;
  if (!me) return { ok: false, advanceTo: null, message: he.error };

  // ── joining an existing club ────────────────────────────────────────────
  if (str(fields.clubMode) === 'join') {
    const code = str(fields.joinCode).toUpperCase();
    if (!code) {
      return { ok: false, advanceTo: null, message: he.onboardingNeedCode };
    }
    try {
      const r = await groupService.requestJoinByCode(code, me.id);
      if (r.status === 'not_found') {
        return { ok: false, advanceTo: null, message: he.onboardingBadCode };
      }
      // Straight to the end: there is nobody for them to invite, and the club
      // they joined does its own inviting.
      return { ok: true, advanceTo: 'w6', groupId: r.group.id };
    } catch (err) {
      logError('onboardingJoinByCode', err, { code });
      return { ok: false, advanceTo: null, message: he.error };
    }
  }

  // ── creating one ────────────────────────────────────────────────────────
  const name = str(fields.clubName);
  if (!name) {
    return { ok: false, advanceTo: null, message: he.onboardingNeedClubName };
  }
  try {
    const group = await groupService.createGroup({
      name,
      description: str(fields.clubDesc) || undefined,
      city: str(fields.city) || undefined,
      creator: me,
    });
    // The invite screen is next, and it needs a link into THIS club.
    const inviteUrl = await clubInviteUrl(group.id, me.id);
    return { ok: true, advanceTo: 'w5', groupId: group.id, inviteUrl };
  } catch (err) {
    logError('onboardingCreateGroup', err, { name });
    return { ok: false, advanceTo: null, message: he.error };
  }
}

/** The share sheet, with the person's own link. */
async function shareInvite(url: string): Promise<boolean> {
  if (!url) return false;
  try {
    const r = await Share.share({
      title: he.inviteShareSubject,
      message: he.profileInviteShareBody(url),
    });
    return r.action !== 'dismissedAction';
  } catch {
    return false;
  }
}

export const onboardingService = { submit, shareInvite };
