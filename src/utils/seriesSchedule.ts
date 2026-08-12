// Weekly-series scheduling — the pure decisions behind "when does the next
// occurrence get created, and for when".
//
// Kept free of Firestore and of timezone libraries so both sides can use it and
// so it's testable: the DST-aware "+1 week" is INJECTED, because that's the one
// piece that differs between the client and the Cloud Function.
//
// ⚠️ MIRRORED in functions/src/index.ts (runCreateSeriesOccurrences). Keep the
//    two in sync — same rule the penaltyStats mirror follows.

import type { GameSeriesSettings } from '@/types';

/** How long after a kickoff the next occurrence may be created. Matches the
 *  legacy clone delay: long enough that a fixture still being played never
 *  double-books. */
export const OCCURRENCE_CREATE_DELAY_MS = 3 * 60 * 60 * 1000;

/** Plain +7d. The Cloud Function passes an Israel-wall-time version so a
 *  fixture doesn't drift an hour across a DST boundary. */
export const addOneWeekUtc = (t: number): number => t + 7 * 24 * 60 * 60 * 1000;

/**
 * Kickoff for the next occurrence of a series.
 *
 * NOT simply `last + 1 week`. A series that lay dormant — the cron was down,
 * the club paused for a season, or the series was created long ago — would
 * then produce an occurrence in the PAST, and because each run advances the
 * anchor by exactly one week the next run would create another past one, and
 * another, spraying dozens of dead matches into the club at five-minute
 * intervals. So we walk forward until the slot is genuinely in the future,
 * which also keeps the fixture on its original weekday and time.
 *
 * Returns null if `last` isn't a usable timestamp.
 */
export function nextOccurrenceAt(
  lastOccurrenceAt: number,
  now: number,
  addOneWeek: (t: number) => number = addOneWeekUtc,
): number | null {
  if (!Number.isFinite(lastOccurrenceAt) || lastOccurrenceAt <= 0) return null;
  let next = addOneWeek(lastOccurrenceAt);
  // Bounded: 520 weeks ≈ 10 years. A series older than that is broken data, and
  // an unbounded loop in a cron is how you burn a function's whole timeout.
  for (let i = 0; i < 520 && next <= now; i++) {
    next = addOneWeek(next);
  }
  return next > now ? next : null;
}

/**
 * Should this series produce its next occurrence right now?
 *
 * Only once the PREVIOUS one is well past — otherwise a fixture would have
 * next week's match sitting in the feed while this week's is still being
 * played, which is what the 3-hour delay has always prevented.
 */
export function isOccurrenceDue(lastOccurrenceAt: number, now: number): boolean {
  if (!Number.isFinite(lastOccurrenceAt) || lastOccurrenceAt <= 0) return false;
  return now >= lastOccurrenceAt + OCCURRENCE_CREATE_DELAY_MS;
}

/**
 * Absolute schedule timestamps for one occurrence, derived from the template's
 * offsets. Offsets (not absolute times) are what keep every week identical:
 * "registration opens 24h before" stays 24h before, forever.
 */
export function occurrenceSchedule(
  settings: Pick<
    GameSeriesSettings,
    'registrationOpensBeforeMs' | 'publicOpenBeforeMs' | 'guestsOpenBeforeMs'
  >,
  startsAt: number,
): {
  registrationOpensAt?: number;
  publicOpenAt?: number;
  guestsOpenAt?: number;
} {
  const at = (before?: number): number | undefined =>
    typeof before === 'number' && before > 0 ? startsAt - before : undefined;
  const out: {
    registrationOpensAt?: number;
    publicOpenAt?: number;
    guestsOpenAt?: number;
  } = {};
  const reg = at(settings.registrationOpensBeforeMs);
  const pub = at(settings.publicOpenBeforeMs);
  const gue = at(settings.guestsOpenBeforeMs);
  if (reg !== undefined) out.registrationOpensAt = reg;
  if (pub !== undefined) out.publicOpenAt = pub;
  if (gue !== undefined) out.guestsOpenAt = gue;
  return out;
}

/**
 * The match document for one occurrence, built from the template alone.
 *
 * The old engine copied the previous match and then deleted ~30 fields off it
 * (roster, latches, live state, last week's invitees…) — a list that grew one
 * production bug at a time. Composing from the template instead means there is
 * nothing to strip: whatever isn't in the template simply isn't there.
 *
 * ⚠️ MIRRORED in functions/src/index.ts (runCreateSeriesOccurrences).
 */
