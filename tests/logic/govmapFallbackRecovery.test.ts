const mockObserve = jest.fn();
jest.mock('@/utils/errorObservation', () => ({ observeCaughtError: (...args: unknown[]) => mockObserve(...args) }));
jest.mock('@/services/errorLog', () => ({ logError: jest.fn(), isExpectedDenial: () => false }));
function setup() {
  jest.resetModules(); mockObserve.mockClear();
  const fetcher = jest.fn(); global.fetch = fetcher;
  return { fetcher, service: require('@/services/govmapService') as typeof import('@/services/govmapService') };
}
const backup = { ok: true, json: async () => ({ features: [{ properties: { name: 'מגרש', city: 'תל אביב' }, geometry: { coordinates: [34.8,32.1] } }] }) };
test('a primary rejection recovered by the backup is usable and not reported as a failed search', async () => {
  const { fetcher, service } = setup();
  fetcher.mockResolvedValueOnce({ ok: false, status: 403 }).mockResolvedValueOnce(backup);
  const result = await service.searchPlaces('מגרש');
  expect(result.unavailable).toBe(false);
  expect(result.places.length).toBe(1);
  expect(mockObserve).not.toHaveBeenCalled();
  expect(service.coordsForLabel(result.places[0].label)).toEqual({ lat:32.1, lng:34.8 });
});
test('an empty primary plus failed backup is not cached as a successful empty search', async () => {
  const { fetcher, service } = setup();
  fetcher.mockResolvedValueOnce({ ok:true, json:async()=>({results:[]}) }).mockRejectedValueOnce(new Error('offline'));
  expect(await service.searchPlaces('מגרש')).toEqual({ places:[], unavailable:true });
  fetcher.mockResolvedValueOnce({ ok:true, json:async()=>({results:[]}) }).mockResolvedValueOnce(backup);
  expect((await service.searchPlaces('מגרש')).places.length).toBe(1);
  expect(fetcher).toHaveBeenCalledTimes(4);
});
