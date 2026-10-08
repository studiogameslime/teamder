// gamesService — UPCOMING / currently-active Teamder games with their
// registration counts AND a managerial "was it active?" read-out (timer
// started? mini-games played? live right now?). Read-only via Firestore REST.
// Past games (finished/cancelled, or kicked off long ago) are excluded.

import { listAll, type FsDoc } from './firestoreRest';

export type GameVisibility = 'public' | 'community' | 'private';

// A game is "past" once it kicked off this long ago (and wasn't already
// excluded by a finished/cancelled status). Covers a still-'open' game whose
// admin never closed the evening.
const PAST_GRACE_MS = 8 * 60 * 60 * 1000; // 8h

export interface TeamInfo {
  index: number;
  colorKey: string | null;
  count: number;
}

/** Everything the admin filled in at creation — surfaced in the expanded card. */
export interface GameDetail {
  // teams — how the split was formed
  teamsMethod: string | null; // draftTeams.method (snake/manual/random/rating)
  autoGenBy: string | null; // 'system' (scheduled) | admin uid | null (manual)
  teamsEdited: boolean; // teamsEditedManually
  numberOfTeams: number | null;
  teams: TeamInfo[];
  // match settings
  format: string | null;
  durationMin: number | null;
  extraMin: number | null;
  halfTime: boolean;
  penalties: boolean;
  referee: boolean;
  fillMode: string | null;
  tieMode: string | null;
  // registration / access
  maxPlayers: number | null;
  minPlayers: number | null;
  requiresApproval: boolean;
  fillerMinTrust: number | null;
  registrationOpensAt: number | null;
  publicOpenAt: number | null;
  guestsOpenAt: number | null;
  autoTeamsAt: number | null;
  cancelDeadlineHours: number | null;
  // field
  fieldName: string | null;
  fieldAddress: string | null;
  city: string | null;
  fieldType: string | null;
  // logistics
  bringBall: boolean;
  bringShirts: boolean;
  ballHolderUserId: string | null;
  jerseysHolderUserId: string | null;
  ruleTags: string[];
  notes: string | null;
  // roster extras
  arrivals: number;
  cancellations: number;
  // meta
  createdBy: string | null;
  createdAt: number | null;
}

export interface GameRow {
  id: string;
  title: string;
  startsAt: number;
  groupId: string | null;
  communityName: string | null;
  status: string;
  visibility: GameVisibility;
  locked: boolean;
  acceptsFillers: boolean;
  advancedMode: boolean;
  // registration
  registered: number;
  capacity: number;
  waitlist: number;
  pending: number;
  guests: number;
  // managerial activity
  teamsDivided: boolean;
  timerStarted: boolean;
  runningNow: boolean;
  roundsPlayed: number; // completed mini-games (משחקונים)
  scoreA: number;
  scoreB: number;
  phase: string | null;
  /** Coarse activity state for the badge. */
  activity: 'live' | 'played' | 'teams' | 'idle';
  /** Full creation data, shown in the expanded card. */
  detail: GameDetail;
}

const len = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
const obj = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const n = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const b = (v: unknown): boolean => v === true;
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

function buildDetail(d: FsDoc, draft: Record<string, any>): GameDetail {
  const teams: TeamInfo[] = Array.isArray(draft.teams)
    ? draft.teams.map((t: any, i: number) => ({
        index: typeof t?.index === 'number' ? t.index : i,
        colorKey: str(t?.colorKey),
        count: Array.isArray(t?.playerIds) ? t.playerIds.length : 0,
      }))
    : [];
  return {
    teamsMethod: str(draft.method),
    autoGenBy: str(d.autoTeamsGeneratedBy),
    teamsEdited: b(d.teamsEditedManually),
    numberOfTeams: n(d.numberOfTeams),
    teams,
    format: str(d.format),
    durationMin: n(d.matchDurationMinutes),
    extraMin: n(d.extraTimeMinutes),
    halfTime: b(d.hasHalfTime),
    penalties: b(d.hasPenalties),
    referee: b(d.hasReferee),
    fillMode: str(d.advancedFillMode),
    tieMode: str(d.advancedTieMode),
    maxPlayers: n(d.maxPlayers),
    minPlayers: n(d.minPlayers),
    requiresApproval: b(d.requiresApproval),
    fillerMinTrust: n(d.fillerMinTrust),
    registrationOpensAt: n(d.registrationOpensAt),
    publicOpenAt: n(d.publicOpenAt),
    guestsOpenAt: n(d.guestsOpenAt),
    autoTeamsAt: n(d.autoTeamsAt),
    cancelDeadlineHours: n(d.cancelDeadlineHours),
    fieldName: str(d.fieldName),
    fieldAddress: str(d.fieldAddress),
    city: str(d.city),
    fieldType: str(d.fieldType),
    bringBall: b(d.bringBall),
    bringShirts: b(d.bringShirts),
    ballHolderUserId: str(d.ballHolderUserId),
    jerseysHolderUserId: str(d.jerseysHolderUserId),
    ruleTags: strArr(d.ruleTags),
    notes: str(d.notes),
    arrivals: len(d.arrivals),
    cancellations: len(d.cancellations),
    createdBy: str(d.createdBy),
    createdAt: n(d.createdAt),
  };
}

