type Bucket = 'players' | 'waitlist' | 'pending';
type Receipt = { state?: string; bucket?: string; reason?: string };
/** Never present a predicted seat as a confirmed registration. */
export function waitForJoinResult(
  subscribe: (next: (receipt: Receipt) => void, fail: (error: unknown) => void) => () => void,
  isOwner: () => boolean,
  timeoutMs = 20000,
): Promise<{bucket: Bucket}> {
  return new Promise((resolve, reject) => {
    let stop: (() => void) | undefined, settled = false;
    const finish = (value?: {bucket: Bucket}, error?: unknown) => {
      if (settled) return;
      settled = true; clearTimeout(timer); stop?.();
      if (error) reject(error); else resolve(value!);
    };
    const timer = setTimeout(() => finish(undefined, new Error('GAME_JOIN_PROCESSING')), timeoutMs);
    stop = subscribe(receipt => {
      if (!isOwner()) { finish(undefined, new Error('STALE_JOIN_SESSION')); return; }
      if (receipt.state === 'rejected') finish(undefined, new Error(receipt.reason ?? 'GAME_JOIN_FORBIDDEN'));
      else if (receipt.state === 'assigned' && ['players','waitlist','pending'].includes(receipt.bucket ?? '')) {
        finish({bucket: receipt.bucket as Bucket});
      }
    }, error => finish(undefined, error));
    if (settled) stop();
  });
}
