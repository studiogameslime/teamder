import type { PlayerSearch, SocialPlayer } from '@/types/social';

// Exercise the actual hook and its timers. Only the hook runtime, focus,
// account and remote pages are supplied by the fixture.
jest.mock('react', () => {
  let slots: any[] = [], cursor = 0, pending: Array<() => void> = [];
  return {
    begin() { cursor = 0; },
    flush() { const effects = pending; pending = []; effects.forEach(effect => effect()); },
    reset() { slots.forEach(slot => slot?.cleanup?.()); slots = []; pending = []; cursor = 0; },
    useRef(initial: unknown) {
      const i = cursor++;
      return slots[i] ?? (slots[i] = { current: initial });
    },
    useState(initial: unknown) {
      const i = cursor++;
      const slot = slots[i] ?? (slots[i] = { value: initial });
      return [slot.value, (next: any) => { slot.value = typeof next === 'function' ? next(slot.value) : next; }];
    },
    useEffect(effect: () => unknown, deps: unknown[]) {
      const i = cursor++, prior = slots[i];
      if (prior && deps.every((value, index) => Object.is(value, prior.deps[index]))) return;
      const slot = slots[i] = { deps, cleanup: undefined as unknown };
      pending.push(() => { prior?.cleanup?.(); slot.cleanup = effect(); });
    },
  };
});

const mockSession = { currentUser: { id: 'owner', isGuest: false }, focused: true };
jest.mock('@/store/userStore', () => ({ useUserStore: Object.assign(
  (select: (state: typeof mockSession) => unknown) => select(mockSession), { getState: () => mockSession },
) }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockSession.focused }));
jest.mock('@/utils/errorObservation', () => ({ observeCaughtError: jest.fn() }));
jest.mock('@/services/socialPlayersService', () => ({ socialPlayersService: { search: jest.fn() } }));
import { usePlayerSearch } from '@/hooks/usePlayerSearch';
import { socialPlayersService } from '@/services/socialPlayersService';
const runtime = require('react') as { begin(): void; flush(): void; reset(): void };
type Page = Awaited<ReturnType<typeof socialPlayersService.search>>;
const search = jest.mocked(socialPlayersService.search);

export function player(id: string): SocialPlayer {
  return { id, name: id, city: '', friend: false, commonClubCount: 0, sharedRounds: 0 };
}

export function playerSearchFixture() {
  runtime.reset();
  jest.useFakeTimers();
  mockSession.currentUser = { id: 'owner', isGuest: false };
  mockSession.focused = true;
  const requests: Array<{ resolve(page: Page): void; reject(error: Error): void }> = [];
  search.mockReset().mockImplementation(() => new Promise((resolve, reject) => requests.push({ resolve, reject })));
  const options: PlayerSearch = { text: 'שחקן' };
  const render = (active = true, preview?: SocialPlayer[]) => {
    runtime.begin();
    const value = usePlayerSearch(options, active, preview);
    runtime.flush();
    return value;
  };
  return { render, options, session: mockSession, requests, search,
    start(active = true, preview?: SocialPlayer[]) { render(active, preview); jest.advanceTimersByTime(301); },
  };
}

afterEach(() => { runtime.reset(); jest.useRealTimers(); });
