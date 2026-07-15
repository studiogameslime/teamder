// healthService — reads a player's OWN session metrics from the wearable data
// hub on the phone (Health Connect on Android / HealthKit on iOS). The phone is
// only the "mailbox": the measurement comes from the wrist device, never the
// phone's sensors.
//
// Android is wired to Health Connect (react-native-health-connect, added at
// build time via app.json + plugins/withHealth.js). iOS (HealthKit) is a
// deferred follow-up — nativeHealth() returns null there, so the physical panel
// simply doesn't render and nothing crashes.

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
}

// The native binding's surface. Typed loosely (`any` at the read sites) so we
// don't fight the library's heavy generics — every field is guarded at runtime.
type HealthConnect = typeof import('react-native-health-connect');

// Health Connect READ scopes — must mirror plugins/withHealth.js
// (HC_READ_PERMISSIONS) so a granted permission maps to a manifest entry.
// NOTE: no ExerciseSession / ExerciseRoute — the GPS heatmap was dropped, and
// READ_EXERCISE_ROUTE is the permission Google reviews most strictly.
// HeartRate dropped 2026-07-14 — see plugins/withHealth.js: hardest to justify
// as "essential" for a game-organising app under Google's Jan-2026 health policy.
// Kept in sync with HC_READ_PERMISSIONS so a granted permission always maps to a
// requested record type.
const READ_PERMISSIONS = [
  { accessType: 'read', recordType: 'Distance' },
  { accessType: 'read', recordType: 'Steps' },
  { accessType: 'read', recordType: 'ActiveCaloriesBurned' },
  { accessType: 'read', recordType: 'TotalCaloriesBurned' },
  { accessType: 'read', recordType: 'Speed' },
] as const;

const SDK_AVAILABLE = 3; // SdkAvailabilityStatus.SDK_AVAILABLE
// A speed sample at/above this (≈19 km/h) counts as a sprint.
const SPRINT_MPS = 5.3;
// Reject implausible Speed samples before they poison top-speed / sprints.
// The fastest humans peak ~12.4 m/s; anything above ~12 m/s (≈43 km/h) from a
// wrist GPS is noise (a single glitch sample would otherwise show as "144 קמ״ש"
// on the share card). ~12 m/s leaves headroom above a real sprint.
const MAX_PLAUSIBLE_MPS = 12;
// Persist a "user declined Health Connect" flag so we prompt at most once
// automatically — a manual re-connect can pass forcePrompt to bypass it.
const DECLINED_KEY = 'health.hc.declined';

// Total overlap (ms) between [s,e] and the (sorted, coalesced) active windows.
function overlapMs(
  s: number,
  e: number,
  intervals: Array<{ from: number; to: number }>,
): number {
  let ov = 0;
  for (const iv of intervals) {
    const lo = Math.max(s, iv.from);
    const hi = Math.min(e, iv.to);
    if (hi > lo) ov += hi - lo;
  }
  return ov;
}

// Parse a Health Connect record's [start,end] epoch ms. Interval records carry
// startTime/endTime; instantaneous samples carry `time`. Returns null if unusable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function recTimes(r: any): { s: number; e: number } | null {
  const s = r?.startTime ? Date.parse(r.startTime) : r?.time ? Date.parse(r.time) : NaN;
  const e = r?.endTime ? Date.parse(r.endTime) : s;
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
  return { s, e };
}

// Count sprint BURSTS (rising edges into the sprint state), not raw samples —
// so the number doesn't scale with the device's sampling rate (a 6 s sprint
// sampled at 1 Hz must count as ONE sprint, not six). Samples MUST be in time
// order.
function countSprintBursts(mpsInOrder: number[]): number {
  let n = 0;
  let inSprint = false;
  for (const mps of mpsInOrder) {
    if (mps >= SPRINT_MPS) {
      if (!inSprint) {
        n += 1;
        inSprint = true;
      }
    } else {
      inSprint = false;
    }
  }
  return n;
}

