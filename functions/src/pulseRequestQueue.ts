/** Coalesce concurrent reservations without weakening the shared quota. */
export function pulseRequestQueue(reserve: (uid: string, count: number) => Promise<number>) {
  type Waiting = {resolve: () => void; reject: (error: Error) => void};
  const queues = new Map<string, Waiting[]>();
  return (uid: string): Promise<void> => new Promise((resolve, reject) => {
    const waiting = queues.get(uid);
    if (waiting) { waiting.push({resolve, reject}); return; }
    const pending = [{resolve, reject}];
    queues.set(uid, pending);
    void (async () => {
      try {
        while (pending.length) {
          const batch = pending.splice(0);
          try {
            const allowed = await reserve(uid, batch.length);
            batch.forEach((request, index) => index < allowed ? request.resolve() : request.reject(new Error('PULSE_RATE_LIMIT')));
          } catch (error) {
            batch.forEach(request => request.reject(error instanceof Error ? error : new Error('PULSE_REQUEST_FAILED')));
          }
        }
      } finally { queues.delete(uid); }
    })();
  });
}
