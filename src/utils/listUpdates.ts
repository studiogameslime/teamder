export interface ListUpdateState {
  scope: string; initialized: boolean; order: string[]; revisions: Record<string, string>;
  pending: string[] | null; highlights: Record<string, number>;
}
export function emptyListUpdates(scope: string): ListUpdateState {
  return { scope, initialized: false, order: [], revisions: {}, pending: null, highlights: {} };
}
/** Decoration/order only. The actual records always come from the latest confirmed data. */
export function receiveListUpdate(previous: ListUpdateState, input: {
  scope: string; ids: string[]; revisions: Record<string, string>; ready: boolean; hold: boolean; now: number;
}): ListUpdateState {
  const state = previous.scope === input.scope ? previous : emptyListUpdates(input.scope);
  if (!input.ready) return state;
  const ids = [...new Set(input.ids)];
  if (!state.initialized) return { ...state, initialized: true, order: ids, revisions: input.revisions };
  const valid = new Set(ids), known = new Set(state.order);
  const surviving = state.order.filter(id => valid.has(id));
  const added = ids.filter(id => !known.has(id));
  const changed = ids.filter(id => known.has(id) && state.revisions[id] !== input.revisions[id]);
  const reordered = surviving.join('\0') !== ids.filter(id => known.has(id)).join('\0');
  const hold = input.hold && (added.length > 0 || reordered);
  const highlights = Object.fromEntries(Object.entries(state.highlights).filter(([id, at]) => valid.has(id) && input.now - at < 1000));
  [...changed, ...(hold ? [] : added)].slice(-5).forEach(id => { highlights[id] = input.now; });
  return { scope: input.scope, initialized: true, order: hold ? surviving : ids, revisions: input.revisions, pending: hold ? ids : null, highlights };
}
export function acceptListUpdate(state: ListUpdateState, now: number): ListUpdateState {
  if (!state.pending) return state;
  const known = new Set(state.order), highlights = { ...state.highlights };
  state.pending.filter(id => !known.has(id)).slice(-5).forEach(id => { highlights[id] = now; });
  return { ...state, order: state.pending, pending: null, highlights };
}
