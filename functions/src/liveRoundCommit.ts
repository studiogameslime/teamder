import { inPlayPenaltyFingerprint, type InPlayPenalty } from './inPlayPenalties';

/** Exact live-board identity, independent of mutable rotation timestamps. */
export function liveRoundKey(rotation: { round?: number; roundInstanceId?: string; updatedAt?: number }): string {
  return rotation.roundInstanceId ?? `${rotation.round ?? 'r'}:${rotation.updatedAt ?? 0}`;
}

/** Narrow roster identity, also computed by new clients before committing.
 * Some legacy roster edits do not advance rotation.updatedAt. This detects
 * their changed attribution without persisting another version field. */
export function liveLineupFingerprint(game: {
  rotation?: { playing?: readonly number[]; loans?: { playerId: string; homeTeam: number; filledTeam: number; swapId?: string }[] };
  draftTeams?: { teams?: { index: number; captainId?:string; playerIds?: readonly string[]; colorKey?: string }[]; leftHome?: { playerId: string;homeTeam?:number;at?:number }[] };
}): string {
  return JSON.stringify({
    playing: game.rotation?.playing ?? [],
    teams: (game.draftTeams?.teams ?? []).map(team => [team.index, team.playerIds ?? [], team.colorKey ?? null]),
    leftHome: (game.draftTeams?.leftHome ?? []).map(entry => entry.playerId).sort(),
    loans: (game.rotation?.loans ?? []).map(loan => [loan.playerId, loan.homeTeam, loan.filledTeam, loan.swapId ?? null]),
  });
}

/** Same wire identity as the client alternativeRoundDecision helper. Never
 * include timer ticks: choosing another tiebreaker does not require a clock. */
export function alternativeRoundFingerprint(game: Parameters<typeof liveLineupFingerprint>[0] & {
  status?: string; players?: string[]; guests?: {id:string;name?:string;waitlisted?:boolean}[];
  rotation?: Parameters<typeof liveRoundKey>[0] & {waiting?:number[];wins?:Record<string,number>;baseTeams?:{index:number;playerIds:string[]}[];fillUsage?:unknown;
    lastRoundWinners?:string[];lastRoundLosers?:string[];lastRoundAt?:number;roundInstanceRound?:number};
  draftTeams?: {teams?: {index:number;captainId?:string;playerIds?:readonly string[];colorKey?:string}[];method?:string;numTeams?:number;createdAt?:number;createdBy?:string;
    completionMode?:string;fillMode?:string;published?:boolean;originalTeams?:{index:number;captainId?:string;playerIds?:string[];colorKey?:string}[];
    leftHome?:{playerId:string;homeTeam?:number;at?:number}[]};
  liveMatch?: {inPlayPenalties?: InPlayPenalty[];scoreA?:number;scoreB?:number;goals?: {id?:string;team?:string;scorerId?:string|null;assisterId?:string|null;assistStatus?:string;ownGoal?:boolean;minute?:number}[];
    shootout?: {firstTeam?:string;keeperA?:string|null;keeperB?:string|null;kicks?:{id?:string;team?:string;kickerId?:string|null;keeperId?:string|null;scored?:boolean;outcome?:string;at?:number}[]}};
}):string {
  const rot=game.rotation,draft=game.draftTeams,live=game.liveMatch,shootout=live?.shootout;
  const stable=(value:unknown):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?
    Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,stable(v)])):value;
  const series=JSON.stringify(shootout?[shootout.firstTeam,shootout.keeperA??null,shootout.keeperB??null,
    (shootout.kicks??[]).map(kick=>[kick.id??null,kick.team,kick.kickerId??null,kick.keeperId??'',!!kick.scored,kick.outcome??null,kick.at??0])]:null);
  return JSON.stringify(stable([
    game.status==='open'?'active':game.status,
    rot?.roundInstanceId??`${rot?.round??'r'}:${rot?.updatedAt??0}`,
    rot?.updatedAt??null,rot?.waiting??[],rot?.round??null,
    liveLineupFingerprint(game),
    (draft?.teams??[]).map(team=>[team.index,team.captainId||team.playerIds?.[0]||'']),
    game.players??[],(game.guests??[]).map(guest=>[guest.id,!!guest.waitlisted]),
    live?.scoreA??0,live?.scoreB??0,
    (live?.goals??[]).map(goal=>[goal.id??null,goal.team,goal.scorerId??null,goal.assisterId??null,goal.assistStatus??null,!!goal.ownGoal,goal.minute??0]),
    series,
    ...(live?.inPlayPenalties?.length ? [inPlayPenaltyFingerprint(live.inPlayPenalties)] : []),
    [rot?.wins??null,rot?.baseTeams??null,rot?.fillUsage??null,rot?.lastRoundWinners??null,rot?.lastRoundLosers??null,rot?.lastRoundAt??null,rot?.roundInstanceRound??null],
    [draft?.method??'snake',draft?.numTeams??draft?.teams?.length??0,draft?.createdAt??0,draft?.createdBy??'',draft?.completionMode??null,draft?.fillMode??null,draft?.published??null,
      draft?.originalTeams?.length?draft.originalTeams.map(team=>[team.index,team.captainId||team.playerIds?.[0]||'',team.playerIds,team.colorKey??null]):null,
      (draft?.leftHome??[]).map(entry=>[entry.playerId,entry.homeTeam??0,entry.at??null])],
  ]));
}

