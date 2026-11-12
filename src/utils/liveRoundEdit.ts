import { teamSizeFromFormat, toGuestRosterId, TEAM_COUNT_MAX, TEAM_COUNT_MIN, type DraftTeam, type Game, type LiveMatchState, type LiveRoundEditRecord, type LiveRoundEditPlan } from '@/types';
import { balanceTeams, buildPickOrder, type PastSplit } from './draft';
import { activeDraftRosterIds } from './draftIntegrity';
import { TEAM_PALETTE } from './teamIdentity';
import { assertLiveTeamsEdit, liveTeamsEditContext, resetLiveForTeamChange, validateLiveTeamsFill, type LiveTeamsEditContext, type LiveTeamsFilled } from './liveTeamsEdit';
import { rosterOf, type RotationFillState } from '@/services/rotationEngine';

export type { LiveRoundEditPlan } from '@/types';
export type LiveRoundSplit = LiveRoundEditPlan['method'];
export type LiveRoundEditContext = LiveTeamsEditContext & { settings: string };
export type LiveRoundEditRequest = { plan: LiveRoundEditPlan; expected: LiveRoundEditContext; operationId: string; resetConfirmed: boolean };

function planKey(plan: LiveRoundEditPlan): string {
  return JSON.stringify(plan, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, value[key]])) : value);
}

export function liveRoundEditContext(game: Game): LiveRoundEditContext | null {
  const context = liveTeamsEditContext(game);
  return context && { ...context, settings: JSON.stringify([game.numberOfTeams, game.matchDurationMinutes,
    game.ruleTags ?? [], game.advancedMode, game.advancedFillMode, (game.liveRoundEdits ?? []).map(edit => edit.id)]) };
}

export function hasCurrentMatchData(live?: LiveMatchState): boolean {
  return !!live && (!!live.timerRunning || (live.timerAccumulatedMs ?? 0) > 0 || !!live.timerLastStartedAt ||
    !!live.timerEvents?.length || live.scoreA !== 0 || live.scoreB !== 0 || !!live.goals?.length ||
    !!live.inPlayPenalties?.length || !!live.shootout);
}

export function registeredLiveRoster(game: Game): string[] {
  return [...new Set([...(game.players ?? []), ...(game.guests ?? []).filter(g => !g.waitlisted).map(g => toGuestRosterId(g.id))])];
}

/** Retired indices are never reassigned to another team. Wins retain their original identity. */
export function liveRoundTeamSlots(game: Game, count: number): DraftTeam[] {
  const current = [...(game.draftTeams?.teams ?? [])].sort((a, b) => a.index - b.index);
  const used = [...current, ...(game.liveRoundEdits ?? []).flatMap(edit => [...edit.before.teams, ...edit.after.teams])];
  const usedColors = new Set(used.map(t => t.colorKey ?? TEAM_PALETTE[t.index]?.key).filter(Boolean));
  let next = Math.max(-1, ...used.map(t => t.index), ...Object.keys(game.rotation?.wins ?? {}).map(Number)) + 1;
  return Array.from({ length: count }, (_, i) => {
    if (current[i]) return { ...current[i], playerIds: [...current[i].playerIds] };
    const colorKey = TEAM_PALETTE.find(color => !usedColors.has(color.key))?.key;
    if (colorKey) usedColors.add(colorKey);
    return { index: next++, captainId: '', playerIds: [], ...(colorKey ? { colorKey } : {}) };
  });
}

export function initialLiveRoundPlan(game: Game): LiveRoundEditPlan {
  const activeIds = activeDraftRosterIds(game);
  return { activeIds, format: game.format ?? '5v5', numberOfTeams: game.draftTeams!.teams.length,
    matchDurationMinutes: game.matchDurationMinutes ?? 0, ruleTags: [...(game.ruleTags ?? [])], method: 'keep',
    teams: game.draftTeams!.teams.map(t => ({ ...t, playerIds: [...t.playerIds] })),
    playing: [...game.rotation!.playing], waiting: [...game.rotation!.waiting] };
}

/** Existing rating algorithm, without its opt-in change of completion policy. */
export function generateLiveRoundTeams(game: Game, plan: LiveRoundEditPlan, ratings: Record<string, number>, history: PastSplit[] = [], rng?: () => number): DraftTeam[] {
  const slots = liveRoundTeamSlots(game, plan.numberOfTeams);
  const result = balanceTeams({ playerIds: plan.activeIds, ratings: plan.method === 'rating' ? ratings : {},
    numTeams: plan.numberOfTeams, format: plan.format, createdBy: game.createdBy ?? '',
    history: plan.method === 'rating' ? history : [], rng }).result;
  return result.teams.map((team, i) => ({ ...slots[i], captainId: team.captainId, playerIds: team.playerIds }));
}

