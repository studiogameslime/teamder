// heroAtmosphere — drives the MatchStadiumHero's "living sky": a time-of-day
// gradient (so a 7am game feels like morning and a 9pm game feels like
// floodlit night) plus a weather classification (from the WMO code on the
// forecast) that decides whether to overlay falling rain or sun rays.

export type SkyMode = 'morning' | 'day' | 'sunset' | 'night';

export interface Sky {
  mode: SkyMode;
  /** 3-stop top→bottom gradient. Bottom stays dark for text legibility. */
  gradient: [string, string, string];
  /** Floodlights make sense only at night. */
  floodlights: boolean;
}

/**
 * Pick a sky for the kickoff hour (0–23). The bottom stop is always near
 * the original dark navy so the floating white time card stays readable;
 * only the TOP of the gradient changes mood with the time of day.
 */
export function skyForHour(hour: number): Sky {
  if (hour >= 5 && hour < 10) {
    return {
      mode: 'morning',
      gradient: [
        'rgba(96,165,250,0.50)', // soft morning blue
        'rgba(37,78,150,0.66)',
        'rgba(7,12,32,0.92)',
      ],
      floodlights: false,
    };
  }
  if (hour >= 10 && hour < 16) {
    return {
      mode: 'day',
      gradient: [
        'rgba(56,140,232,0.46)', // bright midday blue
        'rgba(24,66,128,0.66)',
        'rgba(7,12,32,0.92)',
      ],
      floodlights: false,
    };
  }
  if (hour >= 16 && hour < 19) {
    return {
      mode: 'sunset',
      gradient: [
        'rgba(244,146,72,0.52)', // warm sunset orange
        'rgba(176,68,96,0.60)', // into magenta
        'rgba(18,14,38,0.92)',
      ],
      floodlights: false,
    };
  }
  return {
    mode: 'night',
    gradient: [
      'rgba(20,38,84,0.55)', // deep night navy
      'rgba(10,20,50,0.80)',
      'rgba(4,8,22,0.95)',
    ],
    floodlights: true,
  };
}

export type WeatherKind =
  | 'clear'
  | 'clouds'
  | 'rain'
  | 'storm'
  | 'snow'
  | 'fog'
  | 'unknown';

/** Classify a WMO weather code into a coarse kind for the hero overlay. */
export function weatherKind(code?: number): WeatherKind {
  if (code == null) return 'unknown';
  if (code === 0 || code === 1) return 'clear';
  if (code === 2 || code === 3) return 'clouds';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'rain';
  if (code >= 85 && code <= 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'unknown';
}