function toRow(d: FsDoc): GameRow {
  const lm = obj(d.liveMatch);
  const rot = obj(d.rotation);
  const draft = obj(d.draftTeams);

  const timerStarted =
    !!lm.startedAt ||
    (typeof lm.timerAccumulatedMs === 'number' && lm.timerAccumulatedMs > 0) ||
    lm.timerRunning === true;
  const runningNow = lm.timerRunning === true || lm.phase === 'roundRunning';
  // Completed mini-games: rotation.round counts finalizes; roundNumber is the
  // CURRENT round (1-based), so completed = roundNumber-1. Take the max.
  const roundsPlayed = Math.max(
    typeof rot.round === 'number' ? rot.round : 0,
    typeof lm.roundNumber === 'number' && lm.roundNumber > 0 ? lm.roundNumber - 1 : 0,
  );
  const teamsDivided = Array.isArray(draft.teams) && draft.teams.length > 0;

  const activity: GameRow['activity'] = runningNow
    ? 'live'
    : timerStarted || roundsPlayed > 0
      ? 'played'
      : teamsDivided
        ? 'teams'
        : 'idle';

  return {
    id: d.id,
    title: typeof d.title === 'string' && d.title.length > 0 ? d.title : '(ללא שם)',
    startsAt: typeof d.startsAt === 'number' ? d.startsAt : 0,
    groupId: typeof d.groupId === 'string' ? d.groupId : null,
    communityName: null, // filled in fetchGames from the groups map
    status: typeof d.status === 'string' ? d.status : 'open',
    visibility:
      d.visibility === 'public' || d.visibility === 'private' ? d.visibility : 'community',
    locked: d.locked === true,
    acceptsFillers: d.acceptsFillers === true,
    advancedMode: d.advancedMode === true,
    registered: len(d.players),
    capacity: typeof d.maxPlayers === 'number' ? d.maxPlayers : 0,
    waitlist: len(d.waitlist),
    pending: len(d.pending),
    guests: len(d.guests),
    teamsDivided,
    timerStarted,
    runningNow,
    roundsPlayed,
    scoreA: typeof lm.scoreA === 'number' ? lm.scoreA : 0,
    scoreB: typeof lm.scoreB === 'number' ? lm.scoreB : 0,
    phase: typeof lm.phase === 'string' ? lm.phase : null,
    activity,
    detail: buildDetail(d, draft),
  };
}

export interface GamesReport {
  rows: GameRow[];
  totalGames: number;
  totalRegistered: number;
  liveNow: number;
  lockedRegistered: number;
}

/** UPCOMING / now games only (future kickoff, or started within the last 8h,
 *  excluding finished/cancelled). Soonest first, with a summary. `now` is
 *  passed in so the caller controls the clock (and it's testable). */
export async function fetchGames(now: number = Date.now()): Promise<GamesReport> {
  const [docs, groups] = await Promise.all([
    listAll('games'),
    listAll('groups').catch(() => []),
  ]);
  const groupName = new Map<string, string>();
  for (const g of groups) {
    if (typeof g.name === 'string') groupName.set(g.id, g.name);
  }
  const rows = docs
    .map(toRow)
    .map((r) => ({ ...r, communityName: r.groupId ? groupName.get(r.groupId) ?? null : null }))
    .filter(
      (r) =>
        r.status !== 'finished' &&
        r.status !== 'cancelled' &&
        r.startsAt >= now - PAST_GRACE_MS,
    )
    .sort((a, b) => a.startsAt - b.startsAt); // soonest first

  let totalRegistered = 0;
  let liveNow = 0;
  let lockedRegistered = 0;
  for (const r of rows) {
    totalRegistered += r.registered;
    if (r.runningNow) liveNow += 1;
    if (r.locked || r.visibility !== 'public') lockedRegistered += r.registered;
  }
  return {
    rows,
    totalGames: rows.length,
    totalRegistered,
    liveNow,
    lockedRegistered,
  };
}
