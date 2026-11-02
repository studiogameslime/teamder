import { cached } from './cache';
import { fetchUserDevices, type DeviceVersion } from './deviceVersions';
import { fetchAppleVersions, type StoreVersion } from './appStoreConnect';
import { getDoc } from './firestoreRest';
import { homeDayStart, readHomePages } from './homeDashboard';
import { isTestAccount } from './firebase';
import { observeCaughtError, observeSettledErrors } from './errorObservation';

export type VersionPlatform = 'android' | 'ios';
export interface AdoptionUser {
  userId: string; name: string; platform?: string; lastSeenAt?: number;
  devices: DeviceVersion[]; failed: boolean;
}
export interface AdoptionTarget { version: string; partial: boolean; source?: 'store' | 'releaseLog' }
export interface VersionAdoption {
  users: AdoptionUser[]; targets: Record<VersionPlatform, AdoptionTarget | null>;
  failedStores: VersionPlatform[]; at: number;
}
type VersionState = 'current' | 'older' | 'newer' | 'unknown';
export interface AdoptionEntry { user: AdoptionUser; device?: DeviceVersion; state: VersionState; today: boolean; versionToday: boolean }
const DAY = 86400000;
export const VERSION_ADOPTION_TTL = 10 * 60_000;
const USER_FIELDS = ['name', 'email', 'qa', 'platform', 'lastSeenAt'];

/** Numeric store versions only. A preview/build label cannot be called old. */
export function compareAppVersions(a: string, b: string): number | null {
  if (![a, b].every(v => /^\d+(?:\.\d+){1,3}$/.test(v))) return null;
  const aa = a.split('.').map(Number), bb = b.split('.').map(Number);
  if (![...aa, ...bb].every(Number.isSafeInteger)) return null;
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    if ((aa[i] ?? 0) !== (bb[i] ?? 0)) return (aa[i] ?? 0) > (bb[i] ?? 0) ? 1 : -1;
  }
  return 0;
}

export function liveAppleTarget(versions: StoreVersion[]): AdoptionTarget | null {
  const live = versions.filter(v => ['READY_FOR_SALE', 'READY_FOR_DISTRIBUTION'].includes(v.state) && compareAppVersions(v.version, v.version) !== null)
    .sort((a, b) => compareAppVersions(b.version, a.version) ?? 0)[0];
  return live ? { version: live.version, partial: false, source: 'store' } : null;
}
/** Never open a Play edit from dashboard polling: it can invalidate a concurrent store upload. */
export function liveAndroidTarget(log: Record<string, any> | null): AdoptionTarget | null {
  if (!log?.versions || typeof log.versions !== 'object' || Array.isArray(log.versions)) return null;
  const candidates = Object.entries(log.versions).filter(([version, value]) => {
    const metadata = value as Record<string, unknown> | null;
    return metadata && compareAppVersions(version, version) !== null && (metadata.androidProductionPromoted === true || metadata.androidPublicAvailabilityVerified === true || metadata.androidPublicAvailabilityConfirmedByOwner === true);
  }).sort(([a], [b]) => compareAppVersions(b, a) ?? 0);
  const latest = candidates[0];
  if (!latest) return null;
  const metadata = latest[1] as Record<string, unknown>;
  // If a newer production release awaits public confirmation, do not call the older one latest.
  return metadata.androidPublicAvailabilityVerified === true || metadata.androidPublicAvailabilityConfirmedByOwner === true
    ? { version: latest[0], partial: metadata.androidProductionStatus === 'inProgress', source: 'releaseLog' } : null;
}

/** Full projected user scan, then at most six private reads in flight. No token leaves the reader. */
async function readAdoptionUsers(force: boolean): Promise<AdoptionUser[]> {
  const docs = await readHomePages('users', '__name__', USER_FIELDS, undefined, 'ASCENDING');
  const users = [...new Map(docs.filter(u => !isTestAccount(u.email, u.name) && u.qa !== true && u.name !== 'משתמש שהוסר').map(u => [u.id, u])).values()];
  const result: AdoptionUser[] = new Array(users.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(6, users.length) }, async () => {
    while (cursor < users.length) {
      const index = cursor++, user = users[index];
      const base = { userId: user.id, name: typeof user.name === 'string' ? user.name : 'שם לא תועד', platform: user.platform,
        lastSeenAt: typeof user.lastSeenAt === 'number' ? user.lastSeenAt : undefined };
      try { result[index] = { ...base, devices: await fetchUserDevices(user.id, force), failed: false }; }
      catch (error) {
        observeCaughtError(error, { source: 'pulse/src/services/versionAdoption.ts', handler: 'readAdoptionUsers', site: 'adoption:device' });
        result[index] = { ...base, devices: [], failed: true };
      }
    }
  }));
  return result;
}

