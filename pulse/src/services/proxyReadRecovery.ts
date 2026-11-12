/** Share a DNS recovery probe for the one Pulse gateway. Each caller still
 * obtains its own response with its own request and session checks. */
export function createProxyReadRecovery() {
  let probe: Promise<void> | null = null;
  let lastFailure: unknown;
  let retryAfter = 0;
  const dnsFailure = (error: unknown) => /UnknownHostException|Unable to resolve host|ENOTFOUND|EAI_AGAIN/i.test(String(error));
  return async function read<T>(request: () => Promise<T>): Promise<T> {
    if (Date.now() < retryAfter) throw lastFailure;
    if (probe) await probe;
    try {
      return await request();
    } catch (error) {
      if (!dnsFailure(error)) throw error;
      if (Date.now() < retryAfter) throw lastFailure;
      if (probe) {
        await probe;
        return request();
      }
      const attempt = new Promise<void>(resolve => setTimeout(resolve, 1000)).then(request);
      probe = attempt.then(() => {}, failure => {
        if (dnsFailure(failure)) {
          lastFailure = failure;
          retryAfter = Date.now() + 15_000;
          throw failure;
        }
        // DNS recovered. Each other caller must check its own HTTP result.
      }).finally(() => { probe = null; });
      // A lone probe also returns its own real rejection to its caller.
      void probe.catch(() => {});
      return attempt;
    }
  };
}
