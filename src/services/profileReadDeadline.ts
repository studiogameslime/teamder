import { AppState, type AppStateStatus } from 'react-native';

/** Suspension does not consume the profile's foreground read budget. */
export function profileReadDeadline(expire: () => void, budgetMs = 8000): () => void {
  let remaining = budgetMs;
  let startedAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function update(state: AppStateStatus | null) {
    if (timer !== undefined) {
      clearTimeout(timer);
      remaining = Math.max(0, remaining - Math.max(0, Date.now() - startedAt));
      timer = undefined;
    }
    if (state !== 'background' && state !== 'inactive') {
      startedAt = Date.now();
      timer = setTimeout(expire, remaining);
    }
  }
  const subscription = AppState.addEventListener('change', update);
  update(AppState.currentState);
  return () => { subscription.remove(); clearTimeout(timer); };
}
