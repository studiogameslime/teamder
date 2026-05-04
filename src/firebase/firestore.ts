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
  Game,
  Group,
  GroupId,
  GroupPublic,
  Jersey,
  JerseyPattern,
  LiveMatchPhase,
  LiveMatchState,
  LiveMatchZone,
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
    timeFrom: typeof a.timeFrom === 'string' ? a.timeFrom : undefined,
    timeTo: typeof a.timeTo === 'string' ? a.timeTo : undefined,
    preferredCity:
      typeof a.preferredCity === 'string' ? a.preferredCity : undefined,
    isAvailableForInvites: a.isAvailableForInvites !== false,
  };
}

function readStats(d: DocumentData): UserStats | undefined {
  const s = d.stats;
  if (!s || typeof s !== 'object') return undefined;
  return {
    totalGames: typeof s.totalGames === 'number' ? s.totalGames : 0,
    attended: typeof s.attended === 'number' ? s.attended : 0,
    cancelled: typeof s.cancelled === 'number' ? s.cancelled : 0,
  };
}

const userConverter: FirestoreDataConverter<User> = {
  toFirestore(u: User) {
    return {
      name: u.name,
      email: u.email ?? null,
      avatarId: u.avatarId ?? null,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt ?? Date.now(),
      onboardingCompleted: u.onboardingCompleted ?? false,
      availability: u.availability
        ? {
            preferredDays: u.availability.preferredDays ?? [],
            timeFrom: u.availability.timeFrom ?? null,
            timeTo: u.availability.timeTo ?? null,
            preferredCity: u.availability.preferredCity ?? null,
            isAvailableForInvites: u.availability.isAvailableForInvites !== false,
          }
        : null,
      stats: u.stats
        ? {
            totalGames: u.stats.totalGames,
            attended: u.stats.attended,
            cancelled: u.stats.cancelled,
          }
        : null,
      fcmTokens: u.fcmTokens ?? [],
      notificationPrefs: u.notificationPrefs ?? null,
      newGameSubscriptions: u.newGameSubscriptions ?? [],
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
      // photoUrl kept readable for legacy docs; never written by new code.
      photoUrl: d.photoUrl ?? undefined,
      createdAt: typeof d.createdAt === 'number' ? d.createdAt : Date.now(),
      updatedAt: d.updatedAt ?? undefined,
      onboardingCompleted: d.onboardingCompleted === true,
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
      jersey: readJersey(d.jersey),
      achievements: readAchievements(d.achievements),
      discipline: readDiscipline(d.discipline),
      invitedBy: typeof d.invitedBy === 'string' ? d.invitedBy : undefined,
      invitedByType:
        d.invitedByType === 'session' || d.invitedByType === 'team'
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
        return [{ id: x.id, unlockedAt: x.unlockedAt }];
      })
    : [];
  return {
    ...defaultAchievementState,
    unlocked,
    gamesJoined: typeof o.gamesJoined === 'number' ? o.gamesJoined : 0,
    teamsCreated: typeof o.teamsCreated === 'number' ? o.teamsCreated : 0,
    teamsJoined: typeof o.teamsJoined === 'number' ? o.teamsJoined : 0,
    invitesSent: typeof o.invitesSent === 'number' ? o.invitesSent : 0,
    playersCoached: typeof o.playersCoached === 'number' ? o.playersCoached : 0,
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
      adminIds: d.adminIds ?? [],
      playerIds: d.playerIds ?? [],
      pendingPlayerIds: d.pendingPlayerIds ?? [],
      inviteCode: d.inviteCode ?? '',
      isOpen: typeof d.isOpen === 'boolean' ? d.isOpen : undefined,
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
  return v === '5v5' || v === '6v6' || v === '7v7' ? v : undefined;
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

function readLiveMatch(v: unknown): LiveMatchState | undefined {
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
  const lateUserIds = Array.isArray(o.lateUserIds)
    ? (o.lateUserIds.filter((s) => typeof s === 'string') as string[])
    : [];
  const readSlots = (raw: unknown): Record<UserId, number> | undefined => {
    if (!raw || typeof raw !== 'object') return undefined;
    const out: Record<UserId, number> = {};
    for (const [uid, idx] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof idx === 'number' && idx >= 0) out[uid] = idx;
    }
    return Object.keys(out).length ? out : undefined;
  };

  return {
    phase,
    assignments,
    benchOrder,
    scoreA: typeof o.scoreA === 'number' ? o.scoreA : 0,
    scoreB: typeof o.scoreB === 'number' ? o.scoreB : 0,
    scoreC: typeof o.scoreC === 'number' ? o.scoreC : undefined,
    scoreD: typeof o.scoreD === 'number' ? o.scoreD : undefined,
    scoreE: typeof o.scoreE === 'number' ? o.scoreE : undefined,
    teamASlots: readSlots(o.teamASlots),
    teamBSlots: readSlots(o.teamBSlots),
    lateUserIds,
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : undefined,
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
      street: g.street ?? null,
      addressNote: g.addressNote ?? null,
      description: g.description ?? null,
      memberCount: g.memberCount,
      isOpen: g.isOpen ?? null,
      maxMembers: g.maxMembers ?? null,
      contactPhone: g.contactPhone ?? null,
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
      street: d.street ?? undefined,
      addressNote: d.addressNote ?? undefined,
      description: d.description ?? undefined,
      memberCount: d.memberCount ?? 0,
      isOpen: typeof d.isOpen === 'boolean' ? d.isOpen : undefined,
      maxMembers: typeof d.maxMembers === 'number' ? d.maxMembers : undefined,
      contactPhone:
        typeof d.contactPhone === 'string' ? d.contactPhone : undefined,
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
      extraTimeMinutes:
        typeof g.extraTimeMinutes === 'number' && g.extraTimeMinutes > 0
          ? g.extraTimeMinutes
          : null,
      liveMatch: g.liveMatch ?? null,
      reminderSent: g.reminderSent ?? false,
      rateReminderSent: g.rateReminderSent ?? false,
      capacityNoticeSent: g.capacityNoticeSent ?? false,
      arrivals: g.arrivals ?? null,
      cancellations: g.cancellations ?? null,
      autoTeamGenerationMinutesBeforeStart:
        g.autoTeamGenerationMinutesBeforeStart ?? null,
      autoTeamsGeneratedAt: g.autoTeamsGeneratedAt ?? null,
      autoTeamsGeneratedBy: g.autoTeamsGeneratedBy ?? null,
      teamsEditedManually: g.teamsEditedManually ?? false,
      teamBalanceMeta: g.teamBalanceMeta ?? null,
      guests: Array.isArray(g.guests)
        ? (g.guests as import('@/types').GameGuest[]).map((x) => ({
            id: x.id,
            name: x.name,
            estimatedRating:
              typeof x.estimatedRating === 'number' ? x.estimatedRating : null,
            addedBy: x.addedBy,
            createdAt: x.createdAt,
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
      fmt === '5v5' || fmt === '6v6' || fmt === '7v7' ? fmt : undefined;
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
      ballHolderUserId: d.ballHolderUserId ?? undefined,
      jerseysHolderUserId: d.jerseysHolderUserId ?? undefined,
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
      extraTimeMinutes:
        typeof d.extraTimeMinutes === 'number' && d.extraTimeMinutes > 0
          ? d.extraTimeMinutes
          : undefined,
      liveMatch: readLiveMatch(d.liveMatch),
      reminderSent: d.reminderSent === true,
      rateReminderSent: d.rateReminderSent === true,
      capacityNoticeSent: d.capacityNoticeSent === true,
      arrivals: readArrivals(d.arrivals),
      cancellations: readCancellations(d.cancellations),
      autoTeamGenerationMinutesBeforeStart:
        typeof d.autoTeamGenerationMinutesBeforeStart === 'number' &&
        d.autoTeamGenerationMinutesBeforeStart > 0
          ? d.autoTeamGenerationMinutesBeforeStart
          : undefined,
      autoTeamsGeneratedAt:
        typeof d.autoTeamsGeneratedAt === 'number'
          ? d.autoTeamsGeneratedAt
          : undefined,
      autoTeamsGeneratedBy:
        d.autoTeamsGeneratedBy === 'system' ? 'system' : undefined,
      teamsEditedManually: d.teamsEditedManually === true,
      teamBalanceMeta: readTeamBalanceMeta(d.teamBalanceMeta),
      guests: readGuests(d.guests),
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
  /** Phase E: outbound queue of FCM dispatches (consumed by Cloud Function). */
  notifications() {
    return collection(getFirebase().db, 'notifications');
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
};

export { serverTimestamp };
