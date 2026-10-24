import { observeCaughtError } from './errorObservation';
import type { DraftTeamsResult } from '@/types';

/** A deliberate new split freezes its own roster, never a previous split. */
export function createManualDraft(teams: string[][], userId: string, createdAt: number, previousTeams: DraftTeamsResult['teams'] = [], colors: Record<number, string> = {}): DraftTeamsResult {
  const result = teams.map((ids, index) => {
    const colorKey = colors[index] ?? previousTeams.find(team => team.index === index)?.colorKey;
    return { index, captainId: ids[0], playerIds: [...ids], ...(colorKey ? {colorKey} : {}) };
  });
  return { method: 'regular', numTeams: teams.length, createdAt, createdBy: userId,
    published: false, teams: result,
    originalTeams: result.map(team => ({ ...team, playerIds: [...team.playerIds] })),
  };
}

/** Pure roster operations. A full target requires an explicit replacement. */
export function manualDraftRevision(draft: { createdAt: number; teams: unknown[] } | null | undefined): string {
  return draft ? JSON.stringify([draft.createdAt, draft.teams.map(team => {
    if (!team || typeof team !== 'object' || Array.isArray(team)) return team;
    const {colorKey: _color, ...roster} = team as Record<string, unknown>;
    return roster;
  })]) : '';
}
export function hasManualDraft(raw: string | null, savedRevision?: string): boolean {
  if (!raw) return false;
  try {
    const value = JSON.parse(raw);
    if (savedRevision !== undefined) {
      const revision = value?.baseDraftRevision ?? '';
      const old = revision ? JSON.parse(revision) : null;
      const normalized = old ? manualDraftRevision({createdAt: old[0], teams: old[1]}) : '';
      if (normalized !== savedRevision) return false;
    }
    return Array.isArray(value?.teams) && value.teams.length > 0 &&
      value.teams.every((team: unknown) => Array.isArray(team) && team.every(id => typeof id === 'string'));
  } catch (caughtError5c0810325d) {
    observeCaughtError(caughtError5c0810325d, {"source":"src/utils/manualAllocation.ts","handler":"hasManualDraft","site":"manualAllocation:5c0810325d"}); return false; }
}

export function moveManualPlayer(teams: string[][], id: string, target: number, capacity: number, replace?: string): string[][] {
  const source = teams.findIndex(t => t.includes(id));
  if (target === source || target < -1 || target >= teams.length) return teams;
  if (target >= 0 && teams[target].length >= capacity && !replace) return teams;
  if (replace && (target < 0 || !teams[target].includes(replace))) return teams;
  const next = teams.map(t => t.filter(p => p !== id && p !== replace));
  if (target >= 0) next[target].push(id);
  if (replace && source >= 0) next[source].push(replace);
  return next;
}

export function restoreManualTeams(value: unknown, roster: string[], count: number, capacity: number): string[][] {
  const allowed = new Set(roster), used = new Set<string>();
  const input = Array.isArray(value) ? value : [];
  return Array.from({length: count}, (_, index) => {
    const row: string[] = [];
    for (const id of Array.isArray(input[index]) ? input[index] : []) {
      if (typeof id === 'string' && allowed.has(id) && !used.has(id) && row.length < capacity) {
        row.push(id); used.add(id);
      }
    }
    return row;
  });
}
/** Gesture coordinates are physical, while Yoga's start follows layout direction. */
export function manualDragPosition(point:{x:number;y:number},bounds:{x:number;y:number;width:number},rtl:boolean) {
  const localX=point.x-bounds.x;
  return {start:(rtl?bounds.width-localX:localX)-65,top:point.y-bounds.y-24};
}