// HEALTH CONNECT ENABLED. The config plugins are BACK in app.json
// (react-native-health-connect + plugins/withHealth.js), which register the
// permission-delegate activity + READ permissions in the manifest — so calling
// the native module's requestPermission / initialize is now safe (the earlier
// crash was because the plugin had been stripped while this flag/code stayed).
// Google's "Health apps" content declaration is now completable on the account
// (proven 2026-07-15), so this ships the ORIGINAL plan: read the player's
// session from Health Connect — the Android hub that ANY wearable (Samsung
// Health, Garmin, Fitbit, Xiaomi, Wear OS…) syncs into — independent of the
// Teamder watch app. ⚠️ Requires the health.* permission descriptions in the
// Play declaration + Google's Health Connect review at submit time.
const HEALTH_ENABLED = true;

// Resolve the native binding once. react-native-health-connect is Android-only;
// on iOS we return null (HealthKit not wired yet). A guarded require means a
// build WITHOUT the native module still runs (returns null) instead of crashing.
let hcModule: HealthConnect | null | undefined;
function nativeHealth(): HealthConnect | null {
  if (!HEALTH_ENABLED) return null;
  if (Platform.OS !== 'android') return null;
  if (hcModule !== undefined) return hcModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    hcModule = require('react-native-health-connect') as HealthConnect;
  } catch {
    hcModule = null;
  }
  return hcModule ?? null;
}

// getSdkStatus + initialize, memoized. false when Health Connect isn't
// installed / needs a provider update (the metrics simply won't show).
let initialized: boolean | null = null;
async function ensureReady(hc: HealthConnect): Promise<boolean> {
  if (initialized !== null) return initialized;
  try {
    const status = await hc.getSdkStatus();
    if (status !== SDK_AVAILABLE) {
      initialized = false;
      return false;
    }
    initialized = await hc.initialize();
  } catch (err) {
    logError('healthService.ensureReady', err);
    initialized = false;
  }
  return initialized;
}

// Concrete Health Connect record reads for [from, to]. Every record type is
// read independently so a missing single permission degrades that metric
// instead of losing the whole session. Returns null when nothing meaningful
// was recorded (so we never upload an all-zero "session").
async function readRawSession(
  native: unknown,
  from: number,
  to: number,
): Promise<RawSession | null> {
  const hc = native as HealthConnect;
  const timeRangeFilter = {
    operator: 'between',
    startTime: new Date(from).toISOString(),
    endTime: new Date(to).toISOString(),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const read = async (recordType: string): Promise<any[]> => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await (hc.readRecords as any)(recordType, {
        timeRangeFilter,
      });
      return res?.records ?? [];
    } catch {
      return [];
    }
  };

  const [dist, steps, active, activeTotal, speed] = await Promise.all([
    read('Distance'),
    read('Steps'),
    read('ActiveCaloriesBurned'),
    read('TotalCaloriesBurned'),
    read('Speed'),
  ]);

  const distanceM = dist.reduce((s, r) => s + (r.distance?.inMeters ?? 0), 0);
  const stepCount = steps.reduce((s, r) => s + (r.count ?? 0), 0);
  // Prefer ActiveCaloriesBurned; fall back to TotalCaloriesBurned for the many
  // bands (some Garmin/Fitbit/Xiaomi profiles) that only write Total — else
  // calories stayed a permanent 0 for them despite a granted permission.
  const activeCal = active.reduce((s, r) => s + (r.energy?.inKilocalories ?? 0), 0);
  const totalCal = activeTotal.reduce((s, r) => s + (r.energy?.inKilocalories ?? 0), 0);
  const calories = activeCal > 0 ? activeCal : totalCal;

  // Heart-rate dropped (see READ_PERMISSIONS) — kept as 0 for type/display compat.
  const avgHr = 0;
  const maxHr = 0;

  const speeds: number[] = [];
  for (const r of speed) {
    for (const smp of r.samples ?? []) {
      const mps = smp.speed?.inMetersPerSecond;
      if (typeof mps === 'number' && mps >= 0 && mps <= MAX_PLAUSIBLE_MPS) speeds.push(mps);
    }
  }
  const topSpeedKmh = speeds.length
    ? Math.round(Math.max(...speeds) * 3.6 * 10) / 10
    : 0;
  const avgSpeedKmh = speeds.length
    ? Math.round((speeds.reduce((s, x) => s + x, 0) / speeds.length) * 3.6 * 10) /
      10
    : 0;
  // speeds is built in record/sample order (Health Connect returns records
  // chronologically), so rising-edge counting yields sprint bursts, not samples.
  const sprints = countSprintBursts(speeds);

  // Nothing worth showing → treat as "no session" so the caller doesn't upload
  // a hollow all-zeros doc.
  if (!distanceM && !stepCount && !calories && speeds.length === 0) {
    return null;
  }

  return {
    distanceM,
    steps: stepCount,
    calories,
    avgHr,
    maxHr,
    topSpeedKmh,
    avgSpeedKmh,
    sprints,
    // hrSamples omitted — heart-rate dropped; hrZones/effort resolve to empty
    // until the effort score is re-based on movement metrics when Health is
    // re-enabled (currently gated off pending the Google health declaration).
  };
}

