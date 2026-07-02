// Typed wrappers around the six Firestore collections plus FirestoreDataConverters.
//
// Schema:
//   /users/{userId}             User
//   /groups/{groupId}           Group  (community membership: playerIds + pendingPlayerIds + adminIds)
//   /groupJoinRequests/{rid}    GroupJoinRequest  (audit trail for community-join approvals)
//   /games/{gameId}   GameDoc  (one scheduled session; players + waitlist)
//   /rounds/{roundId}           Round  (foreign key gameId)
//   /playerStats/{userId}       PlayerStats
//
// Conceptual split:
//   - Group  = the community. Membership is permanent until a member leaves.
//   - GameSummary = a single night of football. Each night has its own
//     registered list (≤ maxPlayers) and per-night waitlist. Registration
//     does NOT mutate community membership.

import {
  CollectionReference,
  DocumentData,
  DocumentReference,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  collection,
  doc,
  serverTimestamp,
} from 'firebase/firestore';

import {
  ArrivalStatus,
  ChatMessage,
  FriendRequestDoc,
  FriendRequestStatus,
  Game,
  Group,
  GroupId,
  GroupPublic,
  Jersey,
  JerseyPattern,
  LiveMatchPhase,
  LiveMatchState,
  LiveMatchZone,
  DraftTeamsResult,
  MatchRound,
  NotificationPrefs,
  PlayerStats,
  DisciplineEvent,
  UnlockedAchievement,
  User,
  UserAchievementState,
  UserAvailability,
  UserDisciplineState,
  UserId,
  UserStats,
  WeekdayIndex,
  defaultAchievementState,
  defaultDisciplineState,
  defaultNotificationPrefs,
} from '@/types';
import { getFirebase } from './config';

// ─── Top-level types not yet in @/types ────────────────────────────────────
// GroupJoinRequest is firestore-only; a UI-side type lives in @/types only if
// we end up surfacing it directly. For now it's local.

export interface GroupJoinRequestDoc {
  id: string;
  groupId: GroupId;
  userId: UserId;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number; // ms epoch (or serverTimestamp on write)
  decidedAt?: number;
  decidedBy?: UserId;
}

// ─── Converters ────────────────────────────────────────────────────────────

function readAvailability(d: DocumentData): UserAvailability | undefined {
  const a = d.availability;
  if (!a || typeof a !== 'object') return undefined;
  const days = Array.isArray(a.preferredDays)
    ? (a.preferredDays.filter(
        (n: unknown) => typeof n === 'number' && n >= 0 && n <= 6
      ) as WeekdayIndex[])
    : [];
  return {
    preferredDays: days,
    // Time buckets were written but never read here → the user's chosen times
    // reset to empty every time the availability screen reopened.
    preferredTimes: Array.isArray(a.preferredTimes)
      ? (a.preferredTimes.filter(
          (t: unknown) => typeof t === 'string',
        ) as UserAvailability['preferredTimes'])
      : undefined,
    timeFrom: typeof a.timeFrom === 'string' ? a.timeFrom : undefined,
    timeTo: typeof a.timeTo === 'string' ? a.timeTo : undefined,
    preferredCity:
      typeof a.preferredCity === 'string' ? a.preferredCity : undefined,
    cities: Array.isArray(a.cities)
      ? a.cities.filter(
          (c: unknown): c is string => typeof c === 'string' && c.length > 0,
        )
      : undefined,
    homeCity: typeof a.homeCity === 'string' ? a.homeCity : undefined,
    homeCityLat:
      typeof a.homeCityLat === 'number' ? a.homeCityLat : undefined,
    homeCityLng:
      typeof a.homeCityLng === 'number' ? a.homeCityLng : undefined,
    availabilityRadiusKm:
      typeof a.availabilityRadiusKm === 'number'
        ? a.availabilityRadiusKm
        : undefined,
    isAvailableForInvites: a.isAvailableForInvites !== false,
    acceptsFillerPush:
      typeof a.acceptsFillerPush === 'boolean'
        ? a.acceptsFillerPush
        : undefined,
  };
}

// Exported for unit tests (assist/win persistence regression). Pure function.
export function readStats(d: DocumentData): UserStats | undefined {
  const s = d.stats;
  if (!s || typeof s !== 'object') return undefined;
  return {
    totalGames: typeof s.totalGames === 'number' ? s.totalGames : 0,
    attended: typeof s.attended === 'number' ? s.attended : 0,
    cancelled: typeof s.cancelled === 'number' ? s.cancelled : 0,
    goals: typeof s.goals === 'number' ? s.goals : 0,
    // Server-maintained (commitRoundStats), same as goals. Without these two
    // the profile/championship assist + win tallies read back as 0.
    assists: typeof s.assists === 'number' ? s.assists : 0,
    wins: typeof s.wins === 'number' ? s.wins : 0,
  };
}

const userConverter: FirestoreDataConverter<User> = {
  toFirestore(u: User) {
    return {
      name: u.name,
      email: u.email ?? null,
      avatarId: u.avatarId ?? null,
      position: u.position ?? null,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt ?? Date.now(),
      onboardingCompleted: u.onboardingCompleted ?? false,
      availability: u.availability
        ? {
            preferredDays: u.availability.preferredDays ?? [],
            timeFrom: u.availability.timeFrom ?? null,
            timeTo: u.availability.timeTo ?? null,
            preferredCity: u.availability.preferredCity ?? null,
            cities: Array.isArray(u.availability.cities)
              ? u.availability.cities
              : [],
            homeCity: u.availability.homeCity ?? null,
            homeCityLat:
              typeof u.availability.homeCityLat === 'number'
                ? u.availability.homeCityLat
                : null,
            homeCityLng:
              typeof u.availability.homeCityLng === 'number'
                ? u.availability.homeCityLng
                : null,
            availabilityRadiusKm:
              typeof u.availability.availabilityRadiusKm === 'number'
                ? u.availability.availabilityRadiusKm
                : null,
            isAvailableForInvites: u.availability.isAvailableForInvites !== false,
            acceptsFillerPush: u.availability.acceptsFillerPush === true,
          }
        : null,
      stats: u.stats
        ? {
            totalGames: u.stats.totalGames,
            attended: u.stats.attended,
            cancelled: u.stats.cancelled,
            // Server-maintained (commitRoundStats). Serialize them so a full
            // setDoc of a User object doesn't clobber the tallies to 0.
            goals: u.stats.goals ?? 0,
            assists: u.stats.assists ?? 0,
            wins: u.stats.wins ?? 0,
          }
        : null,
      fcmTokens: u.fcmTokens ?? [],
      notificationPrefs: u.notificationPrefs ?? null,
      dmFriendsOnly: u.dmFriendsOnly ?? false,
      newGameSubscriptions: u.newGameSubscriptions ?? [],
      personalGroupId: u.personalGroupId ?? null,
      jersey: u.jersey ?? null,
      achievements: u.achievements ?? null,
      discipline: u.discipline ?? null,
      invitedBy: u.invitedBy ?? null,
      invitedByType: u.invitedByType ?? null,
      invitedByTargetId: u.invitedByTargetId ?? null,
      // invitedAt is intentionally NOT written here — userService
      // writes it directly via updateDoc with serverTimestamp(), and
      // re-saves of the User object via the converter must not
      // overwrite it (would clobber the original server time).
    };
  },
  fromFirestore(snap: QueryDocumentSnapshot<DocumentData>): User {
    const d = snap.data();
    return {
      id: snap.id,
      name: d.name ?? '',
      email: d.email ?? undefined,
      avatarId: d.avatarId ?? undefined,
      position: (d.position as User['position']) ?? undefined,
      // photoUrl kept readable for legacy docs; never written by new code.
      photoUrl: d.photoUrl ?? undefined,
      createdAt: typeof d.createdAt === 'number' ? d.createdAt : Date.now(),
      updatedAt: d.updatedAt ?? undefined,
      onboardingCompleted: d.onboardingCompleted === true,
      // QA tester flag — set from Pulse. Gates tester-only surfaces
      // (e.g. the screenshot→bug-report popup) so they appear only for
      // people we've explicitly marked as testers.
      qa: d.qa === true,
      availability: readAvailability(d),
      stats: readStats(d),
      fcmTokens: Array.isArray(d.fcmTokens)
        ? d.fcmTokens.filter((t: unknown): t is string => typeof t === 'string')
        : undefined,
      notificationPrefs: readNotificationPrefs(d.notificationPrefs),
      newGameSubscriptions: Array.isArray(d.newGameSubscriptions)
        ? d.newGameSubscriptions.filter(
            (s: unknown): s is string => typeof s === 'string'
          )
        : undefined,
      // friends is read here but NEVER written in toFirestore — the
      // mutual array is owned by the trusted accept/remove callables
      // (Admin SDK). Writing it on every profile save would risk
      // clobbering a concurrent server-side arrayUnion. Same rationale
      // as invitedAt below.
      friends: Array.isArray(d.friends)
        ? d.friends.filter((s: unknown): s is string => typeof s === 'string')
        : undefined,
      dmFriendsOnly: d.dmFriendsOnly === true,
      personalGroupId:
        typeof d.personalGroupId === 'string' && d.personalGroupId.length > 0
          ? d.personalGroupId
          : undefined,
      jersey: readJersey(d.jersey),
      achievements: readAchievements(d.achievements),
      discipline: readDiscipline(d.discipline),
      invitedBy: typeof d.invitedBy === 'string' ? d.invitedBy : undefined,
      invitedByType:
        d.invitedByType === 'session' ||
        d.invitedByType === 'team' ||
        d.invitedByType === 'app'
          ? d.invitedByType
          : undefined,
      invitedByTargetId:
        typeof d.invitedByTargetId === 'string'
          ? d.invitedByTargetId
          : undefined,
      // Passes the Firestore Timestamp through as-is; consumers call
      // `.toMillis()` / `.toDate()` if they need a number/Date.
      invitedAt: readTimestamp(d.invitedAt),
    };
  },
};

