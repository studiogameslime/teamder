/** A stable representative and every equal holder, independent of fetch/order. */
export function clubLeaderDisplay(ids: readonly string[], fallback: string) {
  const unique = [...new Set(ids)].sort();
  const uid = unique[0] ?? fallback;
  return { uid, tiedIds: unique.filter(id => id !== uid) };
}
