const mockFetch = jest.fn();
const mockForeground = jest.fn();
jest.mock('@react-native-firebase/remote-config', () => ({default: () => ({
  setConfigSettings: async () => {}, setDefaults: async () => {}, fetchAndActivate: mockFetch,
})}));
jest.mock('react-native', () => ({AppState:{addEventListener:mockForeground}}));
jest.mock('@/services/errorLog', () => ({logError:jest.fn(), isExpectedDenial:()=>false}));
import {initRemoteConfig} from '@/services/remoteConfigService';
test('failed boot settings recover on foreground once and remove the recovery listener',async()=>{
  jest.useFakeTimers();
  try {
    (globalThis as any).__DEV__=false;
    const remove=jest.fn();mockForeground.mockReturnValue({remove});
    mockFetch.mockRejectedValue(Object.assign(Error('offline'),{code:'remoteConfig/failure'}));
    const first=initRemoteConfig();await jest.advanceTimersByTimeAsync(500);await first;
    expect(mockFetch).toHaveBeenCalledTimes(2);expect(mockForeground).toHaveBeenCalledTimes(1);
    mockFetch.mockResolvedValue(false);const active=mockForeground.mock.lastCall![1];
    active('background');active('active');active('active');await initRemoteConfig();
    expect(mockFetch).toHaveBeenCalledTimes(3);expect(remove).toHaveBeenCalledTimes(1);
  } finally {jest.useRealTimers();}
});