export function liveCaptainTurn(teams: DraftTeam[], total: number, method: 'regular' | 'snake'): number | null {
  const picked = teams.reduce((n, t) => n + Math.max(0, t.playerIds.length - 1), 0);
  return buildPickOrder(teams.length, total - teams.length, method)[picked] ?? null;
}

function assertContext(game: Game, expected: LiveRoundEditContext): void {
  const { settings, ...teamsContext } = expected;
  assertLiveTeamsEdit(game, teamsContext);
  if (liveRoundEditContext(game)?.settings !== settings) throw new Error('הגדרות המחזור השתנו. יש לפתוח את העריכה מחדש.');
}

export function prepareLiveRoundEdit(game: Game, request: LiveRoundEditRequest): { draft: NonNullable<Game['draftTeams']>; skeleton: RotationFillState } {
  assertContext(game, request.expected);
  const plan = request.plan, registered = new Set(registeredLiveRoster(game));
  const count = plan.numberOfTeams, pitch = teamSizeFromFormat(plan.format);
  if (!Number.isInteger(count) || count < TEAM_COUNT_MIN || count > TEAM_COUNT_MAX ||
    !['keep','rating','random','regular','snake','manual'].includes(plan.method) ||
    !/^(3v3|4v4|5v5|6v6|7v7|8v8|9v9|10v10|11v11)$/.test(plan.format) ||
    !Number.isInteger(plan.matchDurationMinutes) || plan.matchDurationMinutes < 0 || plan.matchDurationMinutes > 180 ||
    plan.ruleTags.length > 12 || plan.ruleTags.some(tag => !tag.trim() || tag.length > 30)) throw new Error('יש לבדוק את המתכונת, משך המשחק והכללים.');
  if (new Set(plan.activeIds).size !== plan.activeIds.length || plan.activeIds.some(id => !registered.has(id)) || plan.activeIds.length < 2 * pitch || plan.activeIds.length < count) {
    throw new Error(`נדרשים לפחות ${Math.max(2 * pitch, count)} משתתפים רשומים להמשך במתכונת הזו.`);
  }
  const slots = liveRoundTeamSlots(game, count), active = new Set(plan.activeIds), assigned = plan.teams.flatMap(t => t.playerIds);
  const sizes = plan.teams.map(t => t.playerIds.length);
  if (sizes.some(size => size > pitch)) throw new Error('קבוצת בסיס גדולה מהמתכונת במגרש. יש להגדיל את מספר הקבוצות או לשנות את המתכונת.');
  if (plan.teams.length !== count || plan.teams.some((t, i) => t.index !== slots[i].index || t.colorKey !== slots[i].colorKey || !t.playerIds.includes(t.captainId)) ||
    new Set(assigned).size !== assigned.length || assigned.length !== active.size || assigned.some(id => !active.has(id)) ||
    sizes.some(size => size === 0) || (plan.method !== 'keep' && Math.max(...sizes) - Math.min(...sizes) > 1)) {
    throw new Error('יש לשבץ כל משתתף פעם אחת בקבוצות מלאות ומאוזנות בגודלן.');
  }
  const sequence = [...plan.playing, ...plan.waiting], indices = slots.map(t => t.index);
  if (plan.playing.length !== 2 || sequence.length !== count || new Set(sequence).size !== count || sequence.some(i => !indices.includes(i))) throw new Error('יש לבחור שתי קבוצות למשחק ולסדר את כל הממתינות.');
  if (hasCurrentMatchData(game.liveMatch) && !request.resetConfirmed) throw new Error('נדרש אישור לאיפוס הזמן וכל נתוני המשחק הנוכחי בלבד.');
  const previous = game.draftTeams!, now = Date.now();
  if (plan.method === 'keep' && (JSON.stringify(plan.teams) !== JSON.stringify(previous.teams) ||
    activeDraftRosterIds(game).length !== active.size || activeDraftRosterIds(game).some(id => !active.has(id)))) throw new Error('הסגל השתנה. יש לבחור שיטת חלוקה מחדש.');
  const leftHome = registeredLiveRoster(game).filter(id => !active.has(id)).map(playerId => previous.leftHome?.find(l => l.playerId === playerId) ?? {
    playerId, homeTeam: previous.teams.find(t => t.playerIds.includes(playerId))?.index ?? game.rotation!.playing[0], at: now,
  });
  const teams = plan.teams.map(t => ({ ...t, playerIds: [...t.playerIds] }));
  const draft = { ...previous, method: plan.method === 'regular' ? 'regular' as const : plan.method === 'snake' ? 'snake' as const : previous.method,
    numTeams: count, teams, originalTeams: plan.method === 'keep' ? previous.originalTeams : teams.map(t => ({ ...t, playerIds: [...t.playerIds] })), leftHome };
  const rotation: NonNullable<Game['rotation']> = { ...game.rotation!, playing: [...plan.playing] as [number, number], waiting: [...plan.waiting], loans: [],
    baseTeams: plan.method === 'keep' ? game.rotation!.baseTeams : teams.map(t => ({ index: t.index, playerIds: [...t.playerIds] })) };
  // A settings-only change keeps the actual current roster, including valid loans.
  const preserveLoans = plan.method === 'keep' && JSON.stringify(plan.teams) === JSON.stringify(previous.teams) &&
    JSON.stringify(plan.playing) === JSON.stringify(game.rotation!.playing) && plan.format === game.format &&
    activeDraftRosterIds(game).every(id => active.has(id));
  if (preserveLoans) rotation.loans = game.rotation!.loans;
  return { draft, skeleton: { teams, playing: rotation.playing, rotation, perTeam: pitch, loserFirst: null,
    fillMode: previous.completionMode === 'balanced' ? 'temporary' : (game.advancedMode ? game.advancedFillMode : undefined) ?? previous.fillMode ?? 'temporary' } };
}

