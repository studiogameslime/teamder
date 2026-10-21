/** Identity links explicitly supplied by the throwing code; never group by text. */
export function errorCauseObjects(error: unknown): object[] {
  const chain: object[] = [];
  const visited = new Set<object>();
  let next: unknown = error;
  while (next !== null && (typeof next === 'object' || typeof next === 'function') && chain.length < 32) {
    const object = next as object;
    if (visited.has(object)) break;
    visited.add(object);
    chain.push(object);
    try {
      // Do not invoke a cause getter, walk prototypes or serialize a payload.
      const cause = Object.getOwnPropertyDescriptor(object, 'cause');
      next = cause && 'value' in cause ? cause.value : undefined;
    } catch { break; } // Revoked/protected proxies are still identities of their own.
  }
  return chain;
}
