import type {Game} from '@/types';
import {inPlayPenaltyFingerprint} from '@/utils/inPlayPenalty';
import {liveLineupFingerprint} from '@/utils/liveLineupFingerprint';

/** Wire identity for an atomic replacement of a shootout. Keep parity with
 * functions/src/liveRoundCommit.ts. Clock progress is deliberately excluded. */
export function alternativeRoundFingerprint(game: Pick<Game,'status'|'rotation'|'draftTeams'|'players'|'guests'|'liveMatch'>): string {
  const rot=game.rotation, draft=game.draftTeams, live=game.liveMatch;
  const stable=(value:unknown):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?
    Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,stable(v)])):value;
  const shootout=live?.shootout;
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
    [draft?.method??'snake',draft?.numTeams??draft?.teams.length??0,draft?.createdAt??0,draft?.createdBy??'',draft?.completionMode??null,draft?.fillMode??null,draft?.published??null,
      draft?.originalTeams?.length?draft.originalTeams.map(team=>[team.index,team.captainId||team.playerIds?.[0]||'',team.playerIds,team.colorKey??null]):null,
      (draft?.leftHome??[]).map(entry=>[entry.playerId,entry.homeTeam,entry.at??null])],
  ]));
}
