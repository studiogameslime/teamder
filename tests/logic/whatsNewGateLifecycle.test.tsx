let mockStates: any[] = [], mockRefs: any[] = [], mockStateIndex = 0, mockRefIndex = 0;
let mockEffects: Array<() => any> = [];
jest.mock('react', () => ({ ...jest.requireActual('react'),
  useState: (initial: any) => { const i = mockStateIndex++; if (!(i in mockStates)) mockStates[i] = initial; return [mockStates[i], (next: any) => { mockStates[i] = typeof next === 'function' ? next(mockStates[i]) : next; }]; },
  useRef: (initial: any) => { const i = mockRefIndex++; return mockRefs[i] ?? (mockRefs[i] = { current: initial }); },
  useEffect: (effect: () => any) => mockEffects.push(effect),
}));
jest.mock('react-native', () => ({ AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) } }));
jest.mock('@/components/WhatsNewModal', () => ({ WhatsNewModal: 'Sheet' }));
jest.mock('@/services/whatsNewService', () => ({ resolveWhatsNew: jest.fn(), markWhatsNewSeen: jest.fn() }));
import { WhatsNewGate } from '@/components/WhatsNewGate';
import { resolveWhatsNew, markWhatsNewSeen } from '@/services/whatsNewService';
const payload = { version: '1.1.50', items: [] };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function render(active = true) {
  mockStateIndex = 0; mockRefIndex = 0; mockEffects = [];
  return WhatsNewGate({ active });
}
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks(); mockStates = []; mockRefs = [];
  (markWhatsNewSeen as jest.Mock).mockResolvedValue(undefined);
});
afterEach(() => jest.useRealTimers());
it('does not consume a fetch cancelled by the update gate; reactivation can deliver', async () => {
  let done!: (value: any) => void;
  (resolveWhatsNew as jest.Mock).mockReturnValueOnce(new Promise(resolve => { done = resolve; })).mockResolvedValue(payload);
  render(); const cleanup = mockEffects[0](); cleanup(); done(payload); await flush();
  expect(markWhatsNewSeen).not.toHaveBeenCalled();
  render(); mockEffects[0](); await flush();
  const sheet = render(); expect(sheet).not.toBeNull(); mockEffects[2](); await flush();
  expect(markWhatsNewSeen).toHaveBeenCalledWith('1.1.50');
});
it('retries a failed request and does not render beneath an inactive gate', async () => {
  (resolveWhatsNew as jest.Mock).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(payload);
  render(); const cleanup = mockEffects[0](); await flush();
  jest.advanceTimersByTime(30_000); cleanup(); render(); mockEffects[0](); await flush();
  expect(resolveWhatsNew).toHaveBeenCalledTimes(2);
  expect(render(false)).toBeNull(); mockEffects[2]();
  expect(markWhatsNewSeen).not.toHaveBeenCalled();
  expect(render()).not.toBeNull(); mockEffects[2](); await flush();
  expect(markWhatsNewSeen).toHaveBeenCalledTimes(1);
});