export const healthService = {
  /** True when the native Health Connect binding is present (Android build). */
  isAvailable(): boolean {
    return !!nativeHealth();
  },

  /**
   * Ensure the SDK is ready and the READ permissions are granted, prompting the
   * Health Connect permission sheet if needed. Returns true when we can read.
   *
   * Auto-prompts at most once: if the user previously declined we skip the
   * prompt (unless `forcePrompt`, e.g. a manual "connect watch" tap) so we never
   * nag on every summary open.
   */
  async ensurePermissions(forcePrompt = false): Promise<boolean> {
    const hc = nativeHealth();
    if (!hc) return false;
    try {
      if (!(await ensureReady(hc))) return false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const granted: any[] = await hc.getGrantedPermissions();
      if (granted.some((g) => g?.accessType === 'read')) return true;

      if (!forcePrompt) {
        const declined = await AsyncStorage.getItem(DECLINED_KEY).catch(
          () => null,
        );
        if (declined === '1') return false;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any[] = await hc.requestPermission(READ_PERMISSIONS as any);
      const ok = res.some((g) => g?.accessType === 'read');
      if (!ok) await AsyncStorage.setItem(DECLINED_KEY, '1').catch(() => {});
      return ok;
    } catch (err) {
      logError('healthService.ensurePermissions', err);
      return false;
    }
  },

  /** Read + derive one session's metrics for [from, to]. null when no device. */
  async readSession(from: number, to: number): Promise<HealthSession | null> {
    const native = nativeHealth();
    if (!native) return null;
    try {
      if (!(await ensureReady(native))) return null;
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
        source: Platform.OS === 'ios' ? 'healthkit' : 'healthconnect',
      };
    } catch (err) {
      logError('healthService.readSession', err, { from, to });
      return null;
    }
  },

  /**
   * Read + aggregate metrics across MULTIPLE [from,to] windows — the exact
   * minutes the live-match timer was running (see physicalSyncService).
   *
   * CRITICAL: we read the wearable records for the WHOLE span [min..max] ONCE
   * and CLIP each record's contribution to the portion overlapping the active
   * windows — we do NOT re-read per window. Health Connect's `between` filter
   * returns every record that OVERLAPS a window, unclipped, so reading per
   * window and summing counted any record spanning a pause boundary (or a single
   * whole-session record) once PER window — inflating distance/steps/calories by
   * up to the number of rounds. Clipping by time-overlap fixes that while still
   * scoping to timer-active minutes. Average speed = total distance ÷ total
   * active time. null when no device / nothing recorded.
   */
  async readSessionMulti(
    intervals: Array<{ from: number; to: number }>,
  ): Promise<HealthSession | null> {
    const native = nativeHealth();
    if (!native) return null;
    try {
      if (!(await ensureReady(native))) return null;
      const windows = intervals.filter((iv) => iv.to > iv.from);
      if (windows.length === 0) return null;
      const spanFrom = Math.min(...windows.map((w) => w.from));
      const spanTo = Math.max(...windows.map((w) => w.to));
      const activeMs = windows.reduce((s, w) => s + (w.to - w.from), 0);

      const hc = native as HealthConnect;
      const timeRangeFilter = {
        operator: 'between',
        startTime: new Date(spanFrom).toISOString(),
        endTime: new Date(spanTo).toISOString(),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const read = async (recordType: string): Promise<any[]> => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const res: any = await (hc.readRecords as any)(recordType, { timeRangeFilter });
          return res?.records ?? [];
        } catch {
          return [];
        }
      };
      const [dist, stepRecs, active, activeTotal, speed] = await Promise.all([
        read('Distance'),
        read('Steps'),
        read('ActiveCaloriesBurned'),
        read('TotalCaloriesBurned'),
        read('Speed'),
      ]);

      // Sum an interval-record scalar, clipped to its overlap with the active
      // windows (value × overlap⁄duration; a zero-duration record counts fully
      // only if its instant falls inside a window).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clippedSum = (records: any[], valOf: (r: any) => number): number =>
        records.reduce((sum, r) => {
          const t = recTimes(r);
          if (!t) return sum;
          const v = valOf(r);
          if (!(typeof v === 'number') || !(v >= 0)) return sum;
          const ov = overlapMs(t.s, t.e, windows);
          if (ov <= 0) return sum;
          const dur = t.e - t.s;
          return sum + (dur > 0 ? v * (ov / dur) : v);
        }, 0);

      const distanceM = clippedSum(dist, (r) => r.distance?.inMeters ?? 0);
      const steps = clippedSum(stepRecs, (r) => r.count ?? 0);
      // Prefer ActiveCaloriesBurned; fall back to TotalCaloriesBurned for bands
      // that only write Total (else calories = 0 despite a granted permission).
      const activeCal = clippedSum(active, (r) => r.energy?.inKilocalories ?? 0);
      const calories = activeCal > 0 ? activeCal : clippedSum(activeTotal, (r) => r.energy?.inKilocalories ?? 0);

      // Speed samples: keep only in-window samples with a plausible magnitude.
      const inWindow = (ms: number): boolean =>
        windows.some((w) => ms >= w.from && ms < w.to);
      const samples: Array<{ ms: number; mps: number }> = [];
      for (const r of speed) {
        for (const smp of r.samples ?? []) {
          const mps = smp.speed?.inMetersPerSecond;
          const ms = smp.time ? Date.parse(smp.time) : NaN;
          if (
            typeof mps === 'number' && mps >= 0 && mps <= MAX_PLAUSIBLE_MPS &&
            Number.isFinite(ms) && inWindow(ms)
          ) {
            samples.push({ ms, mps });
          }
        }
      }
      samples.sort((a, b) => a.ms - b.ms);
      const topSpeedKmh = samples.length
        ? Math.round(Math.max(...samples.map((s) => s.mps)) * 3.6 * 10) / 10
        : 0;
      const sprints = countSprintBursts(samples.map((s) => s.mps));

      if (!distanceM && !steps && !calories && samples.length === 0) return null;

      const avgSpeedKmh =
        activeMs > 0
          ? Math.round((distanceM / (activeMs / 1000)) * 3.6 * 10) / 10
          : 0;
      // Heart-rate dropped in the HC config → zeroed; effort/zones resolve empty.
      const hrZones = computeHrZones([], 0);
      const effortScore = computeEffort(0, 0, hrZones);
      return {
        distanceM,
        steps,
        calories,
        avgHr: 0,
        maxHr: 0,
        topSpeedKmh,
        avgSpeedKmh,
        sprints,
        hrZones,
        effortScore,
        source: Platform.OS === 'ios' ? 'healthkit' : 'healthconnect',
      };
    } catch (err) {
      logError('healthService.readSessionMulti', err, {
        n: intervals.length,
      });
      return null;
    }
  },

  /**
   * True when the Health Connect READ permission is already granted (does NOT
   * prompt). Lets the UI hide the "connect watch" CTA once the user has granted
   * access but simply has no wearable feeding data — otherwise the button is a
   * permanent, un-satisfiable prompt for every Android user without a band.
   */
  async arePermissionsGranted(): Promise<boolean> {
    const hc = nativeHealth();
    if (!hc) return false;
    try {
      if (!(await ensureReady(hc))) return false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const granted: any[] = await hc.getGrantedPermissions();
      return granted.some((g) => g?.accessType === 'read');
    } catch {
      return false;
    }
  },
};
