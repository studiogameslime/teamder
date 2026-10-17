import type { DraftTeamsResult, MatchRotation, FillMode, RotationLoan } from '@/types';
import { rosterOf } from '@/services/rotationEngine';
import { canMoveInto } from '@/utils/teamSlots';

/** Exchange the positions the manager can actually see, including fillers. */
export function exchangeLivePlayers(draft: DraftTeamsResult, rotation: MatchRotation | undefined, a: string, b: string, mode: FillMode, swapId: string) {
  const teams = draft.teams.map(t => ({ ...t, playerIds: [...t.playerIds] }));
  const loans = rotation?.loans ?? [];
  const homeA = teams.find(t => t.playerIds.includes(a)), homeB = teams.find(t => t.playerIds.includes(b));
  const atA = teams.find(t => rosterOf(t.index, teams, loans).includes(a));
  const atB = teams.find(t => rosterOf(t.index, teams, loans).includes(b));
  const left = new Set((draft.leftHome ?? []).map(p => p.playerId));
  if (!homeA || !homeB || !atA || !atB || a === b || atA.index === atB.index || left.has(a) || left.has(b)) throw new Error('ההרכבים השתנו. יש לבחור שוב את החילוף.');
  let nextLoans: RotationLoan[] = loans.filter(l => l.playerId !== a && l.playerId !== b);
  if (mode === 'temporary' && rotation) {
    // Join linked exchanges if a player is swapped more than once. Everyone
    // else remains exactly where they are until the connected exchange ends.
    const previous = new Set(loans.filter(l => (l.playerId === a || l.playerId === b) && l.swapId).map(l => l.swapId));
    nextLoans = nextLoans.map(l => l.swapId && previous.has(l.swapId) ? { ...l, swapId } : l);
    if (homeA.index !== atB.index) nextLoans.push({ playerId: a, homeTeam: homeA.index, filledTeam: atB.index, swapId });
    if (homeB.index !== atA.index) nextLoans.push({ playerId: b, homeTeam: homeB.index, filledTeam: atA.index, swapId });
  } else {
    homeA.playerIds = homeA.playerIds.filter(id => id !== a);
    homeB.playerIds = homeB.playerIds.filter(id => id !== b);
    teams.find(t => t.index === atB.index)!.playerIds.push(a);
    teams.find(t => t.index === atA.index)!.playerIds.push(b);
    for (const t of teams) if (t.captainId && !t.playerIds.includes(t.captainId)) t.captainId = t.playerIds[0] ?? t.captainId;
  }
  return { draft: { ...draft, teams, teamsEditedManually: true }, rotation: rotation ? { ...rotation, loans: nextLoans } : undefined };
}

export function moveLivePlayer(draft: DraftTeamsResult, rotation: MatchRotation | undefined, player: string, target: number, capacity: number, mode: FillMode) {
  const teams = draft.teams.map(t => ({ ...t, playerIds: [...t.playerIds] }));
  const loans = rotation?.loans ?? [];
  const home = teams.find(t => t.playerIds.includes(player)), to = teams.find(t => t.index === target);
  const from = teams.find(t => rosterOf(t.index, teams, loans).includes(player));
  if (!home || !to || !from || from.index === target || loans.some(l => l.playerId === player) || draft.leftHome?.some(p => p.playerId === player) || !canMoveInto(rosterOf(from.index,teams,loans).length,rosterOf(target,teams,loans).length,capacity)) throw new Error('המקום הפנוי או ההרכב השתנו. יש לבחור שוב.');
  const nextLoans = [...loans];
  if (mode === 'temporary' && rotation) nextLoans.push({playerId:player,homeTeam:home.index,filledTeam:target});
  else {
    home.playerIds = home.playerIds.filter(id => id !== player); to.playerIds.push(player);
    if (home.captainId === player) home.captainId = home.playerIds[0];
  }
  return {draft:{...draft,teams,teamsEditedManually:true},rotation:rotation?{...rotation,loans:nextLoans}:undefined};
}