export function fetchVersionAdoption(force = false): Promise<VersionAdoption> {
  return cached('home-version-adoption-v1', async () => {
    const [users, stores] = await Promise.all([
      readAdoptionUsers(force),
      Promise.allSettled([getDoc('appConfig/releaseLog', ['versions']), fetchAppleVersions()]).then(results => observeSettledErrors(results, {
        source: 'pulse/src/services/versionAdoption.ts', handler: 'fetchVersionAdoption', site: 'adoption:stores',
      })),
    ]);
    const android = stores[0].status === 'fulfilled' ? liveAndroidTarget(stores[0].value) : null;
    const ios = stores[1].status === 'fulfilled' ? liveAppleTarget(stores[1].value) : null;
    return { users, targets: { android, ios }, failedStores: (['android', 'ios'] as const).filter(p => !(p === 'android' ? android : ios)), at: Date.now() };
  }, { force, ttl: VERSION_ADOPTION_TTL });
}

function latestDevice(user: AdoptionUser, platform: VersionPlatform, now: number): DeviceVersion | undefined {
  if (user.failed) return undefined;
  const devices = user.devices.filter(d => d.platform === platform && Number.isFinite(d.observedAt) && d.observedAt > 0 && d.observedAt <= now)
    .sort((a, b) => b.observedAt - a.observedAt);
  const first = devices[0];
  // Simultaneous conflicting versions are ambiguous, never an arbitrary success.
  return first && compareAppVersions(first.version, first.version) !== null && !devices.some(d => d.observedAt === first.observedAt && d.version !== first.version) ? first : undefined;
}

export function summarizeAdoption(data: VersionAdoption, platform: VersionPlatform, now = Date.now()) {
  const target = data.targets[platform], start = homeDayStart(now);
  const users = [...new Map(data.users.map(u => [u.userId, u])).values()];
  const entries: AdoptionEntry[] = users.filter(u => u.platform === platform || u.devices.some(d => d.platform === platform)).map(user => {
    const device = latestDevice(user, platform, Math.min(now, data.at));
    const comparison = device && target ? compareAppVersions(device.version, target.version) : null;
    const versionToday = !!device && device.observedAt >= start;
    const presenceToday = user.platform === platform && typeof user.lastSeenAt === 'number' && user.lastSeenAt >= start && user.lastSeenAt <= Math.min(now, data.at);
    return { user, device, state: comparison === null ? 'unknown' : comparison === 0 ? 'current' : comparison < 0 ? 'older' : 'newer', today: versionToday || presenceToday, versionToday };
  });
  const count = (state: VersionState) => entries.filter(e => e.state === state).length;
  const known = entries.filter(e => !!e.device).length;
  const today = entries.filter(e => e.today);
  const distribution = new Map<string, number>();
  entries.forEach(e => { if (e.device) distribution.set(e.device.version, (distribution.get(e.device.version) ?? 0) + 1); });
  return { entries, total: entries.length, known, current: count('current'), older: count('older'), newer: count('newer'),
    missing: entries.filter(e => !e.device && !e.user.failed).length, failed: entries.filter(e => e.user.failed).length,
    percent: target && known ? Math.round(count('current') / known * 100) : null,
    stale: entries.filter(e => e.device && now - e.device.observedAt > 30 * DAY).length,
    today: today.length, todayCurrent: today.filter(e => e.versionToday && e.state === 'current').length,
    todayOlder: today.filter(e => e.versionToday && e.state === 'older').length,
    todayNewer: today.filter(e => e.versionToday && e.state === 'newer').length,
    todayUnknown: today.filter(e => !e.versionToday || e.state === 'unknown').length,
    versions: [...distribution].sort(([a], [b]) => compareAppVersions(b, a) ?? 0),
  };
}
