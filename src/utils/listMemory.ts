/** Current-login UI state only. No player data and no disk persistence. */
let activeOwner: string | null = null;
const entries = new Map<string, { values: Record<string, unknown>; offset: number }>();
const LIMIT = 40;
export function activateListOwner(owner: string | null) {
  if (owner !== activeOwner) { entries.clear(); activeOwner = owner; }
}
function entry(owner: string | null, scope: string, create: boolean) {
  if (!owner || activeOwner !== owner) return undefined;
  let value = entries.get(scope);
  if (!value && create) value = { values: {}, offset: 0 };
  if (value) {
    entries.delete(scope); entries.set(scope, value);
    while (entries.size > LIMIT) entries.delete(entries.keys().next().value!);
  }
  return value;
}
export function readListValue<T>(owner: string | null, scope: string, field: string, fallback: T): T {
  const values = entry(owner, scope, false)?.values;
  return values && Object.prototype.hasOwnProperty.call(values, field) ? values[field] as T : fallback;
}
export function writeListValue<T>(owner: string | null, scope: string, field: string, value: T) {
  const target = entry(owner, scope, true); if (target) target.values[field] = value;
}
export function readListOffset(owner: string | null, scope: string) { return entry(owner, scope, false)?.offset ?? 0; }
export function writeListOffset(owner: string | null, scope: string, offset: number) {
  const target = entry(owner, scope, true);
  if (target && Number.isFinite(offset)) target.offset = Math.max(0, offset);
}
