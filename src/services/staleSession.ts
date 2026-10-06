// The one error that means "you asked on behalf of a session that is gone".
//
// A leaf module on purpose. It is needed by `groupService` (which raises it)
// and by `groupStore` (which must recognise it without logging it), and the
// store importing it from the service would pull the whole Firebase/native
// module graph into a file that has no business touching it — which is
// exactly what broke `groupHydrate.test.ts` under jest's node environment.
// Nothing here imports anything.

/**
 * Thrown when a group read is asked for with a uid that is not the session's.
 *
 * A distinct type because callers must be able to tell this apart from a real
 * failure: it is not an error about the DATA, it is "this question belongs to
 * a session that no longer exists". Nothing should log it as a bug, and
 * crucially nothing should read its absence of an answer AS an answer.
 */
export class StaleSessionError extends Error {
  constructor(
    public readonly askedFor: string,
    public readonly sessionUid: string,
  ) {
    super('group read for a session that is no longer current');
    this.name = 'StaleSessionError';
  }
}

/**
 * By NAME as well as by prototype.
 *
 * `instanceof` is the obvious check and the one that quietly fails: it holds
 * only while both sides share one copy of this module, which a bundler split,
 * a duplicated dependency or a hot reload can each break. When it fails it
 * fails OPEN — the error looks ordinary, gets logged as a bug, and the
 * recovery path reads as a fault. The name is set in the constructor and
 * survives all three.
 */
export function isStaleSession(err: unknown): err is StaleSessionError {
  return (
    err instanceof StaleSessionError ||
    (err instanceof Error && err.name === 'StaleSessionError')
  );
}
