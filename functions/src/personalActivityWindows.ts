// Mirrored from src/utils/personalActivityWindows.ts; guarded by personalActivityWindowsMirror.test.ts.
function rosterOf(teamIndex: number, teams: Array<{ index: number; playerIds: string[] }>, loans: Array<{ playerId: string; homeTeam: number; filledTeam: number }>): string[] {
  const home = teams.find(team => team.index === teamIndex)?.playerIds ?? [];
  const loanedOut = new Set(loans.filter(loan => loan.homeTeam === teamIndex).map(loan => loan.playerId));
  return [...home.filter(id => !loanedOut.has(id)), ...loans.filter(loan => loan.filledTeam === teamIndex).map(loan => loan.playerId)];
}

/** Epoch milliseconds on the shared server clock. Ranges are [from,to). */
export interface PersonalActivityWindow { from: number; to: number }
export interface PersonalActivityTimeline {
  version: 1;
  /** Earliest instant for which the lineup is known. Never backfill from a final roster. */
  startedAt: number;
  entries: Array<{ at: number; playerIds: string[] }>;
}

export interface PersonalActivityGame {
  status?: string;
  personalActivityTimeline?: PersonalActivityTimeline;
  draftTeams?: { teams: Array<{ index: number; playerIds: string[] }>; leftHome?: Array<{ playerId: string }> };
  rotation?: { playing: [number, number]; loans?: Array<{ playerId: string; homeTeam: number; filledTeam: number }> };
  liveMatch?: {
    phase?: string;
    assignments?: Record<string, string>;
    activeIntervals?: Array<{ s: number; e: number }>;
    timerRunning?: boolean;
    timerLastStartedAt?: number | null;
  };
}

const epoch = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Current membership only. This function must never be used as historical evidence. */
export function personalActivityPlayerIds(game: PersonalActivityGame): string[] {
  if (game.status === 'cancelled' || game.status === 'finished' || game.liveMatch?.phase === 'finished') return [];
  const left = new Set(game.draftTeams?.leftHome?.map(row => row.playerId) ?? []);
  let ids: string[];
  if (game.rotation && game.draftTeams) {
    const [a, b] = game.rotation.playing;
    if (a === b || !game.draftTeams.teams.some(team => team.index === a) || !game.draftTeams.teams.some(team => team.index === b)) return [];
    ids = [a, b].flatMap(index => rosterOf(index, game.draftTeams!.teams, game.rotation!.loans ?? []));
  } else {
    ids = Object.entries(game.liveMatch?.assignments ?? {})
      .filter(([, zone]) => ['teamA', 'teamB', 'gkA', 'gkB'].includes(zone)).map(([id]) => id);
  }
  return [...new Set(ids.filter(id => typeof id === 'string' && id.length > 0 && !left.has(id)))].sort();
}

/** A measurement gate, not a claim that sensors are connected or reporting data. */
export function personalActivityEligibility(game: PersonalActivityGame, playerId: string, at: number): {
  eligible: boolean; onField: boolean; timerRunning: boolean;
} {
  const onField = !!playerId && personalActivityPlayerIds(game).includes(playerId);
  const start = game.liveMatch?.timerLastStartedAt;
  const timerRunning = game.liveMatch?.timerRunning === true && epoch(start) && epoch(at) && start <= at &&
    game.status !== 'finished' && game.status !== 'cancelled' && game.liveMatch?.phase !== 'finished';
  return { eligible: onField && timerRunning, onField, timerRunning };
}

export function mergePersonalActivityWindows(windows: PersonalActivityWindow[]): PersonalActivityWindow[] {
  const sorted = windows.filter(row => epoch(row.from) && epoch(row.to) && row.to > row.from)
    .map(row => ({ ...row })).sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: PersonalActivityWindow[] = [];
  for (const row of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && row.from <= previous.to) previous.to = Math.max(previous.to, row.to);
    else merged.push(row);
  }
  return merged;
}

/** Build the exact intersection of running-clock time and proven on-field membership.
 * Missing history is explicitly unavailable. A known empty result means zero eligible time.
 * Future and malformed history is rejected rather than inferred from today's lineup. */
export function personalActivityWindows(game: PersonalActivityGame, playerId: string, until: number): {
  status: 'available' | 'unavailable'; windows: PersonalActivityWindow[]; eligibleMs: number;
  knownFrom?: number; timerMs: number; reason?: 'missing-history' | 'invalid-history' | 'invalid-boundary';
} {
  const unavailable = (reason: 'missing-history' | 'invalid-history' | 'invalid-boundary') =>
    ({ status: 'unavailable' as const, windows: [], eligibleMs: 0, timerMs: 0, reason });
  if (!playerId || !epoch(until)) return unavailable('invalid-boundary');
  const history = game.personalActivityTimeline;
  if (!history) return unavailable('missing-history');
  if (history.version !== 1 || !epoch(history.startedAt) || !Array.isArray(history.entries) || !history.entries.length) return unavailable('invalid-history');
  const entries = history.entries;
  if (entries[0].at !== history.startedAt || entries.some((entry, index) => !epoch(entry.at) ||
    (index > 0 && entry.at <= entries[index - 1].at) || !Array.isArray(entry.playerIds) ||
    entry.playerIds.some(id => typeof id !== 'string' || !id))) return unavailable('invalid-history');
  const live = game.liveMatch;
  const clock = (Array.isArray(live?.activeIntervals) ? live.activeIntervals : [])
    .filter(row => row && epoch(row.s) && epoch(row.e) && row.e > row.s);
  if (live?.timerRunning && epoch(live.timerLastStartedAt) && game.status !== 'finished' && game.status !== 'cancelled' && live.phase !== 'finished') {
    clock.push({ s: live.timerLastStartedAt, e: until });
  }
  const running = mergePersonalActivityWindows(clock.map(row => ({ from: Math.max(history.startedAt, row.s), to: Math.min(until, row.e) })));
  const membership = entries.flatMap((entry, index) => entry.playerIds.includes(playerId)
    ? [{ from: entry.at, to: Math.min(entries[index + 1]?.at ?? until, until) }] : []);
  const windows = mergePersonalActivityWindows(membership.flatMap(member => running.map(run =>
    ({ from: Math.max(member.from, run.from), to: Math.min(member.to, run.to) }))));
  return { status: 'available', windows, eligibleMs: windows.reduce((sum, row) => sum + row.to - row.from, 0),
    knownFrom: history.startedAt, timerMs: running.reduce((sum, row) => sum + row.to - row.from, 0) };
}
