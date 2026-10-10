/** Stable variety for legacy clubs with no selected/uploaded cover; never a write. */
export function clubDefaultCoverId(groupId?: string): string {
  let hash = 0;
  for (const char of groupId ?? '') hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return `c${String(hash % 10 + 1).padStart(2, '0')}`;
}
