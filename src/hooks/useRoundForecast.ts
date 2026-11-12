import { observeCaughtError } from '../utils/errorObservation';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { getForecastFor, type WeatherForecast } from '@/services/weatherService';
import type { Game } from '@/types';

/** Forecasts belong to the round's place and kickoff, never the last screen. */
export function useRoundForecast(
  game: Pick<Game, 'id' | 'startsAt' | 'fieldLat' | 'fieldLng' | 'city'> | null,
  club?: { lat?: number; lng?: number; city?: string },
): WeatherForecast | null {
  // Coordinates are one location; never combine half a round's location
  // with half a club's location when old documents lack one coordinate.
  const gameLocation = Number.isFinite(game?.fieldLat) && Number.isFinite(game?.fieldLng);
  const lat = gameLocation ? game?.fieldLat : club?.lat;
  const lng = gameLocation ? game?.fieldLng : club?.lng;
  const city = game?.city?.trim() || club?.city?.trim();
  const startsAt = game?.startsAt;
  const key = JSON.stringify([game?.id, startsAt, lat, lng, city]);
  const [result, setResult] = useState<{key: string; value: WeatherForecast | null} | null>(null);
  useEffect(() => {
    let alive = true;
    setResult(null);
    if (!startsAt || ((typeof lat !== 'number' || typeof lng !== 'number') && !city)) return;
    let pending = false, hasForecast = false;
    const load = async () => {
      if (!alive || pending || hasForecast) return;
      pending = true;
      try {
        const value = await getForecastFor({lat, lng, city, startsAt});
        hasForecast = value !== null;
        if (alive) setResult({key, value});
      } catch (error) {
        observeCaughtError(error, {source:'src/hooks/useRoundForecast.ts',handler:'useRoundForecast',site:'useRoundForecast:8dfd2e9e80'});
        if (alive) setResult({key, value: null});
      } finally { pending = false; }
    };
    void load();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void load(); });
    return () => { alive = false; subscription.remove(); };
  }, [key, startsAt, lat, lng, city]);
  return result?.key === key ? result.value : null;
}
