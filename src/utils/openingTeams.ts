import type { DraftTeamsResult } from '@/types';
import { TEAM_PALETTE, teamPaletteEntry } from '@/utils/teamIdentity';

export interface OpeningPlan {
  selected: number[];
  waiting: number[];
  colors: Record<number, string>;
}

/** A saved preparation belongs to exactly this allocation, never a later redraw. */
export function openingFingerprint(draft: DraftTeamsResult): string {
  return JSON.stringify({ teams: draft.teams.map(t => [t.index, t.playerIds, t.colorKey ?? null]),
    left: (draft.leftHome ?? []).map(p => p.playerId), fill: draft.fillMode, completion: draft.completionMode });
}

export function initialOpeningPlan(draft: DraftTeamsResult, restored?: Partial<OpeningPlan>): OpeningPlan {
  const indices = draft.teams.map(t => t.index);
  const colors: Record<number, string> = {};
  const used = new Set<string>();
  // Honour explicit colours first; defaults must not collide with a saved choice.
  for (const t of draft.teams) {
    const choice = restored?.colors?.[t.index] ?? t.colorKey;
    if (teamPaletteEntry(choice) && !used.has(choice!)) { colors[t.index] = choice!; used.add(choice!); }
  }
  for (const t of draft.teams) {
    if (colors[t.index]) continue;
    const preferred = TEAM_PALETTE[t.index];
    const choice = preferred && !used.has(preferred.key) ? preferred : TEAM_PALETTE.find(c => !used.has(c.key));
    if (choice) { colors[t.index] = choice.key; used.add(choice.key); }
  }
  const selected = indices.length === 2 ? indices : [...new Set(restored?.selected ?? [])].filter(i => indices.includes(i)).slice(0, 2);
  const waiting = [...new Set([...(restored?.waiting ?? []), ...indices])].filter(i => indices.includes(i) && !selected.includes(i));
  return { selected, waiting, colors };
}

export function chooseOpeningTeam(plan: OpeningPlan, index: number): OpeningPlan {
  if (plan.selected.includes(index)) return { ...plan, selected: plan.selected.filter(i => i !== index), waiting: [...plan.waiting, index] };
  if (plan.selected.length === 2 || !plan.waiting.includes(index)) return plan;
  return { ...plan, selected: [...plan.selected, index], waiting: plan.waiting.filter(i => i !== index) };
}

export function shuffleOpening(plan: OpeningPlan, random = Math.random): OpeningPlan {
  const order = [...plan.selected, ...plan.waiting];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { ...plan, selected: order.slice(0, 2), waiting: order.slice(2) };
}

export function moveOpeningWaiting(plan: OpeningPlan, index: number, delta: -1 | 1): OpeningPlan {
  const from = plan.waiting.indexOf(index), to = from + delta;
  if (from < 0 || to < 0 || to >= plan.waiting.length) return plan;
  const waiting = [...plan.waiting];
  [waiting[from], waiting[to]] = [waiting[to], waiting[from]];
  return { ...plan, waiting };
}

/** For a taken colour this is an explicit, atomic exchange of identities. */
export function changeOpeningColor(plan: OpeningPlan, index: number, key: string): OpeningPlan {
  if (!teamPaletteEntry(key) || !plan.colors[index]) return plan;
  const other = Object.keys(plan.colors).map(Number).find(i => i !== index && plan.colors[i] === key);
  return { ...plan, colors: { ...plan.colors, [index]: key, ...(other === undefined ? {} : { [other]: plan.colors[index] }) } };
}