export function buildOccurrence(
  settings: GameSeriesSettings,
  startsAt: number,
  now: number,
  ids: { groupId: string; seriesId: string; createdBy: string },
): Record<string, unknown> {
  const sched = occurrenceSchedule(settings, startsAt);
  // Deferred registration → the match starts 'scheduled' and a CF opens it at
  // the picked time, exactly as the wizard does for a first occurrence.
  const status =
    sched.registrationOpensAt !== undefined && sched.registrationOpensAt > now
      ? 'scheduled'
      : 'open';
  const game: Record<string, unknown> = {
    groupId: ids.groupId,
    seriesId: ids.seriesId,
    createdBy: ids.createdBy,
    title: settings.title,
    startsAt,
    fieldName: settings.fieldName,
    maxPlayers: settings.maxPlayers,
    visibility: settings.visibility,
    requiresApproval: settings.requiresApproval === true,
    bringBall: settings.bringBall === true,
    bringShirts: settings.bringShirts === true,
    status,
    // A fresh week starts empty. Explicit, not inherited.
    players: [],
    waitlist: [],
    pending: [],
    participantIds: [],
    guests: [],
    matches: [],
    arrivals: {},
    cancellations: {},
    joinedAt: {},
    ballBringerIds: [],
    locked: false,
    currentMatchIndex: 0,
    createdAt: now,
    updatedAt: now,
  };
  const opt = (key: string, v: unknown) => {
    if (v !== undefined && v !== null) game[key] = v;
  };
  opt('minPlayers', settings.minPlayers);
  opt('format', settings.format);
  opt('numberOfTeams', settings.numberOfTeams);
  opt('cancelDeadlineHours', settings.cancelDeadlineHours);
  opt('fieldType', settings.fieldType);
  opt('matchDurationMinutes', settings.matchDurationMinutes);
  opt('notes', settings.notes);
  opt('city', settings.city);
  opt('fieldAddress', settings.fieldAddress);
  opt('fieldLat', settings.fieldLat);
  opt('fieldLng', settings.fieldLng);
  opt('ruleTags', settings.ruleTags);
  opt('acceptsFillers', settings.acceptsFillers);
  opt('fillerMinTrust', settings.fillerMinTrust);
  opt('advancedMode', settings.advancedMode);
  opt('advancedFillMode', settings.advancedFillMode);
  opt('advancedTieMode', settings.advancedTieMode);
  opt('registrationOpensAt', sched.registrationOpensAt);
  opt('publicOpenAt', sched.publicOpenAt);
  opt('guestsOpenAt', sched.guestsOpenAt);
  return game;
}

/** Build the repeatable template out of a game's settings. Instance-only state
 *  (roster, status, latches) is deliberately absent — an occurrence is
 *  disposable, only these settings persist. */
export function settingsFromGame(g: {
  title: string;
  fieldName?: string;
  city?: string;
  fieldAddress?: string;
  fieldLat?: number;
  fieldLng?: number;
  fieldType?: GameSeriesSettings['fieldType'];
  format?: GameSeriesSettings['format'];
  numberOfTeams?: number;
  maxPlayers: number;
  minPlayers?: number;
  matchDurationMinutes?: number;
  cancelDeadlineHours?: number;
  visibility: 'public' | 'community';
  requiresApproval?: boolean;
  bringBall?: boolean;
  bringShirts?: boolean;
  notes?: string;
  ruleTags?: string[];
  acceptsFillers?: boolean;
  fillerMinTrust?: number;
  advancedMode?: boolean;
  advancedFillMode?: 'permanent' | 'temporary';
  advancedTieMode?: 'bothOut' | 'veteranOut';
  startsAt: number;
  registrationOpensAt?: number;
  publicOpenAt?: number;
  guestsOpenAt?: number;
}): GameSeriesSettings {
  // Schedule fields become offsets BEFORE kickoff. Storing the absolute time
  // would pin every future week to the FIRST week's clock.
  const before = (v?: number): number | undefined =>
    typeof v === 'number' && v > 0 && v < g.startsAt ? g.startsAt - v : undefined;
  const s: GameSeriesSettings = {
    title: g.title,
    fieldName: g.fieldName ?? '',
    maxPlayers: g.maxPlayers,
    visibility: g.visibility,
    requiresApproval: g.requiresApproval === true,
    bringBall: g.bringBall === true,
    bringShirts: g.bringShirts === true,
  };
  const opt = <K extends keyof GameSeriesSettings>(
    key: K,
    val: GameSeriesSettings[K] | undefined,
  ) => {
    if (val !== undefined) s[key] = val;
  };
  opt('city', g.city);
  opt('fieldAddress', g.fieldAddress);
  opt('fieldLat', g.fieldLat);
  opt('fieldLng', g.fieldLng);
  opt('fieldType', g.fieldType);
  opt('format', g.format);
  opt('numberOfTeams', g.numberOfTeams);
  opt('minPlayers', g.minPlayers);
  opt('matchDurationMinutes', g.matchDurationMinutes);
  opt('cancelDeadlineHours', g.cancelDeadlineHours);
  opt('notes', g.notes);
  opt('ruleTags', g.ruleTags);
  opt('acceptsFillers', g.acceptsFillers);
  opt('fillerMinTrust', g.fillerMinTrust);
  opt('advancedMode', g.advancedMode);
  opt('advancedFillMode', g.advancedFillMode);
  opt('advancedTieMode', g.advancedTieMode);
  opt('registrationOpensBeforeMs', before(g.registrationOpensAt));
  opt('publicOpenBeforeMs', before(g.publicOpenAt));
  opt('guestsOpenBeforeMs', before(g.guestsOpenAt));
  return s;
}