/** Only these fields are written. No result, statistics, registration or season mutation. */
export function liveRoundEditPatch(game: Game, request: LiveRoundEditRequest, actor: { userId: string; userName: string }, now: number, filled?: LiveTeamsFilled): Partial<Game> {
  if (!request.operationId || request.operationId.length > 120 || request.operationId === request.expected.roundId) throw new Error('מזהה השמירה חסר. יש לפתוח מחדש את העריכה.');
  const receipt = game.liveRoundEdits?.find(edit => edit.id === request.operationId);
  if (receipt) {
    if (receipt.fromRoundId !== request.expected.roundId || receipt.by !== actor.userId || planKey(receipt.plan) !== planKey(request.plan)) throw new Error('מזהה השמירה שייך לעריכה אחרת.');
    return {}; // A lost acknowledgement may be retried even after the next match started.
  }
  const { draft, skeleton } = prepareLiveRoundEdit(game, request);
  const result = validateLiveTeamsFill(skeleton, filled);
  if (skeleton.playing.some(index => rosterOf(index, result.teams, result.loans).length < skeleton.perTeam)) throw new Error('יש להשלים את שתי הקבוצות למתכונת שנבחרה לפני השמירה.');
  const plan = request.plan;
  const snapshot = (g: Game): LiveRoundEditRecord['before'] => ({ format: g.format ?? '5v5', matchDurationMinutes: g.matchDurationMinutes ?? 0,
    ruleTags: [...(g.ruleTags ?? [])], teams: g.draftTeams!.teams.map(t => ({ ...t, playerIds: [...t.playerIds] })),
    activeIds: activeDraftRosterIds(g), playing: [...g.rotation!.playing], waiting: [...g.rotation!.waiting] });
  const after = { ...game, format: plan.format, matchDurationMinutes: plan.matchDurationMinutes, ruleTags: plan.ruleTags, draftTeams: draft, rotation: skeleton.rotation };
  const record: LiveRoundEditRecord = { id: request.operationId, fromRoundId: request.expected.roundId, by: actor.userId, at: now,
    roundNumber: game.rotation!.round ?? 1, before: snapshot(game), after: snapshot(after), plan };
  return { format: plan.format, numberOfTeams: plan.numberOfTeams, matchDurationMinutes: plan.matchDurationMinutes, ruleTags: [...plan.ruleTags],
    draftTeams: { ...draft, teams: draft.teams.map(team => {
      const playerIds = result.teams.find(t => t.index === team.index)!.playerIds;
      return { ...team, playerIds, captainId: playerIds.includes(team.captainId) ? team.captainId : playerIds[0] ?? '' };
    }) },
    rotation: { ...skeleton.rotation, loans: result.loans, roundInstanceId: request.operationId, roundInstanceRound: game.rotation!.round ?? 1, updatedAt: now },
    liveMatch: resetLiveForTeamChange(game.liveMatch, actor.userId, actor.userName, now),
    liveRoundEdits: [...(game.liveRoundEdits ?? []), record], teamsEditedManually: true, updatedAt: now };
}