/**
 * Narrow an unknown field to a Firestore Timestamp instance, or
 * undefined for anything else (missing, FieldValue sentinel that
 * hasn't resolved server-side yet, etc.).
 */
function readTimestamp(
  v: unknown,
): import('firebase/firestore').Timestamp | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as { toMillis?: unknown; toDate?: unknown };
  if (typeof o.toMillis === 'function' && typeof o.toDate === 'function') {
    return v as import('firebase/firestore').Timestamp;
  }
  return undefined;
}

function readDiscipline(v: unknown): UserDisciplineState | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const events: DisciplineEvent[] = Array.isArray(o.events)
    ? (o.events as unknown[]).flatMap((e) => {
        if (!e || typeof e !== 'object') return [];
        const x = e as Record<string, unknown>;
        if (
          typeof x.id !== 'string' ||
          typeof x.userId !== 'string' ||
          (x.type !== 'yellow' && x.type !== 'red') ||
          (x.reason !== 'late' && x.reason !== 'no_show' && x.reason !== 'manual') ||
          typeof x.createdAt !== 'number'
        ) {
          return [];
        }
        return [
          {
            id: x.id,
            userId: x.userId,
            type: x.type,
            reason: x.reason,
            gameId: typeof x.gameId === 'string' ? x.gameId : undefined,
            issuedBy:
              typeof x.issuedBy === 'string' ? x.issuedBy : undefined,
            createdAt: x.createdAt,
          },
        ];
      })
    : [];
  return {
    ...defaultDisciplineState,
    yellowCards: typeof o.yellowCards === 'number' ? o.yellowCards : 0,
    redCards: typeof o.redCards === 'number' ? o.redCards : 0,
    lateCount: typeof o.lateCount === 'number' ? o.lateCount : 0,
    noShowCount: typeof o.noShowCount === 'number' ? o.noShowCount : 0,
    events,
  };
}

function readAchievements(v: unknown): UserAchievementState | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const unlocked: UnlockedAchievement[] = Array.isArray(o.unlocked)
    ? (o.unlocked as unknown[]).flatMap((u) => {
        if (!u || typeof u !== 'object') return [];
        const x = u as Record<string, unknown>;
        if (typeof x.id !== 'string' || typeof x.unlockedAt !== 'number') return [];
        // Preserve the reached tier — dropping it made every reconcile look
        // like a migration, which permanently suppressed the unlock
        // celebration and re-stamped earned-at dates.
        const tier =
          x.tier === 'bronze' || x.tier === 'silver' || x.tier === 'gold'
            ? x.tier
            : undefined;
        return [{ id: x.id, ...(tier ? { tier } : {}), unlockedAt: x.unlockedAt }];
      })
    : [];
  return {
    ...defaultAchievementState,
    unlocked,
    gamesJoined: typeof o.gamesJoined === 'number' ? o.gamesJoined : 0,
    wins: typeof o.wins === 'number' ? o.wins : 0,
    teamsCreated: typeof o.teamsCreated === 'number' ? o.teamsCreated : 0,
    teamsJoined: typeof o.teamsJoined === 'number' ? o.teamsJoined : 0,
    invitesSent: typeof o.invitesSent === 'number' ? o.invitesSent : 0,
    playersCoached: typeof o.playersCoached === 'number' ? o.playersCoached : 0,
    friendsCount: typeof o.friendsCount === 'number' ? o.friendsCount : 0,
    goals: typeof o.goals === 'number' ? o.goals : 0,
    // Mirror `goals` — was omitted, so achievements.assists always read 0 even
    // when stored (B22). Harmless where assists are sourced from stats.assists,
    // but keeps this converter from silently zeroing a real field.
    assists: typeof o.assists === 'number' ? o.assists : 0,
    maxGamesWithPlayer:
      typeof o.maxGamesWithPlayer === 'number' ? o.maxGamesWithPlayer : 0,
    maxWinsWithPlayer:
      typeof o.maxWinsWithPlayer === 'number' ? o.maxWinsWithPlayer : 0,
    distinctPlayers:
      typeof o.distinctPlayers === 'number' ? o.distinctPlayers : 0,
  };
}

function readJersey(v: unknown): Jersey | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const color = typeof o.color === 'string' ? o.color : null;
  const pattern = readJerseyPattern(o.pattern);
  const number = typeof o.number === 'number' ? Math.floor(o.number) : null;
  const displayName = typeof o.displayName === 'string' ? o.displayName : null;
  if (!color || !pattern || number == null || displayName == null) {
    return undefined;
  }
  return {
    color,
    pattern,
    number: Math.max(1, Math.min(99, number)),
    displayName: displayName.slice(0, 10),
  };
}

function readJerseyPattern(v: unknown): JerseyPattern | undefined {
  return v === 'solid' || v === 'stripes' || v === 'split' || v === 'dots'
    ? v
    : undefined;
}

function readNotificationPrefs(v: unknown): NotificationPrefs | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  // Merge over defaults so newly added types start out enabled even on
  // user docs written before that type existed.
  const out: NotificationPrefs = { ...defaultNotificationPrefs };
  (Object.keys(out) as (keyof NotificationPrefs)[]).forEach((k) => {
    if (typeof o[k] === 'boolean') out[k] = o[k] as boolean;
  });
  return out;
}

