// healthService — reads a player's OWN session metrics from the wearable data
// hub on the phone (Health Connect on Android / HealthKit on iOS). The phone is
// only the "mailbox": the measurement comes from the wrist device, never the
// phone's sensors.
//
// The native binding (react-native-health-connect / react-native-health) is
// added at BUILD time via plugins/withHealth.js. Until a build includes it,
// every call safely returns null and the physical panel simply doesn't render
// — so this file compiles and runs with no native module present.

import { Platform } from 'react-native';
import { logError } from '@/services/errorLog';
import { computeHrZones, computeEffort, type HrZoneMinutes } from '@/utils/physical';

export interface HealthSession {
  distanceM: number;
  steps: number;
  calories: number;
  avgHr: number;
  maxHr: number;
  topSpeedKmh: number;
  avgSpeedKmh: number;
  sprints: number;
  hrZones: HrZoneMinutes;
  /** 0..100 objective effort score. */
  effortScore: number;
  /** GPS route (if the device recorded one) — feeds the heatmap. */
  route: Array<{ lat: number; lng: number }>;
  source: 'wear' | 'healthkit' | 'healthconnect';
}

interface RawSession {
  distanceM?: number;
  steps?: number;
  calories?: number;
  avgHr?: number;
  maxHr?: number;
  topSpeedKmh?: number;
  avgSpeedKmh?: number;
  sprints?: number;
  hrSamples?: Array<{ bpm: number; ms: number }>;
  route?: Array<{ lat: number; lng: number }>;
}

// Resolve the native health binding. The bindings (react-native-health-connect /
// react-native-health) are NOT installed yet — the physical/heatmap feature is
// a deferred follow-up (withHealth plugin is de-registered). We must therefore
// NOT `require()` them: a static require of a missing module is a Metro/Hermes
// footgun that can hard-crash at runtime (it only bites in real mode — mock
// short-circuits before this runs, which is why it slipped past emulator QA).
// Returns null unconditionally until the bindings are actually installed; then
// restore the guarded require here in the SAME change that adds the deps.
function nativeHealth(): unknown | null {
  return null;
}

// Build-time adapter seam — the concrete Health Connect / HealthKit record
// queries live here. Kept separate so swapping the binding never touches the
// derivation math (zones / effort), which is the same on both platforms and is
// unit-tested in tests/logic/physical.test.ts. Returns null until wired.
async function readRawSession(
  _native: unknown,
  _from: number,
  _to: number,
): Promise<RawSession | null> {
  return null;
}

export const healthService = {
  isAvailable(): boolean {
    return !!nativeHealth();
  },

  /** Read + derive one session's metrics for [from, to]. null when no device. */
  async readSession(from: number, to: number): Promise<HealthSession | null> {
    const native = nativeHealth();
    if (!native) return null;
    try {
      const raw = await readRawSession(native, from, to);
      if (!raw) return null;
      const maxHr = raw.maxHr ?? 0;
      const hrZones = computeHrZones(raw.hrSamples ?? [], maxHr);
      const effortScore = computeEffort(raw.avgHr ?? 0, maxHr, hrZones);
      return {
        distanceM: raw.distanceM ?? 0,
        steps: raw.steps ?? 0,
        calories: raw.calories ?? 0,
        avgHr: raw.avgHr ?? 0,
        maxHr,
        topSpeedKmh: raw.topSpeedKmh ?? 0,
        avgSpeedKmh: raw.avgSpeedKmh ?? 0,
        sprints: raw.sprints ?? 0,
        hrZones,
        effortScore,
        route: raw.route ?? [],
        source: Platform.OS === 'ios' ? 'healthkit' : 'healthconnect',
      };
    } catch (err) {
      logError('healthService.readSession', err, { from, to });
      return null;
    }
  },
};
