import type { Game, LiveMatchState, MatchRotation } from '@/types';
import { applyChosenFill, rosterOf, roundCommitKey, type RotationFillState, type RotationTeam } from '@/services/rotationEngine';
import { rotationWriteSource } from '@/services/rotationWriteSource';
import { activeDraftRosterIds } from './draftIntegrity';
import { retainRotationLoans } from './rotationLoans';
import { tallyWithout } from './goalTally';

export type LiveTeamsPlan = { playing: [number, number]; waiting: number[] };
export type LiveTeamsEditContext = { gameId: string; roundId: string; source: string; board: string };
export type LiveTeamsFilled = { teams: RotationTeam[]; loans: MatchRotation['loans'] };

export function liveTeamsEditContext(game: Game): LiveTeamsEditContext | null {
  if (!game.rotation) return null;
  return { gameId: game.id, roundId: roundCommitKey(game.rotation), source: rotationWriteSource(game),
    board: JSON.stringify([game.liveMatch ?? null, game.lastCommittedRoundId ?? null, game.format]) };
}

export function assertLiveTeamsEdit(game: Game, expected: LiveTeamsEditContext): void {
  const current = liveTeamsEditContext(game);
  if (!current || !game.draftTeams || !['open', 'active', 'locked'].includes(game.status) ||
      game.lastCommittedRoundId === current.roundId || Object.keys(current).some(key => current[key as keyof LiveTeamsEditContext] !== expected[key as keyof LiveTeamsEditContext])) {
    throw Object.assign(new Error('המשחק, התוצאה או ההרכבים השתנו. יש לפתוח מחדש את עריכת הקבוצות והתור.'), { code: 'LIVE_TEAMS_CHANGED' });
  }
}

export function replaceLiveTeam(plan: LiveTeamsPlan, slot: 0 | 1, incoming: number): LiveTeamsPlan {
  if (!plan.waiting.includes(incoming)) return plan;
  const playing: [number, number] = [...plan.playing];
  playing[slot] = incoming;
  return { playing, waiting: [...plan.waiting.filter(i => i !== incoming), plan.playing[slot]] };
}

export function moveLiveWaiting(plan: LiveTeamsPlan, team: number, delta: -1 | 1): LiveTeamsPlan {
  const index = plan.waiting.indexOf(team), target = index + delta;
  if (index < 0 || target < 0 || target >= plan.waiting.length) return plan;
  const waiting = [...plan.waiting];
  [waiting[index], waiting[target]] = [waiting[target], waiting[index]];
  return { ...plan, waiting };
}

export function liveTeamsChanged(original: LiveTeamsPlan, plan: LiveTeamsPlan): boolean {
  return original.playing.some((team, slot) => team !== plan.playing[slot]);
}

/** The selectable set is the active rotation, never retired teams. No result is recorded. */
export function liveTeamsEditSkeleton(game: Game, plan: LiveTeamsPlan, perTeam: number, fillMode: RotationFillState['fillMode']): RotationFillState {
  const rotation = game.rotation!, draft = game.draftTeams!;
  const before = [...rotation.playing, ...rotation.waiting], after = [...plan.playing, ...plan.waiting];
  if (plan.playing.length !== 2 || before.length !== after.length || new Set(after).size !== after.length ||
      after.some(i => !Number.isInteger(i) || !before.includes(i) || !draft.teams.some(t => t.index === i))) {
    throw new Error('יש לבחור שתי קבוצות שונות ולכלול את כל הממתינות פעם אחת.');
  }
  const active = new Set(activeDraftRosterIds(game));
  const teams = draft.teams.map(t => ({ index: t.index, playerIds: t.playerIds.filter(id => active.has(id)) }));
  const changed = liveTeamsChanged(rotation, plan);
  const loans = changed ? (draft.completionMode === 'balanced' ? [] : retainRotationLoans(rotation.loans, loan =>
    plan.playing.includes(loan.filledTeam) && !plan.playing.includes(loan.homeTeam) && active.has(loan.playerId))) : rotation.loans;
  if (changed && plan.playing.some(i => rosterOf(i, teams, loans).length === 0)) throw new Error('אי אפשר להעלות קבוצה ללא שחקנים.');
  return { playing: [...plan.playing], teams, perTeam, fillMode, loserFirst: null,
    rotation: { ...rotation, playing: [...plan.playing], waiting: [...plan.waiting], loans } };
}

/** Replay only legal fills against the transaction's original lineup. Never trust a supplied rotation. */
export function validateLiveTeamsFill(skeleton: RotationFillState, filled?: LiveTeamsFilled): LiveTeamsFilled {
  if (!filled) return { teams: skeleton.teams, loans: skeleton.rotation.loans };
  let working = { teams: skeleton.teams, loans: skeleton.rotation.loans };
  for (const team of skeleton.playing) {
    const before = rosterOf(team, skeleton.teams, skeleton.rotation.loans);
    const picks = rosterOf(team, filled.teams, filled.loans).filter(id => !before.includes(id));
    const donors = new Set(working.teams.filter(t => !skeleton.playing.includes(t.index)).flatMap(t => rosterOf(t.index, working.teams, working.loans)));
    if (new Set(picks).size !== picks.length || picks.length > Math.max(0, skeleton.perTeam - before.length) || picks.some(id => !donors.has(id))) throw new Error('בחירת המשלימים אינה תקפה. יש לבחור מחדש.');
    working = applyChosenFill(working.teams, working.loans, team, picks, skeleton.fillMode);
  }
  const canonical = (value: LiveTeamsFilled) => JSON.stringify([
    [...value.teams].sort((a,b) => a.index-b.index).map(t => [t.index, [...t.playerIds].sort()]),
    [...value.loans].map(l => JSON.stringify(l)).sort(),
  ]);
  if (canonical(working) !== canonical(filled)) throw new Error('הרכב ההשלמות השתנה. יש לבחור מחדש.');
  return working;
}

/** Evening-level physical activity and first-start evidence survive discarding a mini-game. */
export function resetLiveForTeamChange(live: LiveMatchState | undefined, userId: string, userName: string, now: number): LiveMatchState {
  return { ...live, phase: 'roundReady', assignments: {}, benchOrder: [], teamASlots: {}, teamBSlots: {},
    scoreA: 0, scoreB: 0, goals: [], inPlayPenalties: [], shootout: undefined,
    goalTally: tallyWithout(live?.goalTally, live?.goals), timerRunning: false, timerLastStartedAt: null,
    timerAccumulatedMs: 0, timerEvents: [], timerControlledBy: userId, timerControlledByName: userName,
    activeIntervals: [...(live?.activeIntervals ?? []), ...(live?.timerRunning && live.timerLastStartedAt ? [{ s: live.timerLastStartedAt, e: now }] : [])], updatedAt: now };
}
