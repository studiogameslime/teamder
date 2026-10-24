/** Keep the fair collection window, without starting a second cold worker.
 * Event delivery may already have consumed the whole window. Redeliveries
 * call the same transaction, which selects queued requests only. */
export async function reconcileJoinAfterWindow(
  createdAt: number | undefined,
  windowMs: number,
  reconcile: () => Promise<void>,
  now: () => number = Date.now,
  wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<void> {
  const remaining = typeof createdAt === 'number' && Number.isFinite(createdAt)
    ? Math.max(0, Math.min(windowMs, createdAt + windowMs - now()))
    : windowMs;
  if (remaining > 0) await wait(remaining);
  await reconcile();
}