/** New clients supply goal ids. Legacy callers retain the historical protocol. */
export function matchesLiveRound(
  game: Parameters<typeof liveLineupFingerprint>[0] & { rotation?: Parameters<typeof liveRoundKey>[0]; liveMatch?: {
    goals?: { id?: string }[];
    inPlayPenalties?: InPlayPenalty[];
    shootout?: { kicks?: { kickerId?: string | null; keeperId?: string | null; scored?: boolean; outcome?: string }[] };
  } },
  roundId: string | number | null | undefined,
  goalIds: unknown,
  snapshot?: { rotationUpdatedAt?: number | null; penalties?: unknown; inPlayPenaltySnapshot?: unknown; lineupFingerprint?: unknown; alternativeDecision?: {fingerprint?:unknown} },
): boolean {
  if (!Array.isArray(goalIds)) return false;
  if (!game.rotation || String(roundId) !== liveRoundKey(game.rotation)) return false;
  const stored = (game.liveMatch?.goals ?? []).map(goal => goal.id);
  if (stored.length !== goalIds.length || !stored.every((id, index) => id === goalIds[index])) return false;
  if (game.liveMatch?.inPlayPenalties?.length && snapshot?.inPlayPenaltySnapshot !== inPlayPenaltyFingerprint(game.liveMatch.inPlayPenalties)) return false;
  if (snapshot?.inPlayPenaltySnapshot !== undefined && snapshot.inPlayPenaltySnapshot !== inPlayPenaltyFingerprint(game.liveMatch?.inPlayPenalties)) return false;
  if (snapshot) {
    if ((game.rotation.updatedAt ?? null) !== snapshot.rotationUpdatedAt) return false;
    if (snapshot.lineupFingerprint !== undefined && snapshot.lineupFingerprint !== liveLineupFingerprint(game)) return false;
    if (snapshot.alternativeDecision !== undefined) {
      return typeof snapshot.alternativeDecision?.fingerprint==='string' &&
        snapshot.alternativeDecision.fingerprint===alternativeRoundFingerprint(game) &&
        Array.isArray(snapshot.penalties) && snapshot.penalties.length===0 &&
        !!game.liveMatch?.shootout;
    }
    const normalize = (kicks: { kickerId?: string | null; keeperId?: string | null; scored?: boolean; outcome?: string }[]) =>
      kicks.map(kick => ({ kickerId: kick.kickerId || null, keeperId: kick.keeperId || null, scored: !!kick.scored,
        ...(kick.outcome === 'goal' || kick.outcome === 'save' || kick.outcome === 'miss' ? { outcome: kick.outcome } : {}) }));
    if (!Array.isArray(snapshot.penalties) || JSON.stringify(normalize(game.liveMatch?.shootout?.kicks ?? [])) !==
        JSON.stringify(normalize(snapshot.penalties))) return false;
  }
  return true;
}