const groupConverter: FirestoreDataConverter<Group> = {
  toFirestore(g: Group) {
    return {
      name: g.name,
      normalizedName: g.normalizedName,   // for case-insensitive prefix search
      fieldName: g.fieldName,
      fieldAddress: g.fieldAddress ?? null,
      city: g.city ?? null,
      street: g.street ?? null,
      addressNote: g.addressNote ?? null,
      description: g.description ?? null,
      coverPhotoUrl: g.coverPhotoUrl ?? null,
      coverImageId: g.coverImageId ?? null,
      defaultMaxPlayers:
        typeof g.defaultMaxPlayers === 'number' ? g.defaultMaxPlayers : null,
      lat: g.lat ?? null,
      lng: g.lng ?? null,
      creatorId: g.creatorId ?? g.adminIds[0] ?? null,
      adminIds: g.adminIds,
      playerIds: g.playerIds,
      // pendingPlayerIds is stored as the source of truth for the community-
      // membership pending list. groupJoinRequests are the audit trail.
      pendingPlayerIds: g.pendingPlayerIds,
      inviteCode: g.inviteCode,
      isOpen: g.isOpen ?? null,
      internalRating: g.internalRating ?? null,
      hideInternalRating: g.hideInternalRating ?? null,
      yellowCardValidityDays: g.yellowCardValidityDays ?? null,
      redCardValidityDays: g.redCardValidityDays ?? null,
      cardsEnabled: g.cardsEnabled ?? null,
      adminRatings: g.adminRatings ?? null,
      ballHolderIds: Array.isArray(g.ballHolderIds) ? g.ballHolderIds : null,
      jerseysHolderIds: Array.isArray(g.jerseysHolderIds) ? g.jerseysHolderIds : null,
      maxMembers: g.maxMembers ?? null,
      contactPhone: g.contactPhone ?? null,
      preferredDays: g.preferredDays ?? [],
      preferredHour: g.preferredHour ?? null,
      costPerGame: g.costPerGame ?? null,
      notes: g.notes ?? null,
      rules: g.rules ?? null,
      recurringGameEnabled: g.recurringGameEnabled ?? false,
      recurringDayOfWeek:
        typeof g.recurringDayOfWeek === 'number' ? g.recurringDayOfWeek : null,
      recurringTime: g.recurringTime ?? null,
      recurringDefaultFormat: g.recurringDefaultFormat ?? null,
      recurringNumberOfTeams:
        typeof g.recurringNumberOfTeams === 'number'
          ? g.recurringNumberOfTeams
          : null,
      isPersonal: g.isPersonal === true,
      hidden: g.hidden === true,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt ?? Date.now(),
    };
  },
  fromFirestore(snap): Group {
    const d = snap.data();
    return {
      id: snap.id,
      name: d.name ?? '',
      normalizedName: d.normalizedName ?? (d.name ?? '').toLowerCase().trim(),
      fieldName: d.fieldName ?? '',
      fieldAddress: d.fieldAddress ?? undefined,
      city: d.city ?? undefined,
      street: d.street ?? undefined,
      addressNote: d.addressNote ?? undefined,
      description:
        typeof d.description === 'string' ? d.description : undefined,
      defaultMaxPlayers:
        typeof d.defaultMaxPlayers === 'number'
          ? d.defaultMaxPlayers
          : undefined,
      lat: d.lat ?? undefined,
      lng: d.lng ?? undefined,
      creatorId:
        typeof d.creatorId === 'string' ? d.creatorId : undefined,
      // Without this passthrough the cover was stored (via
      // updateGroupMetadata) but dropped on every read, so the hero
      // never showed it and the WhatsApp invite couldn't attach it.
      coverPhotoUrl:
        typeof d.coverPhotoUrl === 'string' ? d.coverPhotoUrl : undefined,
      coverImageId:
        typeof d.coverImageId === 'string' ? d.coverImageId : undefined,
      adminIds: d.adminIds ?? [],
      playerIds: d.playerIds ?? [],
      pendingPlayerIds: d.pendingPlayerIds ?? [],
      inviteCode: d.inviteCode ?? '',
      isOpen: typeof d.isOpen === 'boolean' ? d.isOpen : undefined,
      internalRating:
        typeof d.internalRating === 'boolean' ? d.internalRating : undefined,
      hideInternalRating:
        typeof d.hideInternalRating === 'boolean'
          ? d.hideInternalRating
          : undefined,
      yellowCardValidityDays:
        typeof d.yellowCardValidityDays === 'number' ? d.yellowCardValidityDays : null,
      redCardValidityDays:
        typeof d.redCardValidityDays === 'number' ? d.redCardValidityDays : null,
      cardsEnabled: typeof d.cardsEnabled === 'boolean' ? d.cardsEnabled : undefined,
      adminRatings:
        d.adminRatings && typeof d.adminRatings === 'object'
          ? (Object.fromEntries(
              Object.entries(d.adminRatings as Record<string, unknown>).filter(
                ([, v]) => typeof v === 'number',
              ),
            ) as Record<string, number>)
          : undefined,
      ballHolderIds: Array.isArray(d.ballHolderIds)
        ? (d.ballHolderIds as unknown[]).filter((u): u is string => typeof u === 'string')
        : undefined,
      jerseysHolderIds: Array.isArray(d.jerseysHolderIds)
        ? (d.jerseysHolderIds as unknown[]).filter((u): u is string => typeof u === 'string')
        : undefined,
      maxMembers: typeof d.maxMembers === 'number' ? d.maxMembers : undefined,
      contactPhone:
        typeof d.contactPhone === 'string' ? d.contactPhone : undefined,
      preferredDays: readWeekdays(d.preferredDays),
      preferredHour:
        typeof d.preferredHour === 'string' ? d.preferredHour : undefined,
      costPerGame:
        typeof d.costPerGame === 'number' ? d.costPerGame : undefined,
      notes: typeof d.notes === 'string' ? d.notes : undefined,
      rules: typeof d.rules === 'string' ? d.rules : undefined,
      recurringGameEnabled: d.recurringGameEnabled === true,
      recurringDayOfWeek: readWeekdayIndex(d.recurringDayOfWeek),
      recurringTime:
        typeof d.recurringTime === 'string' ? d.recurringTime : undefined,
      recurringDefaultFormat: readGameFormat(d.recurringDefaultFormat),
      recurringNumberOfTeams:
        typeof d.recurringNumberOfTeams === 'number' &&
        d.recurringNumberOfTeams >= 2
          ? d.recurringNumberOfTeams
          : undefined,
      isPersonal: d.isPersonal === true,
      hidden: d.hidden === true,
      createdAt: d.createdAt ?? 0,
      updatedAt: d.updatedAt ?? undefined,
    };
  },
};

function readWeekdayIndex(v: unknown): WeekdayIndex | undefined {
  return typeof v === 'number' && v >= 0 && v <= 6
    ? (v as WeekdayIndex)
    : undefined;
}
function readGameFormat(
  v: unknown,
): import('@/types').GameFormat | undefined {
  return v === '4v4' || v === '5v5' || v === '6v6' || v === '7v7'
    ? v
    : undefined;
}

function readFieldType(v: unknown): import('@/types').FieldType | undefined {
  return v === 'asphalt' || v === 'synthetic' || v === 'grass' ? v : undefined;
}

function readWeekdays(v: unknown): WeekdayIndex[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter(
    (n): n is WeekdayIndex =>
      typeof n === 'number' && n >= 0 && n <= 6
  );
}

const VALID_ZONES: LiveMatchZone[] = [
  'teamA',
  'teamB',
  'teamC',
  'teamD',
  'teamE',
  'bench',
  'gkA',
  'gkB',
];
const VALID_PHASES: LiveMatchPhase[] = ['organizing', 'live', 'finished'];

// Exported for unit tests (assist persistence regression). Pure function.
export function readLiveMatch(v: unknown): LiveMatchState | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const phase = VALID_PHASES.includes(o.phase as LiveMatchPhase)
    ? (o.phase as LiveMatchPhase)
    : 'organizing';
  const rawAssign = o.assignments;
  const assignments: Record<UserId, LiveMatchZone> = {};
  if (rawAssign && typeof rawAssign === 'object') {
    for (const [uid, zone] of Object.entries(rawAssign)) {
      if (VALID_ZONES.includes(zone as LiveMatchZone)) {
        assignments[uid] = zone as LiveMatchZone;
      }
    }
  }
  const benchOrder = Array.isArray(o.benchOrder)
    ? (o.benchOrder.filter((s) => typeof s === 'string') as string[])
    : [];
  const readSlots = (raw: unknown): Record<UserId, number> | undefined => {
    if (!raw || typeof raw !== 'object') return undefined;
    const out: Record<UserId, number> = {};
    for (const [uid, idx] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof idx === 'number' && idx >= 0) out[uid] = idx;
    }
    return Object.keys(out).length ? out : undefined;
  };

  // Round counter — increments after every "סיים סיבוב" press.
  // Without explicit handling here the field was being stripped on
  // read, so the header rendered "סיבוב 1" forever even though the
  // value was being incremented in memory and persisted to Firestore
  // each time the admin started a new round. The next listener tick
  // wiped it back to undefined → display fell back to 1.
  const roundNumber =
    typeof o.roundNumber === 'number' && o.roundNumber > 0
      ? o.roundNumber
      : undefined;

  // Win tally per team. Reads each letter independently; any
  // non-number gets dropped (so legacy state without the field still
  // works). Same silent-strip bug as roundNumber — without this the
  // header team-scoreboard read `winsByTeam?.A ?? 0` and always saw
  // undefined.
  const readWins = (raw: unknown):
    | LiveMatchState['winsByTeam']
    | undefined => {
    if (!raw || typeof raw !== 'object') return undefined;
    const r = raw as Record<string, unknown>;
    const out: { A?: number; B?: number; C?: number; D?: number; E?: number } = {};
    for (const letter of ['A', 'B', 'C', 'D', 'E'] as const) {
      const v = r[letter];
      if (typeof v === 'number' && v >= 0) out[letter] = v;
    }
    return Object.keys(out).length ? out : undefined;
  };

  return {
    phase,
    assignments,
    benchOrder,
    scoreA: typeof o.scoreA === 'number' ? o.scoreA : 0,
    scoreB: typeof o.scoreB === 'number' ? o.scoreB : 0,
    // Advanced-mode per-round goal log. Without explicit handling the
    // field was silently stripped on read — the live goal log + the
    // round-end stats commit both rely on it.
    goals: Array.isArray(o.goals)
      ? (o.goals as unknown[])
          .filter(
            (x): x is import('@/types').RoundGoal =>
              !!x &&
              typeof x === 'object' &&
              typeof (x as { id?: unknown }).id === 'string' &&
              ((x as { team?: unknown }).team === 'A' ||
                (x as { team?: unknown }).team === 'B'),
          )
          .map((x) => ({
            id: x.id,
            team: x.team,
            scorerId: typeof x.scorerId === 'string' ? x.scorerId : null,
            // Keep the assister through deserialization — without this the
            // assist is stripped on every read, so the round-end stats commit
            // never sees it and per-player assist tallies stay 0 forever.
            assisterId: typeof x.assisterId === 'string' ? x.assisterId : undefined,
            ownGoal: x.ownGoal === true ? true : undefined,
            minute: typeof x.minute === 'number' ? x.minute : 0,
            at: typeof x.at === 'number' ? x.at : 0,
          }))
      : undefined,
    scoreC: typeof o.scoreC === 'number' ? o.scoreC : undefined,
    scoreD: typeof o.scoreD === 'number' ? o.scoreD : undefined,
    scoreE: typeof o.scoreE === 'number' ? o.scoreE : undefined,
    teamASlots: readSlots(o.teamASlots),
    teamBSlots: readSlots(o.teamBSlots),
    // Evening-long goal tally (drives the badge). Same strip-on-read risk as
    // the slots/round counter — without this it'd vanish on every read.
    goalTally: readSlots(o.goalTally),
    roundNumber,
    winsByTeam: readWins(o.winsByTeam),
    // Synced match clock — three primitives every device uses to
    // reconstruct the displayed time. Same strip-on-read bug as the
    // round counter above; without these passes the timer would
    // appear to "reset" on every Firestore listener tick.
    timerRunning: typeof o.timerRunning === 'boolean' ? o.timerRunning : undefined,
    timerLastStartedAt:
      typeof o.timerLastStartedAt === 'number'
        ? o.timerLastStartedAt
        : o.timerLastStartedAt === null
          ? null
          : undefined,
    timerAccumulatedMs:
      typeof o.timerAccumulatedMs === 'number' ? o.timerAccumulatedMs : undefined,
    timerControlledBy:
      typeof o.timerControlledBy === 'string' ? o.timerControlledBy : undefined,
    timerControlledByName:
      typeof o.timerControlledByName === 'string'
        ? o.timerControlledByName
        : undefined,
    // Stoppages log — without this pass the array gets stripped on every
    // listener tick and the history would flicker empty.
    timerEvents: Array.isArray(o.timerEvents)
      ? (o.timerEvents
          .filter(
            (e): e is { type: unknown; at: unknown; byName?: unknown } =>
              !!e && typeof e === 'object',
          )
          .map((e) => ({
            type: e.type,
            at: typeof e.at === 'number' ? e.at : 0,
            byName: typeof e.byName === 'string' ? e.byName : null,
          }))
          .filter(
            (e) =>
              (e.type === 'start' || e.type === 'resume' || e.type === 'pause') &&
              e.at > 0,
          ) as LiveMatchState['timerEvents'])
      : undefined,
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : undefined,
    startedAt: typeof o.startedAt === 'number' ? o.startedAt : undefined,
  };
}

