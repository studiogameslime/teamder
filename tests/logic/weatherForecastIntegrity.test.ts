jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('@/services/errorLog', () => ({ logError: jest.fn() }));
const mockFetch = jest.fn();
const kickoff = Date.parse('2026-10-18T22:30:00Z');
const hour = Math.floor(kickoff / 3_600_000) * 3600;
const options = { startsAt: kickoff, lat: 32, lng: 34.8 };
const response = (overrides = {}) => ({ ok: true, json: async () => ({ hourly: {
  time: [hour - 3600, hour], temperature_2m: [11, 23.6], precipitation_probability: [90, 15], weather_code: [61, 2], ...overrides,
} }) });
beforeEach(() => {
  jest.resetModules(); mockFetch.mockReset();
  global.fetch = mockFetch;
  (globalThis as any).__DEV__ = false;
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-17T12:00:00Z'));
});
afterEach(() => jest.restoreAllMocks());

test('forecast uses the kickoff instant and UTC date, independent of device timezone', async () => {
  mockFetch.mockResolvedValue(response());
  const { getForecastFor } = require('@/services/weatherService');
  expect(await getForecastFor(options)).toEqual({ tempC: 24, rainProb: 15, weatherCode: 2 });
  const url = new URL(mockFetch.mock.calls[0][0]);
  expect(url.searchParams.get('timeformat')).toBe('unixtime');
  expect(url.searchParams.get('timezone')).toBe('GMT');
  expect(url.searchParams.get('start_date')).toBe('2026-10-18');
});

test.each(['temperature_2m', 'precipitation_probability', 'weather_code'])('missing %s is unknown weather, never zero or sunshine', async field => {
  mockFetch.mockResolvedValue(response({ [field]: [11, null] }));
  const { getForecastFor } = require('@/services/weatherService');
  expect(await getForecastFor(options)).toBeNull();
});

test('a failed request can recover in the same visit', async () => {
  mockFetch.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response());
  const { getForecastFor } = require('@/services/weatherService');
  expect(await getForecastFor(options)).toBeNull();
  expect(await getForecastFor(options)).toMatchObject({ tempC: 24 });
});

test('cached forecasts expire instead of lasting until the app restarts', async () => {
  mockFetch.mockResolvedValue(response());
  const { getForecastFor } = require('@/services/weatherService');
  await getForecastFor(options); await getForecastFor(options);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-17T12:16:00Z'));
  await getForecastFor(options);
  expect(mockFetch).toHaveBeenCalledTimes(2);
});

test('invalid time and coordinates do not reach the provider', async () => {
  const { getForecastFor } = require('@/services/weatherService');
  expect(await getForecastFor({ ...options, startsAt: NaN })).toBeNull();
  expect(await getForecastFor({ ...options, lat: NaN })).toBeNull();
  expect(await getForecastFor({ ...options, lat: 91 })).toBeNull();
  expect(mockFetch).not.toHaveBeenCalled();
});
