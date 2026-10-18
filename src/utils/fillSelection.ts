export type FillPicks = [string[], string[]];
export type FillSelection = { picks: FillPicks; editing: 0 | 1 };

export function initialFillSelection(sizes: readonly [number, number], capacity: number, editableSide?: 0 | 1): FillSelection {
  return { picks: [[], []], editing: editableSide ?? (sizes[0] >= capacity ? 1 : 0) };
}

/** Completing a manually selected side focuses the other unfinished side;
 * neither lineup is committed here and no candidate is recommended. */
export function chooseFillPlayer(current: FillSelection, id: string, counts: readonly [number, number], candidates: readonly string[], sequential: boolean): FillSelection {
  const side = current.editing;
  const other = side === 0 ? 1 : 0;
  if (!candidates.includes(id) || current.picks[other].includes(id) || counts[side] === 0) return current;
  const picks: FillPicks = [current.picks[0].slice(), current.picks[1].slice()];
  if (picks[side].includes(id)) {
    picks[side] = picks[side].filter(playerId => playerId !== id);
    return { picks, editing: side };
  }
  if (counts[side] === 1) picks[side] = [id];
  else if (picks[side].length < counts[side]) picks[side].push(id);
  else return current;
  const free = candidates.some(playerId => !picks[0].includes(playerId) && !picks[1].includes(playerId));
  const advance = !sequential && picks[side].length === counts[side] && picks[other].length < counts[other] && free;
  return { picks, editing: advance ? other : side };
}
