import type { WorkItem, WorkKind } from './workItems';

export type UnresolvedWork = { since: number; reason: string; nextStep: string };
export function readUnresolvedWork(raw: Record<string, unknown>): UnresolvedWork | undefined {
  if (raw.unresolved !== true) return undefined;
  return {
    since: typeof raw.unresolvedAt === 'number' ? raw.unresolvedAt : 0,
    reason: typeof raw.unresolvedReason === 'string' ? raw.unresolvedReason : '',
    nextStep: typeof raw.unresolvedNextStep === 'string' ? raw.unresolvedNextStep : '',
  };
}

/** Classification, not completion: unresolved work stays open and counted.
 * A verified fix awaiting review is no longer in this section. */
export function groupWorkSections(items: WorkItem[], order: WorkKind[]) {
  const unresolved = items.filter(item => item.state === 'open' && item.unresolved);
  const ordinary = items.filter(item => !unresolved.includes(item));
  const groups: { kind: WorkKind | 'unresolved'; items: WorkItem[] }[] = [];
  for (const kind of order) {
    if (kind === 'error' && unresolved.length) groups.push({ kind: 'unresolved', items: unresolved });
    const rows = ordinary.filter(item => item.kind === kind);
    if (rows.length) groups.push({ kind, items: rows });
  }
  return groups;
}
