import type {Game} from '@/types';
import {roundCommitKey} from '@/services/rotationEngine';
import {rotationWriteSource} from '@/services/rotationWriteSource';
import {shootoutFingerprint} from '@/utils/shootoutDecision';

export interface RoundDecisionContext {
  gameId:string;
  roundId:string;
  playing:string;
  fingerprint:string;
}

/** Bind a result action to the board the manager saw. Pausing its clock does
 * not change the decision, but another lineup, goal or penalty does. */
export function roundDecisionContext(game:Pick<Game,'id'|'status'|'rotation'|'draftTeams'|'players'|'guests'|'liveMatch'>):RoundDecisionContext|undefined {
  if(!game.rotation)return undefined;
  const live=game.liveMatch;
  return {gameId:game.id,roundId:roundCommitKey(game.rotation),playing:game.rotation.playing.join(':'),
    fingerprint:JSON.stringify([
      // Starting the optional clock changes open -> active; both are the
      // same eligible evening. Terminal states still invalidate the action.
      rotationWriteSource({...game,status:game.status==='open'?'active':game.status,liveMatch:undefined}),
      live?.scoreA??0,live?.scoreB??0,
      (live?.goals??[]).map(goal=>[goal.id??null,goal.team,goal.scorerId??null,goal.assisterId??null,goal.assistStatus??null,!!goal.ownGoal]),
      shootoutFingerprint(live?.shootout),
    ]),
  };
}

export function matchesRoundDecision(game:Parameters<typeof roundDecisionContext>[0],expected:RoundDecisionContext):boolean {
  const current=roundDecisionContext(game);
  return !!current && current.gameId===expected.gameId && current.roundId===expected.roundId && current.playing===expected.playing && current.fingerprint===expected.fingerprint;
}
