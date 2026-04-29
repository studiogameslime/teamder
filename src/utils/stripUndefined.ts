// Drop keys whose value is `undefined`. Firestore rejects undefined
// field values with "Unsupported field value: undefined", and Cloud
// Functions running on the same documents have the same restriction.
// Every patch we send through `updateDoc` / `setDoc(... merge:true)`
// therefore needs to pass through this first.
//
// Shallow-only on purpose: nested object/array fields don't get
// touched. The Game / Group / LiveMatchState shapes don't contain
// nested objects with undefined keys in normal flow — if a future
// nested shape needs the same treatment, add a recursive variant
// rather than making this one expensive for every caller.
export function stripUndefined<T extends object>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}