const groupPublicConverter: FirestoreDataConverter<GroupPublic> = {
  toFirestore(g: GroupPublic) {
    return {
      name: g.name,
      normalizedName: g.normalizedName,
      fieldName: g.fieldName,
      fieldAddress: g.fieldAddress ?? null,
      city: g.city ?? null,
      // Geo coords — needed by the radius-based "nearby" filter. Were
      // missing from the converter and so silently dropped on every
      // public-mirror write/read; without them the filter degraded
      // to the city-name fallback path forever.
      lat: typeof g.lat === 'number' ? g.lat : null,
      lng: typeof g.lng === 'number' ? g.lng : null,
      street: g.street ?? null,
      addressNote: g.addressNote ?? null,
      description: g.description ?? null,
      memberCount: g.memberCount,
      isOpen: g.isOpen ?? null,
      maxMembers: g.maxMembers ?? null,
      contactPhone: g.contactPhone ?? null,
      // Cover photo — admin upload from the details screen lands here.
      // Was missing from the converter, so the public mirror kept
      // returning the default stadium fallback even after the admin
      // changed the cover. That's the bug surfaced today.
      coverPhotoUrl: g.coverPhotoUrl ?? null,
      coverImageId: g.coverImageId ?? null,
      preferredDays: g.preferredDays ?? [],
      preferredHour: g.preferredHour ?? null,
      costPerGame: g.costPerGame ?? null,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt ?? Date.now(),
    };
  },
  fromFirestore(snap): GroupPublic {
    const d = snap.data();
    return {
      id: snap.id,
      name: d.name ?? '',
      normalizedName: d.normalizedName ?? (d.name ?? '').toLowerCase().trim(),
      fieldName: d.fieldName ?? '',
      fieldAddress: d.fieldAddress ?? undefined,
      city: d.city ?? undefined,
      lat: typeof d.lat === 'number' ? d.lat : undefined,
      lng: typeof d.lng === 'number' ? d.lng : undefined,
      street: d.street ?? undefined,
      addressNote: d.addressNote ?? undefined,
      description: d.description ?? undefined,
      memberCount: d.memberCount ?? 0,
      isOpen: typeof d.isOpen === 'boolean' ? d.isOpen : undefined,
      maxMembers: typeof d.maxMembers === 'number' ? d.maxMembers : undefined,
      contactPhone:
        typeof d.contactPhone === 'string' ? d.contactPhone : undefined,
      coverPhotoUrl:
        typeof d.coverPhotoUrl === 'string' && d.coverPhotoUrl.length > 0
          ? d.coverPhotoUrl
          : undefined,
      coverImageId:
        typeof d.coverImageId === 'string' && d.coverImageId.length > 0
          ? d.coverImageId
          : undefined,
      preferredDays: readWeekdays(d.preferredDays),
      preferredHour:
        typeof d.preferredHour === 'string' ? d.preferredHour : undefined,
      costPerGame:
        typeof d.costPerGame === 'number' ? d.costPerGame : undefined,
      createdAt: d.createdAt ?? 0,
      updatedAt: d.updatedAt ?? undefined,
    };
  },
};

const joinRequestConverter: FirestoreDataConverter<GroupJoinRequestDoc> = {
  toFirestore(r) {
    return {
      groupId: r.groupId,
      userId: r.userId,
      status: r.status,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt ?? null,
      decidedBy: r.decidedBy ?? null,
    };
  },
  fromFirestore(snap): GroupJoinRequestDoc {
    const d = snap.data();
    return {
      id: snap.id,
      groupId: d.groupId,
      userId: d.userId,
      status: d.status,
      createdAt: d.createdAt ?? 0,
      decidedAt: d.decidedAt ?? undefined,
      decidedBy: d.decidedBy ?? undefined,
    };
  },
};

