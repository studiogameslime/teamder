import { observeCaughtError } from './errorObservation';
import { getDoc } from './firestoreRest';
import { cached } from './cache';
import { fetchUsers } from './firebase';

export interface DeviceVersion {
  platform: string;
  version: string;
  device: string;
  observedAt: number;
}
export interface UserVersions {
  userId: string;
  name: string;
  devices: DeviceVersion[];
  failed: boolean;
}

/** Only current token entries; never return tokens to a view or a report. */
export function readDeviceVersions(doc: Record<string, unknown> | null): DeviceVersion[] {
  if (!doc || !Array.isArray(doc.fcmTokens) || !doc.devices || typeof doc.devices !== 'object') return [];
  const metadata = doc.devices as Record<string, unknown>;
  return [...new Set(doc.fcmTokens.filter((token): token is string => typeof token === 'string'))].flatMap(token => {
    const value = metadata[token];
    if (!value || typeof value !== 'object') return [];
    const row = value as Record<string, unknown>;
    const version = typeof row.appVersion === 'string' ? row.appVersion.trim() : '';
    const observedAt = typeof row.registeredAt === 'number' && Number.isFinite(row.registeredAt) && row.registeredAt > 0 ? row.registeredAt : 0;
    if (!version || version === 'unknown' || !observedAt) return [];
    return [{ version, observedAt, platform: row.platform === 'ios' || row.platform === 'android' ? row.platform : 'unknown', device: typeof row.device === 'string' ? row.device : '' }];
  }).sort((a, b) => b.observedAt - a.observedAt);
}

export function fetchUserPushRecord(userId: string, force = false) {
  return cached(`user-push:${userId}`, () => getDoc(`users/${userId}/private/push`), {force});
}

export function fetchUserDevices(userId: string, force = false): Promise<DeviceVersion[]> {
  return cached(`devices:${userId}`, async () => readDeviceVersions(await fetchUserPushRecord(userId, force)), { force });
}

/** Explicit, on-demand scan with bounded concurrency and shared per-user cache. */
export async function fetchVersionInventory(force = false): Promise<UserVersions[]> {
  const users = (await fetchUsers({ force })).filter(user => !user.isTest && !user.deleted);
  const result: UserVersions[] = new Array(users.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(6, users.length) }, async () => {
    while (cursor < users.length) {
      const index = cursor++;
      const user = users[index];
      try { result[index] = { userId: user.id, name: user.name, devices: await fetchUserDevices(user.id, force), failed: false }; }
      catch (caughtError42db4a97a0) {
    observeCaughtError(caughtError42db4a97a0, {"source":"pulse/src/services/deviceVersions.ts","handler":"fetchVersionInventory","site":"deviceVersions:42db4a97a0"}); result[index] = { userId: user.id, name: user.name, devices: [], failed: true }; }
    }
  }));
  return result;
}

export interface VersionGroup { platform: string; version: string; users: UserVersions[]; }
export function summarizeVersions(users: UserVersions[]) {
  const groups = new Map<string, VersionGroup>();
  let known = 0;
  for (const user of users) {
    if (!user.devices.length || user.failed) continue;
    known++;
    // Multiple devices can legitimately put one person in several rows.
    const seen = new Set<string>();
    for (const device of user.devices) {
      const key = JSON.stringify([device.platform, device.version]);
      if (seen.has(key)) continue;
      seen.add(key);
      const group = groups.get(key) ?? { platform: device.platform, version: device.version, users: [] };
      group.users.push(user); groups.set(key, group);
    }
  }
  return { known, unknown: users.filter(u => !u.failed && !u.devices.length).length, failed: users.filter(u => u.failed).length,
    groups: [...groups.values()].sort((a, b) => b.users.length - a.users.length || a.version.localeCompare(b.version)) };
}

/** One latest observation per account on the selected platform; no cross-platform denominator. */
export function latestPlatformVersions(users: UserVersions[], platform: 'android'|'ios', target?:string) {
  const entries=users.map(user=>({user,device:user.failed?undefined:[...user.devices].filter(d=>d.platform===platform).sort((a,b)=>b.observedAt-a.observedAt || a.version.localeCompare(b.version))[0]}));
  const known=entries.filter(row=>!!row.device);
  const current=target?known.filter(row=>row.device!.version===target).length:0;
  return {entries,known:known.length,current,other:known.length-current,missing:entries.filter(row=>!row.user.failed && !row.device).length,failed:entries.filter(row=>row.user.failed).length,percent:target && known.length?Math.round(current/known.length*100):null};
}
