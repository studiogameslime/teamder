jest.mock('@/services/errorLog', () => ({ logError: jest.fn(), isExpectedDenial: () => false }));

const feature = (name = 'מגרש', coordinates = [34.8, 32.1]) => ({ geometry: { coordinates }, properties: { name, city: 'תל אביב' } });
const reply = (body: unknown, status = 200) => ({ ok: status === 200, status, json: async () => body });

beforeEach(() => { jest.resetModules(); global.fetch = jest.fn(); });
afterEach(() => { jest.restoreAllMocks(); });

test('a primary rejection uses a legitimate backup, preserves coordinates and caches the result', async () => {
  const fetch = global.fetch as jest.Mock;
  fetch.mockResolvedValueOnce(reply({}, 403)).mockResolvedValueOnce(reply({ features: [feature()] }));
  const { searchPlaces, coordsForLabel } = require('@/services/govmapService');
  const result = await searchPlaces('מגרש');
  expect(result.unavailable).toBe(false);
  expect(result.places).toEqual([{ label: 'מגרש, תל אביב', type: 'address', lat: 32.1, lng: 34.8 }]);
  expect(coordsForLabel(result.places[0].label)).toEqual({ lat: 32.1, lng: 34.8 });
  expect(await searchPlaces('מגרש')).toBe(result);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][0]).toContain('https://photon.komoot.io/api/');
  expect(fetch.mock.calls[1][1].headers).toBeUndefined();
  expect(require('@/services/errorLog').logError).not.toHaveBeenCalled();
});

test('different queries during the rejection cooldown skip the rejected primary', async () => {
  const fetch = global.fetch as jest.Mock;
  fetch.mockResolvedValueOnce(reply({}, 403)).mockResolvedValue(reply({ features: [feature()] }));
  const { searchPlaces } = require('@/services/govmapService');
  await searchPlaces('אחד'); await searchPlaces('שני');
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(fetch.mock.calls[2][0]).toContain('photon.komoot.io');
});

test('failed providers remain unavailable, and a later successful retry is not poisoned by an empty cache', async () => {
  const fetch = global.fetch as jest.Mock;
  fetch.mockResolvedValueOnce(reply({}, 403)).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(reply({ features: [feature()] }));
  const { searchPlaces } = require('@/services/govmapService');
  expect(await searchPlaces('מגרש')).toEqual({ places: [], unavailable: true });
  expect(require('@/services/errorLog').logError).toHaveBeenCalledWith('govmapSearch',expect.any(Error),{query:'מגרש'});
  expect((await searchPlaces('מגרש')).places).toHaveLength(1);
});

test('backup drops malformed coordinates and places outside the supported map', async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce(reply({}, 403)).mockResolvedValueOnce(reply({ features: [feature('רחוק', [2, 48]), feature('חסר', []), feature()] }));
  const { searchPlaces } = require('@/services/govmapService');
  expect((await searchPlaces('מגרש')).places).toHaveLength(1);
});