// Safe-parse the saved captain-draft split (חלוקת כוחות).
function readDraftTeamFeedback(
  v: unknown,
): Record<string, 'like' | 'dislike'> | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const out: Record<string, 'like' | 'dislike'> = {};
  for (const [uid, val] of Object.entries(o)) {
    if (val === 'like' || val === 'dislike') out[uid] = val;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function readDraftTeams(v: unknown): DraftTeamsResult | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const rawTeams = Array.isArray(o.teams) ? o.teams : [];
  const teams = rawTeams
    .map((t) => {
      if (!t || typeof t !== 'object') return null;
      const r = t as Record<string, unknown>;
      const playerIds = Array.isArray(r.playerIds)
        ? (r.playerIds.filter((x) => typeof x === 'string') as string[])
        : [];
      // Captain = stored captainId, or the first player as a fallback so the
      // "playerIds[0] is captain" invariant holds for any non-empty team.
      const captainId =
        typeof r.captainId === 'string' && r.captainId
          ? r.captainId
          : playerIds[0] ?? '';
      // Keep a team whose roster temporarily emptied out (everyone marked
      // "הלך הביתה") as long as it still has a captainId — it's a real slot the
      // live rotation references by index, and players can be restored into it.
      // Dropping it here used to delete the team and, when it left fewer than 2,
      // wipe the ENTIRE draftTeams (colours + leftHome included), breaking the
      // rotation for the whole evening (B02). Only genuinely malformed entries
      // (no captain AND no players) are discarded.
      if (!captainId && playerIds.length === 0) return null;
      return {
        index: typeof r.index === 'number' ? r.index : 0,
        captainId,
        playerIds,
        // Keep the admin-chosen colour through deserialization (else it'd be
        // stripped on read and the team would lose its "האדומים" name/tint).
        ...(typeof r.colorKey === 'string' ? { colorKey: r.colorKey } : {}),
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);
  // Dedupe players across teams: a corrupted split (bad rebalance / double-add)
  // can list the same uid twice — within one team or across two — producing the
  // "why am I in my team twice?" bug (user report). Keep each player only in the
  // FIRST team (by index) they appear in, and once within it. Self-heals bad
  // docs on read; new splits are also deduped at generation (balanceTeams).
  const seenPlayers = new Set<string>();
  for (const t of [...teams].sort((a, b) => a.index - b.index)) {
    t.playerIds = t.playerIds.filter((p) => {
      if (seenPlayers.has(p)) return false;
      seenPlayers.add(p);
      return true;
    });
  }
  // Only nuke the whole result when there's truly nothing left. A degraded
  // 1-team draft is preserved (colours/leftHome survive, the admin can restore
  // players) instead of vanishing to undefined and breaking every live control
  // (B30). Starting a rotation still requires ≥2 teams downstream.
  if (teams.length < 1) return undefined;
  const leftHome = Array.isArray(o.leftHome)
    ? o.leftHome
        .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
        .map((l) => ({
          playerId: typeof l.playerId === 'string' ? l.playerId : '',
          homeTeam: typeof l.homeTeam === 'number' ? l.homeTeam : 0,
          // Keep the departure time (drives the "הלך הביתה" timestamp); it was
          // being stripped on read.
          ...(typeof l.at === 'number' ? { at: l.at } : {}),
        }))
        .filter((l) => l.playerId)
    : undefined;
  return {
    method: o.method === 'regular' ? 'regular' : 'snake',
    numTeams: typeof o.numTeams === 'number' ? o.numTeams : teams.length,
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : 0,
    createdBy: typeof o.createdBy === 'string' ? o.createdBy : '',
    teams,
    fillMode: o.fillMode === 'permanent' ? 'permanent' : o.fillMode === 'temporary' ? 'temporary' : undefined,
    leftHome: leftHome && leftHome.length > 0 ? leftHome : undefined,
  };
}

function readRotation(v: unknown): import('@/types').MatchRotation | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const playing = Array.isArray(o.playing)
    ? (o.playing.filter((x) => typeof x === 'number') as number[])
    : [];
  if (playing.length !== 2) return undefined;
  const waiting = Array.isArray(o.waiting)
    ? (o.waiting.filter((x) => typeof x === 'number') as number[])
    : [];
  const loans = Array.isArray(o.loans)
    ? o.loans
        .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
        .map((l) => ({
          playerId: typeof l.playerId === 'string' ? l.playerId : '',
          homeTeam: typeof l.homeTeam === 'number' ? l.homeTeam : 0,
          filledTeam: typeof l.filledTeam === 'number' ? l.filledTeam : 0,
        }))
        .filter((l) => l.playerId)
    : [];
  const wins =
    o.wins && typeof o.wins === 'object'
      ? Object.fromEntries(
          Object.entries(o.wins as Record<string, unknown>).filter(
            ([, n]) => typeof n === 'number',
          ),
        ) as Record<string, number>
      : undefined;
  return {
    playing: [playing[0], playing[1]],
    waiting,
    loans,
    wins,
    round: typeof o.round === 'number' ? o.round : undefined,
    lastRoundWinners: Array.isArray(o.lastRoundWinners)
      ? (o.lastRoundWinners.filter((x) => typeof x === 'string') as string[])
      : undefined,
    lastRoundLosers: Array.isArray(o.lastRoundLosers)
      ? (o.lastRoundLosers.filter((x) => typeof x === 'string') as string[])
      : undefined,
    lastRoundAt: typeof o.lastRoundAt === 'number' ? o.lastRoundAt : undefined,
    baseTeams: Array.isArray(o.baseTeams)
      ? o.baseTeams
          .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
          .map((t) => ({
            index: typeof t.index === 'number' ? t.index : 0,
            playerIds: Array.isArray(t.playerIds)
              ? (t.playerIds.filter((p) => typeof p === 'string') as string[])
              : [],
          }))
      : undefined,
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : undefined,
  };
}

// Stored shape of a game doc — matches collection in Firestore.
// We exclude the matches[] array because rounds live in /rounds collection
// (one doc per round). gameService re-merges them into Game on read.
type GameDoc = Omit<Game, 'matches'>;

const gameDocConverter: FirestoreDataConverter<GameDoc> = {
  toFirestore(g) {
    return {
      groupId: g.groupId,
      title: g.title,
      startsAt: g.startsAt,
      fieldName: g.fieldName,
      fieldLat: g.fieldLat ?? null,
      fieldLng: g.fieldLng ?? null,
      maxPlayers: g.maxPlayers,
      minPlayers: g.minPlayers ?? null,
      // New flat ID arrays — community-membership lives on Group, not here.
      players: g.players,
      waitlist: g.waitlist,
      pending: g.pending ?? [],
      // Denormalized union — the "my games" query reads only this field.
      participantIds:
        g.participantIds ??
        Array.from(
          new Set<string>([
            ...((g.players as string[] | undefined) ?? []),
            ...((g.waitlist as string[] | undefined) ?? []),
            ...((g.pending as string[] | undefined) ?? []),
          ])
        ),
      ballHolderUserId: g.ballHolderUserId ?? null,
      jerseysHolderUserId: g.jerseysHolderUserId ?? null,
      ballBringerIds: Array.isArray(g.ballBringerIds)
        ? g.ballBringerIds
        : null,
      teams: g.teams ?? null,
      status: g.status,
      currentMatchIndex: g.currentMatchIndex,
      weather: g.weather ?? null,
      createdBy: g.createdBy ?? null,
      // `visibility` is now the only access-control flag. Default to
      // 'community' when missing — the conservative choice so a
      // half-built write never accidentally exposes a doc to the
      // global feed.
      visibility:
        g.visibility === 'public' || g.visibility === 'community'
          ? g.visibility
          : 'community',
      requiresApproval: g.requiresApproval ?? false,
      format: g.format ?? null,
      numberOfTeams: g.numberOfTeams ?? null,
      cancelDeadlineHours: g.cancelDeadlineHours ?? null,
      fieldType: g.fieldType ?? null,
      matchDurationMinutes: g.matchDurationMinutes ?? null,
      bringBall: g.bringBall ?? false,
      bringShirts: g.bringShirts ?? false,
      notes: g.notes ?? null,
      // Per-game location overrides + game-rule flags. Round-trip is
      // load-bearing for the GamesList filter chips and edit screen.
      fieldAddress: g.fieldAddress ?? null,
      city: g.city ?? null,
      hasReferee: g.hasReferee ?? false,
      hasPenalties: g.hasPenalties ?? false,
      hasHalfTime: g.hasHalfTime ?? false,
      ruleTags: Array.isArray(g.ruleTags) ? g.ruleTags : null,
      extraTimeMinutes:
        typeof g.extraTimeMinutes === 'number' && g.extraTimeMinutes > 0
          ? g.extraTimeMinutes
          : null,
      liveMatch: g.liveMatch ?? null,
      draftTeams: g.draftTeams ?? null,
      draftTeamFeedback: g.draftTeamFeedback ?? null,
      rotation: g.rotation ?? null,
      reminderSent: g.reminderSent ?? false,
      rateReminderSent: g.rateReminderSent ?? false,
      capacityNoticeSent: g.capacityNoticeSent ?? false,
      rsvpNudgeSent: g.rsvpNudgeSent ?? false,
      arrivals: g.arrivals ?? null,
      cancellations: g.cancellations ?? null,
      joinedAt: g.joinedAt ?? null,
      pinnedMessage:
        typeof g.pinnedMessage === 'string' && g.pinnedMessage.length > 0
          ? g.pinnedMessage
          : null,
      isOrphanContext: g.isOrphanContext === true,
      promotePromptSent: g.promotePromptSent === true,
      autoTeamGenerationMinutesBeforeStart:
        g.autoTeamGenerationMinutesBeforeStart ?? null,
      autoTeamsAt: g.autoTeamsAt ?? null,
      autoTeamsMethod: g.autoTeamsMethod ?? null,
      teamsNotifiedAt: g.teamsNotifiedAt ?? null,
      autoTeamsGeneratedAt: g.autoTeamsGeneratedAt ?? null,
      autoTeamsGeneratedBy: g.autoTeamsGeneratedBy ?? null,
      teamsEditedManually: g.teamsEditedManually ?? false,
      teamBalanceMeta: g.teamBalanceMeta ?? null,
      // Deferred-open recurring games. `registrationOpensAt` is the
      // ms epoch the CF flips status from 'scheduled' to 'open' at;
      // `openedNotificationSent` is the idempotency latch the CF
      // sets after firing the "registration opened" push so a retry
      // doesn't double-notify. Both round-trip through the converter
      // (createGameV2 → addDoc → toFirestore) — leaving them out
      // here silently drops them at write time.
      registrationOpensAt:
        typeof g.registrationOpensAt === 'number' && g.registrationOpensAt > 0
          ? g.registrationOpensAt
          : null,
      openedNotificationSent: g.openedNotificationSent ?? false,
      // Recurring auto-clone + scheduled visibility/guest gating — SAME
      // round-trip class as registrationOpensAt above. Omitting these dropped
      // them at write time (createGameV2 → addDoc → toFirestore), silently
      // killing the weekly clone (CF queries `recurring==true`), the
      // community→public flip (`publicOpenAt`), and the non-admin guest gate
      // (`guestsOpenAt`). The mock create-path kept them, hiding it in tests.
      recurring: g.recurring === true ? true : null,
      recurringNextCreatedAt:
        typeof g.recurringNextCreatedAt === 'number' ? g.recurringNextCreatedAt : null,
      publicOpenAt: typeof g.publicOpenAt === 'number' ? g.publicOpenAt : null,
      publicOpenedAt: typeof g.publicOpenedAt === 'number' ? g.publicOpenedAt : null,
      guestsOpenAt: typeof g.guestsOpenAt === 'number' ? g.guestsOpenAt : null,
      pendingPromotion: g.pendingPromotion ?? null,
      // Cross-community filler matching opt-in. Both fields round-
      // trip through the converter so the wizard's settings persist.
      // Default `acceptsFillers` to false for legacy game docs that
      // pre-date the field, so they don't accidentally enter the
      // matcher's pool until the admin opts in via GameEdit.
      acceptsFillers: g.acceptsFillers === true,
      fillerMinTrust:
        typeof g.fillerMinTrust === 'number' ? g.fillerMinTrust : null,
      // Advanced game mode + its sub-options (see Game type). Master flag
      // drives the advanced live UI; sub-options are captured for later logic.
      advancedMode: g.advancedMode === true,
      advancedFillMode:
        g.advancedFillMode === 'permanent' || g.advancedFillMode === 'temporary'
          ? g.advancedFillMode
          : null,
      advancedTieMode:
        g.advancedTieMode === 'bothOut' || g.advancedTieMode === 'veteranOut'
          ? g.advancedTieMode
          : null,
      guests: Array.isArray(g.guests)
        ? (g.guests as import('@/types').GameGuest[]).map((x) => ({
            id: x.id,
            name: x.name,
            estimatedRating:
              typeof x.estimatedRating === 'number' ? x.estimatedRating : null,
            addedBy: x.addedBy,
            createdAt: x.createdAt,
            ...(x.waitlisted ? { waitlisted: true } : {}),
          }))
        : [],
      createdAt: g.createdAt,
      updatedAt: g.updatedAt ?? Date.now(),
    };
  },
  fromFirestore(snap): GameDoc {
    const d = snap.data();
    // Stage 2 lifecycle: accept all valid GameStatus values; anything
    // unrecognised collapses to 'open' so a typo in Firestore can't
    // brick the screen. Legacy docs missing the field also fall back
    // to 'open' (the safe default — list filters will exclude games
    // whose start time has passed regardless).
    const rawStatus = d.status;
    const status: GameDoc['status'] =
      rawStatus === 'scheduled' ||
      rawStatus === 'open' ||
      rawStatus === 'locked' ||
      rawStatus === 'active' ||
      rawStatus === 'finished' ||
      rawStatus === 'cancelled'
        ? rawStatus
        : 'open';
    const fmt = d.format;
    const format: GameDoc['format'] =
      fmt === '4v4' || fmt === '5v5' || fmt === '6v6' || fmt === '7v7'
        ? fmt
        : undefined;
    return {
      id: snap.id,
      groupId: d.groupId,
      title: d.title ?? '',
      startsAt: d.startsAt ?? Date.now(),
      fieldName: d.fieldName ?? '',
      fieldLat: d.fieldLat ?? undefined,
      fieldLng: d.fieldLng ?? undefined,
      maxPlayers: d.maxPlayers ?? 15,
      minPlayers: typeof d.minPlayers === 'number' ? d.minPlayers : undefined,
      // Backward-compat: docs written before the rename used
      // `registeredUserIds` / `waitlistUserIds` / `pendingUserIds`. If the
      // new fields are missing or empty, fall back to the old ones so old
      // data is still readable in the new UI.
      players:
        Array.isArray(d.players) && d.players.length > 0
          ? d.players
          : Array.isArray(d.registeredUserIds)
            ? d.registeredUserIds
            : [],
      waitlist:
        Array.isArray(d.waitlist) && d.waitlist.length > 0
          ? d.waitlist
          : Array.isArray(d.waitlistUserIds)
            ? d.waitlistUserIds
            : [],
      pending:
        Array.isArray(d.pending) && d.pending.length > 0
          ? d.pending
          : Array.isArray(d.pendingUserIds)
            ? d.pendingUserIds
            : [],
      // participantIds may be missing on old docs — derive from the others.
      participantIds: Array.isArray(d.participantIds)
        ? d.participantIds
        : Array.from(
            new Set([
              ...(Array.isArray(d.players) ? d.players : []),
              ...(Array.isArray(d.waitlist) ? d.waitlist : []),
              ...(Array.isArray(d.pending) ? d.pending : []),
              ...(Array.isArray(d.registeredUserIds) ? d.registeredUserIds : []),
              ...(Array.isArray(d.waitlistUserIds) ? d.waitlistUserIds : []),
              ...(Array.isArray(d.pendingUserIds) ? d.pendingUserIds : []),
            ])
          ),
      // Organizer-rejected users — kept so a rejected request can't be
      // re-sent (read back by joinGameV2's block).
      rejectedPlayerIds: Array.isArray(d.rejectedPlayerIds)
        ? (d.rejectedPlayerIds as unknown[]).filter(
            (u): u is string => typeof u === 'string',
          )
        : undefined,
      // Users explicitly invited to this game — they bypass approval, so the
      // join CTA reads "join" not "request to join" for them.
      invitedUserIds: Array.isArray(d.invitedUserIds)
        ? (d.invitedUserIds as unknown[]).filter(
            (u): u is string => typeof u === 'string',
          )
        : undefined,
      ballHolderUserId: d.ballHolderUserId ?? undefined,
      jerseysHolderUserId: d.jerseysHolderUserId ?? undefined,
      ballBringerIds: Array.isArray(d.ballBringerIds)
        ? (d.ballBringerIds as unknown[]).filter(
            (u): u is string => typeof u === 'string',
          )
        : undefined,
      teams: d.teams ?? undefined,
      status,
      locked: status !== 'open',
      currentMatchIndex: d.currentMatchIndex ?? 0,
      weather: d.weather ?? undefined,
      createdBy: typeof d.createdBy === 'string' ? d.createdBy : undefined,
      // Default missing visibility to 'community' so legacy docs are
      // hidden from the public feed until an admin explicitly opens
      // them. Never project unknowns as 'public' — that would be a
      // silent data leak.
      visibility:
        d.visibility === 'public' || d.visibility === 'community'
          ? d.visibility
          : 'community',
      requiresApproval: d.requiresApproval === true,
      format,
      numberOfTeams:
        typeof d.numberOfTeams === 'number' && d.numberOfTeams >= 2
          ? d.numberOfTeams
          : undefined,
      cancelDeadlineHours:
        typeof d.cancelDeadlineHours === 'number'
          ? d.cancelDeadlineHours
          : undefined,
      fieldType: readFieldType(d.fieldType),
      matchDurationMinutes:
        typeof d.matchDurationMinutes === 'number' &&
        d.matchDurationMinutes > 0
          ? d.matchDurationMinutes
          : undefined,
      bringBall: d.bringBall === true,
      bringShirts: d.bringShirts === true,
      notes: typeof d.notes === 'string' ? d.notes : undefined,
      fieldAddress:
        typeof d.fieldAddress === 'string' ? d.fieldAddress : undefined,
      city: typeof d.city === 'string' ? d.city : undefined,
      hasReferee: d.hasReferee === true,
      hasPenalties: d.hasPenalties === true,
      hasHalfTime: d.hasHalfTime === true,
      ruleTags: Array.isArray(d.ruleTags)
        ? (d.ruleTags as unknown[])
            .filter(
              (t): t is string => typeof t === 'string' && t.trim().length > 0,
            )
            .map((t) => t.trim().slice(0, 30))
            .slice(0, 12)
        : undefined,
      extraTimeMinutes:
        typeof d.extraTimeMinutes === 'number' && d.extraTimeMinutes > 0
          ? d.extraTimeMinutes
          : undefined,
      liveMatch: readLiveMatch(d.liveMatch),
      draftTeams: readDraftTeams(d.draftTeams),
      draftTeamFeedback: readDraftTeamFeedback(d.draftTeamFeedback),
      rotation: readRotation(d.rotation),
      reminderSent: d.reminderSent === true,
      rateReminderSent: d.rateReminderSent === true,
      capacityNoticeSent: d.capacityNoticeSent === true,
      rsvpNudgeSent: d.rsvpNudgeSent === true,
      arrivals: readArrivals(d.arrivals),
      cancellations: readCancellations(d.cancellations),
      // readCancellations is a generic uid→positive-ms map reader; reuse it.
      joinedAt: readCancellations(d.joinedAt),
      pinnedMessage:
        typeof d.pinnedMessage === 'string' && d.pinnedMessage.length > 0
          ? d.pinnedMessage
          : undefined,
      isOrphanContext: d.isOrphanContext === true,
      promotePromptSent: d.promotePromptSent === true,
      autoTeamGenerationMinutesBeforeStart:
        typeof d.autoTeamGenerationMinutesBeforeStart === 'number' &&
        d.autoTeamGenerationMinutesBeforeStart > 0
          ? d.autoTeamGenerationMinutesBeforeStart
          : undefined,
      autoTeamsAt:
        typeof d.autoTeamsAt === 'number' && d.autoTeamsAt > 0
          ? d.autoTeamsAt
          : undefined,
      autoTeamsMethod:
        d.autoTeamsMethod === 'rating' || d.autoTeamsMethod === 'random'
          ? d.autoTeamsMethod
          : undefined,
      teamsNotifiedAt:
        typeof d.teamsNotifiedAt === 'number' ? d.teamsNotifiedAt : undefined,
      autoTeamsGeneratedAt:
        typeof d.autoTeamsGeneratedAt === 'number'
          ? d.autoTeamsGeneratedAt
          : undefined,
      autoTeamsGeneratedBy:
        d.autoTeamsGeneratedBy === 'system' ? 'system' : undefined,
      recurring: d.recurring === true ? true : undefined,
      recurringNextCreatedAt:
        typeof d.recurringNextCreatedAt === 'number'
          ? d.recurringNextCreatedAt
          : undefined,
      publicOpenAt:
        typeof d.publicOpenAt === 'number' ? d.publicOpenAt : undefined,
      publicOpenedAt:
        typeof d.publicOpenedAt === 'number' ? d.publicOpenedAt : undefined,
      guestsOpenAt:
        typeof d.guestsOpenAt === 'number' ? d.guestsOpenAt : undefined,
      pendingPromotion:
        d.pendingPromotion &&
        typeof d.pendingPromotion === 'object' &&
        typeof d.pendingPromotion.uid === 'string'
          ? {
              uid: d.pendingPromotion.uid as string,
              offeredAt:
                typeof d.pendingPromotion.offeredAt === 'number'
                  ? d.pendingPromotion.offeredAt
                  : 0,
            }
          : undefined,
      teamsEditedManually: d.teamsEditedManually === true,
      teamBalanceMeta: readTeamBalanceMeta(d.teamBalanceMeta),
      guests: readGuests(d.guests),
      registrationOpensAt:
        typeof d.registrationOpensAt === 'number' && d.registrationOpensAt > 0
          ? d.registrationOpensAt
          : undefined,
      openedNotificationSent: d.openedNotificationSent === true,
      acceptsFillers: d.acceptsFillers === true,
      fillerMinTrust:
        typeof d.fillerMinTrust === 'number' ? d.fillerMinTrust : undefined,
      advancedMode: d.advancedMode === true,
      advancedFillMode:
        d.advancedFillMode === 'permanent' || d.advancedFillMode === 'temporary'
          ? d.advancedFillMode
          : undefined,
      advancedTieMode:
        d.advancedTieMode === 'bothOut' || d.advancedTieMode === 'veteranOut'
          ? d.advancedTieMode
          : undefined,
      createdAt: d.createdAt ?? 0,
      updatedAt: d.updatedAt ?? undefined,
    };
  },
};

function readGuests(v: unknown): import('@/types').GameGuest[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: import('@/types').GameGuest[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.name !== 'string') continue;
    // Rating scale is 1.0–5.0. Reject out-of-range (incl. legacy 1–10 values)
    // so a stale "8" never renders on a 1–5 scale — drop rather than show wrong.
    const rating =
      typeof o.estimatedRating === 'number' &&
      o.estimatedRating >= 1 &&
      o.estimatedRating <= 5
        ? o.estimatedRating
        : undefined;
    // OMIT the key when there's no rating instead of writing
    // `estimatedRating: undefined`. Callers (addGuest / updateGuest)
    // re-write the whole `guests` array via tx.update, which bypasses
    // the converter. If the projected object carried the key with
    // `undefined`, that value would land in the next write and
    // Firestore would reject the whole transaction.
    out.push({
      id: o.id,
      name: o.name,
      addedBy: typeof o.addedBy === 'string' ? o.addedBy : '',
      createdAt: typeof o.createdAt === 'number' ? o.createdAt : 0,
      ...(rating !== undefined ? { estimatedRating: rating } : {}),
      ...(o.waitlisted === true ? { waitlisted: true } : {}),
    });
  }
  return out;
}

