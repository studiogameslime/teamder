/** Only the latest view/refresh may publish results, errors or loading state. */
export function createOnboardingActivityLoader<T>(options: {
  query: (session: string | null) => Promise<T[]>;
  rows: (rows: T[]) => void;
  error: (message: string) => void;
  loading: (loading: boolean) => void;
}) {
  let generation = 0;
  return {
    cancel() { generation += 1; },
    async load(session: string | null) {
      const request = ++generation;
      options.loading(true);
      options.error('');
      try {
        const rows = await options.query(session);
        if (request === generation) options.rows(rows);
      } catch {
        if (request === generation) options.error('לא ניתן לטעון את הפעולות. נסו שוב.');
      } finally {
        if (request === generation) options.loading(false);
      }
    },
  };
}
