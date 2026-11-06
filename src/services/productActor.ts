import { recordDiagnostic } from './diagnosticJournal';
/** The analytics entry points stay independent of Firebase initialization.
 * A disabled collector never instantiates auth, reads storage or records an ID. */
type Collector = { actor: () => string | null; record: (key:string, owner:string) => void };
let current: Collector | undefined;
export function attachProductCollector(collector: Collector): () => void {
  current = collector;
  return () => { if (current === collector) current = undefined; };
}
export function captureProductActor(): string | null {
  try { return current?.actor() ?? null; } catch { recordDiagnostic('act','product_owner_unavailable'); return null; }
}
export function recordProductAction(key: string, expected: string | null): void {
  try {
    if (expected && current && current.actor() === expected) current.record(key,expected);
  } catch { recordDiagnostic('act','product_action_unavailable'); }
}