function readTeamBalanceMeta(
  v: unknown,
): import('@/types').Game['teamBalanceMeta'] | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.generatedAt !== 'number') return undefined;
  if (o.algorithm !== 'rating_greedy_v1') return undefined;
  return {
    generatedAt: o.generatedAt,
    algorithm: 'rating_greedy_v1',
    unratedCount: typeof o.unratedCount === 'number' ? o.unratedCount : 0,
    teamRatings: Array.isArray(o.teamRatings)
      ? o.teamRatings.filter((n): n is number => typeof n === 'number')
      : [],
  };
}

function readCancellations(v: unknown): Record<string, number> | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    // Defensive: only accept positive ms timestamps. Drop garbage so a
    // single bad entry can't blow up the discipline snapshot.
    if (typeof val === 'number' && val > 0) out[k] = val;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function readArrivals(
  v: unknown,
): Record<string, ArrivalStatus> | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const out: Record<string, ArrivalStatus> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (
      val === 'unknown' ||
      val === 'arrived' ||
      val === 'late' ||
      val === 'no_show'
    ) {
      out[k] = val;
    }
  }
  return out;
}

export type { GameDoc };

const roundConverter: FirestoreDataConverter<MatchRound & { id: string; gameId: string }> = {
  toFirestore(r) {
    return {
      gameId: r.gameId,
      index: r.index,
      teamA: r.teamA,
      teamB: r.teamB,
      waiting: r.waiting,
      goalkeeperA: r.goalkeeperA,
      goalkeeperB: r.goalkeeperB,
      startedAt: r.startedAt ?? null,
      endedAt: r.endedAt ?? null,
      winner: r.winner ?? null,
      // Per-round history — previously dropped here (saveGame wrote them but the
      // converter didn't serialize them), permanently losing the goal log,
      // end-of-round rosters ("who played with whom"), and per-round score.
      goals: Array.isArray(r.goals) ? r.goals : null,
      teamAPlayerIds: Array.isArray(r.teamAPlayerIds) ? r.teamAPlayerIds : null,
      teamBPlayerIds: Array.isArray(r.teamBPlayerIds) ? r.teamBPlayerIds : null,
      scoreA: typeof r.scoreA === 'number' ? r.scoreA : null,
      scoreB: typeof r.scoreB === 'number' ? r.scoreB : null,
    };
  },
  fromFirestore(snap) {
    const d = snap.data();
    return {
      id: snap.id,
      gameId: d.gameId,
      index: d.index,
      teamA: d.teamA,
      teamB: d.teamB,
      waiting: d.waiting,
      goalkeeperA: d.goalkeeperA,
      goalkeeperB: d.goalkeeperB,
      startedAt: d.startedAt ?? undefined,
      endedAt: d.endedAt ?? undefined,
      winner: d.winner ?? undefined,
      goals: Array.isArray(d.goals) ? d.goals : undefined,
      teamAPlayerIds: Array.isArray(d.teamAPlayerIds)
        ? d.teamAPlayerIds.filter((x: unknown) => typeof x === 'string')
        : undefined,
      teamBPlayerIds: Array.isArray(d.teamBPlayerIds)
        ? d.teamBPlayerIds.filter((x: unknown) => typeof x === 'string')
        : undefined,
      scoreA: typeof d.scoreA === 'number' ? d.scoreA : undefined,
      scoreB: typeof d.scoreB === 'number' ? d.scoreB : undefined,
    };
  },
};

