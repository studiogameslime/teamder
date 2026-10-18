import type {Game} from '@/types';

/** Exact working roster for a new live result write. Keep parity with the
 * server helper; old clients may omit it, new clients never do. */
export function liveLineupFingerprint(game:Pick<Game,'rotation'|'draftTeams'>):string {
  return JSON.stringify({
    playing:game.rotation?.playing??[],
    teams:(game.draftTeams?.teams??[]).map(team=>[team.index,team.playerIds??[],team.colorKey??null]),
    leftHome:(game.draftTeams?.leftHome??[]).map(entry=>entry.playerId).sort(),
    loans:(game.rotation?.loans??[]).map(loan=>[loan.playerId,loan.homeTeam,loan.filledTeam,loan.swapId??null]),
  });
}
