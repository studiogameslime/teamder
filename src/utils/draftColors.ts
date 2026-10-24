import type { Game, DraftTeamsResult } from '@/types';
import { TEAM_PALETTE, type TeamLike } from '@/utils/teamIdentity';

/** Read boundary for the round's colour choices, including legacy documents. */
export function readDraftColors(value: unknown): Record<number, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter(([index, key]) =>
    /^[0-6]$/.test(index) && typeof key === 'string' && TEAM_PALETTE.some(c => c.key === key));
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** Explicit choices first; fill unused indices without producing duplicate colours. */
export function draftColorTeams(game: Pick<Game, 'draftTeams' | 'draftTeamColors'> | null, count: number): (TeamLike & {index: number; colorKey: string})[] {
  const chosen: Record<number, string> = {}, used = new Set<string>();
  for (let index = 0; index < count; index++) {
    const key = game?.draftTeamColors?.[index] ?? game?.draftTeams?.teams.find(t => t.index === index)?.colorKey;
    if (key && TEAM_PALETTE.some(c => c.key === key) && !used.has(key)) { chosen[index] = key; used.add(key); }
  }
  return Array.from({length: count}, (_, index) => {
    if (!chosen[index]) {
      const preferred = TEAM_PALETTE[index];
      const color = preferred && !used.has(preferred.key) ? preferred : TEAM_PALETTE.find(c => !used.has(c.key))!;
      chosen[index] = color.key; used.add(color.key);
    }
    return {index, colorKey: chosen[index]};
  });
}

/** Colour-only transaction: retain all roster, score, timer and publication fields. */
export function draftColorPatch(game: Pick<Game, 'draftTeams' | 'draftTeamColors' | 'numberOfTeams' | 'status' | 'rotation'>, colors: Record<number, string>, expected: Record<number, string>) {
  if (game.status === 'finished' || game.status === 'cancelled') throw new Error('ROUND_CLOSED');
  if (game.rotation) throw new Error('DRAFT_COLORS_LOCKED');
  const count = game.draftTeams?.teams.length || game.numberOfTeams || 2;
  const current = draftColorTeams(game, count);
  if (Object.keys(colors).length !== count || current.some(t => expected[t.index] !== t.colorKey)) throw new Error('DRAFT_COLORS_CHANGED');
  const values = current.map(t => colors[t.index]);
  if (new Set(values).size !== count || values.some(key => !TEAM_PALETTE.some(c => c.key === key))) throw new Error('INVALID_TEAM_COLORS');
  const recolor = (teams: DraftTeamsResult['teams']) => teams.map(t => ({...t, colorKey: colors[t.index]}));
  return {draftTeamColors: {...colors}, updatedAt: Date.now(), ...(game.draftTeams ? {draftTeams: {
    ...game.draftTeams, teams: recolor(game.draftTeams.teams),
    ...(game.draftTeams.originalTeams ? {originalTeams: recolor(game.draftTeams.originalTeams)} : {}),
  }} : {})};
}