const playerStatsConverter: FirestoreDataConverter<PlayerStats & { id: string }> = {
  toFirestore(s) {
    return {
      gamesPlayed: s.gamesPlayed,
      wins: s.wins,
      losses: s.losses,
      ties: s.ties,
      attendancePct: s.attendancePct,
      cancelRate: s.cancelRate,
    };
  },
  fromFirestore(snap) {
    const d = snap.data();
    return {
      id: snap.id,
      gamesPlayed: d.gamesPlayed ?? 0,
      wins: d.wins ?? 0,
      losses: d.losses ?? 0,
      ties: d.ties ?? 0,
      attendancePct: d.attendancePct ?? 0,
      cancelRate: d.cancelRate ?? 0,
    };
  },
};

// ─── Collection accessors ──────────────────────────────────────────────────
// These throw if called while USE_MOCK_DATA is true via getFirebase().

const chatMessageConverter: FirestoreDataConverter<ChatMessage> = {
  toFirestore(m: ChatMessage) {
    return {
      text: m.text,
      senderId: m.senderId,
      senderName: m.senderName,
      // Only write optional avatar fields when present — Firestore rejects
      // `undefined`, and a sender may have neither an avatarId nor a photoUrl.
      ...(m.senderAvatarId ? { senderAvatarId: m.senderAvatarId } : {}),
      ...(m.senderPhotoUrl ? { senderPhotoUrl: m.senderPhotoUrl } : {}),
      createdAt: m.createdAt,
    };
  },
  fromFirestore(snap: QueryDocumentSnapshot<DocumentData>): ChatMessage {
    const d = snap.data();
    return {
      id: snap.id,
      text: typeof d.text === 'string' ? d.text : '',
      senderId: typeof d.senderId === 'string' ? d.senderId : '',
      senderName: typeof d.senderName === 'string' ? d.senderName : '',
      senderAvatarId: typeof d.senderAvatarId === 'string' ? d.senderAvatarId : undefined,
      senderPhotoUrl: typeof d.senderPhotoUrl === 'string' ? d.senderPhotoUrl : undefined,
      createdAt: typeof d.createdAt === 'number' ? d.createdAt : Date.now(),
    };
  },
};

const friendRequestConverter: FirestoreDataConverter<FriendRequestDoc> = {
  toFirestore(r: FriendRequestDoc) {
    return {
      fromUserId: r.fromUserId,
      toUserId: r.toUserId,
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt ?? Date.now(),
    };
  },
  fromFirestore(snap: QueryDocumentSnapshot<DocumentData>): FriendRequestDoc {
    const d = snap.data();
    return {
      id: snap.id,
      fromUserId: typeof d.fromUserId === 'string' ? d.fromUserId : '',
      toUserId: typeof d.toUserId === 'string' ? d.toUserId : '',
      status: (d.status as FriendRequestStatus) ?? 'pending',
      createdAt: typeof d.createdAt === 'number' ? d.createdAt : Date.now(),
      updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : undefined,
    };
  },
};

export const col = {
  users(): CollectionReference<User> {
    return collection(getFirebase().db, 'users').withConverter(userConverter);
  },
  groups(): CollectionReference<Group> {
    return collection(getFirebase().db, 'groups').withConverter(groupConverter);
  },
  groupsPublic(): CollectionReference<GroupPublic> {
    return collection(getFirebase().db, 'groupsPublic').withConverter(groupPublicConverter);
  },
  joinRequests(): CollectionReference<GroupJoinRequestDoc> {
    return collection(getFirebase().db, 'groupJoinRequests').withConverter(
      joinRequestConverter
    );
  },
  games(): CollectionReference<GameDoc> {
    return collection(getFirebase().db, 'games').withConverter(gameDocConverter);
  },
  rounds() {
    return collection(getFirebase().db, 'rounds').withConverter(roundConverter);
  },
  playerStats() {
    return collection(getFirebase().db, 'playerStats').withConverter(playerStatsConverter);
  },
  /** Per-pair "played/won together" rollups, keyed a__b with `a`/`b` uids. */
  pairStats() {
    return collection(getFirebase().db, 'pairStats');
  },
  /** Phase E: outbound queue of FCM dispatches (consumed by Cloud Function). */
  notifications() {
    return collection(getFirebase().db, 'notifications');
  },
  /** Pending/accepted/declined friendship requests. */
  friendRequests(): CollectionReference<FriendRequestDoc> {
    return collection(getFirebase().db, 'friendRequests').withConverter(
      friendRequestConverter,
    );
  },
  /** Per-user unread index: /users/{uid}/chatUnread/{chatKey}. */
  userChatUnread(uid: UserId) {
    return collection(getFirebase().db, 'users', uid, 'chatUnread');
  },
  /** Per-user, per-chat settings (mute): /users/{uid}/chatSettings/{chatKey}. */
  userChatSettings(uid: UserId) {
    return collection(getFirebase().db, 'users', uid, 'chatSettings');
  },
  /** Per-user block list: /users/{uid}/blocked/{blockedUid}. */
  userBlocked(uid: UserId) {
    return collection(getFirebase().db, 'users', uid, 'blocked');
  },
  /** Read receipts for a game chat: /games/{id}/reads/{uid}. */
  gameReads(gameId: string) {
    return collection(getFirebase().db, 'games', gameId, 'reads');
  },
  /** Read receipts for a community chat: /groups/{gid}/reads/{uid}. */
  groupReads(groupId: GroupId) {
    return collection(getFirebase().db, 'groups', groupId, 'reads');
  },
  /** Typing indicators for a game chat: /games/{id}/typing/{uid}. */
  gameTyping(gameId: string) {
    return collection(getFirebase().db, 'games', gameId, 'typing');
  },
  /** Typing indicators for a community chat: /groups/{gid}/typing/{uid}. */
  groupTyping(groupId: GroupId) {
    return collection(getFirebase().db, 'groups', groupId, 'typing');
  },
  /** Store-safety: reported chat messages. */
  chatReports() {
    return collection(getFirebase().db, 'chatReports');
  },
  /** Game chat messages: /games/{gameId}/messages/{id} (players only). */
  gameMessages(gameId: string): CollectionReference<ChatMessage> {
    return collection(getFirebase().db, 'games', gameId, 'messages').withConverter(
      chatMessageConverter,
    );
  },
  /** Community chat messages: /groups/{gid}/messages/{id} (members only). */
  groupMessages(groupId: GroupId): CollectionReference<ChatMessage> {
    return collection(getFirebase().db, 'groups', groupId, 'messages').withConverter(
      chatMessageConverter,
    );
  },
  /** Direct (1-on-1) chat messages: /dmConversations/{convId}/messages/{id}. */
  dmMessages(convId: string): CollectionReference<ChatMessage> {
    return collection(
      getFirebase().db,
      'dmConversations',
      convId,
      'messages',
    ).withConverter(chatMessageConverter);
  },
  /** Read receipts for a DM: /dmConversations/{convId}/reads/{uid}. */
  dmReads(convId: string) {
    return collection(getFirebase().db, 'dmConversations', convId, 'reads');
  },
  /** Typing indicators for a DM: /dmConversations/{convId}/typing/{uid}. */
  dmTyping(convId: string) {
    return collection(getFirebase().db, 'dmConversations', convId, 'typing');
  },
  /** A DM conversation metadata doc: /dmConversations/{convId}. */
  dmConversation(convId: string) {
    return doc(getFirebase().db, 'dmConversations', convId);
  },
  /** Per-community rating summaries: /groups/{gid}/ratings/{uid}. */
  ratings(groupId: GroupId) {
    return collection(getFirebase().db, 'groups', groupId, 'ratings');
  },
  /** Individual votes nested under a summary: /groups/{gid}/ratings/{uid}/votes/{raterUid}. */
  ratingVotes(groupId: GroupId, ratedUserId: UserId) {
    return collection(
      getFirebase().db,
      'groups',
      groupId,
      'ratings',
      ratedUserId,
      'votes',
    );
  },
  /** GLOBAL (cross-community) rating summaries: /ratings/{uid}. */
  globalRatings() {
    return collection(getFirebase().db, 'ratings');
  },
  /** Global votes nested under a summary: /ratings/{uid}/votes/{raterUid}. */
  globalRatingVotes(ratedUserId: UserId) {
    return collection(getFirebase().db, 'ratings', ratedUserId, 'votes');
  },
};

export const docs = {
  user(uid: UserId): DocumentReference<User> {
    return doc(col.users(), uid);
  },
  group(gid: GroupId): DocumentReference<Group> {
    return doc(col.groups(), gid);
  },
  groupPublic(gid: GroupId): DocumentReference<GroupPublic> {
    return doc(col.groupsPublic(), gid);
  },
  joinRequest(rid: string): DocumentReference<GroupJoinRequestDoc> {
    return doc(col.joinRequests(), rid);
  },
  friendRequest(rid: string): DocumentReference<FriendRequestDoc> {
    return doc(col.friendRequests(), rid);
  },
  game(id: string): DocumentReference<GameDoc> {
    return doc(col.games(), id);
  },
  round(id: string) {
    return doc(col.rounds(), id);
  },
  playerStats(uid: UserId) {
    return doc(col.playerStats(), uid);
  },
  ratingSummary(groupId: GroupId, ratedUserId: UserId) {
    return doc(col.ratings(groupId), ratedUserId);
  },
  ratingVote(groupId: GroupId, ratedUserId: UserId, raterUserId: UserId) {
    return doc(col.ratingVotes(groupId, ratedUserId), raterUserId);
  },
  /** GLOBAL rating summary doc: /ratings/{uid}. */
  globalRatingSummary(ratedUserId: UserId) {
    return doc(col.globalRatings(), ratedUserId);
  },
  /** GLOBAL vote doc: /ratings/{uid}/votes/{raterUid}. */
  globalRatingVote(ratedUserId: UserId, raterUserId: UserId) {
    return doc(col.globalRatingVotes(ratedUserId), raterUserId);
  },
  // Self-only sub-doc for sensitive per-user state. fcmTokens +
  // notificationPrefs live here so other authenticated users can't
  // read them via the public /users/{uid} doc. The Cloud Function
  // reads via Admin SDK (rules bypass).
  userPrivatePush(uid: UserId) {
    // CRITICAL: build the path without inheriting the User converter.
    // `col.users()` carries `withConverter(userConverter)` which then
    // propagates to every descendant ref. `doc(col.users(), uid,
    // 'private', 'push')` would return a DocumentReference<User>, and
    // any `setDoc` on it would invoke `userConverter.toFirestore`,
    // which expects a User and explodes on `u.name = undefined` for
    // the push-only payload we're actually trying to write
    // (`{ fcmTokens, updatedAt }`). The end result was a silent
    // failure: every device-token registration since this converter
    // was added has been throwing "Unsupported field value:
    // undefined". Using the raw Firestore instance avoids the
    // converter inheritance.
    return doc(getFirebase().db, 'users', uid, 'private', 'push');
  },
};

export { serverTimestamp };
