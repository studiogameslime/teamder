const PROJECT = 'soccer-app-52b6b';
const PACKAGE = 'com.studiogameslime.soccerapp';
const WRITE_COLLECTIONS = new Set(['errors', 'feedback', 'pulseFeatures', 'pulseIdeas', 'tasks', 'adLinks', 'campaigns', 'chatReports', 'segments', 'stickers', 'adminConfig', 'appConfig', 'dmConversations', 'users', 'releaseShots']);

/** Fixed project and services; this is never a general-purpose URL proxy. */
export function pulseProxyTarget(raw: unknown, method: string): { url: URL; scope: string; provider: 'google' | 'oauth' | 'apple' } {
  if (typeof raw !== 'string' || raw.length > 8000) throw new Error('PULSE_TARGET_DENIED');
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) throw new Error('PULSE_TARGET_DENIED');
  const p = decodeURIComponent(url.pathname);
  if (/[\\\x00-\x1f]/.test(p) || p.split('/').some(s => s === '..' || s === '.')) throw new Error('PULSE_TARGET_DENIED');
  const read = method === 'GET';
  if (url.hostname === 'firestore.googleapis.com') {
    const prefix = `/v1/projects/${PROJECT}/databases/(default)/documents`;
    if (!p.startsWith(prefix + '/') && ![prefix + ':runQuery', prefix + ':runAggregationQuery'].includes(p)) throw new Error('PULSE_TARGET_DENIED');
    const collection = p.slice(prefix.length + 1).split('/')[0];
    // Owner-approved local scope: query messages beneath official support DMs.
    const supportParent = p.slice(prefix.length + 1).match(/^dmConversations\/([^/]+):runQuery$/)?.[1];
    const supportIds = supportParent?.split('__') ?? [];
    const supportQuery = method === 'POST' && supportIds.length === 2 &&
      supportIds.includes('teamder') && supportIds[0] !== supportIds[1] &&
      [...supportIds].sort().join('__') === supportParent;
    if (!(read || supportQuery || (method === 'POST' && [prefix + ':runQuery', prefix + ':runAggregationQuery'].includes(p)) ||
      (['PATCH', 'DELETE'].includes(method) && WRITE_COLLECTIONS.has(collection)))) throw new Error('PULSE_TARGET_DENIED');
    return { url, scope: 'datastore', provider: 'google' };
  }
  if (read && url.hostname === 'identitytoolkit.googleapis.com' && p === `/v1/projects/${PROJECT}/accounts:batchGet`) return { url, scope: 'cloud-platform', provider: 'google' };
  if (read && url.hostname === 'monitoring.googleapis.com' && p === `/v3/projects/${PROJECT}/timeSeries`) return { url, scope: 'cloud-platform', provider: 'google' };
  if (read && url.hostname === 'cloudscheduler.googleapis.com' && new RegExp(`^/v1/projects/${PROJECT}/locations/[a-z0-9-]+/jobs$`).test(p)) return { url, scope: 'cloud-platform', provider: 'google' };
  if (url.hostname === 'analyticsdata.googleapis.com' && method === 'POST' && p === '/v1beta/properties/534662166:runReport') return { url, scope: 'analytics.readonly', provider: 'oauth' };
  if (url.hostname === 'admob.googleapis.com' && ((read && p === '/v1/accounts') || (method === 'POST' && /^\/v1\/accounts\/pub-\d+\/networkReport:generate$/.test(p)))) return { url, scope: 'admob.readonly', provider: 'oauth' };
  if (read && url.hostname === 'storage.googleapis.com' && p.startsWith('/storage/v1/b/pubsite_prod_7409752960104322940/o')) return { url, scope: 'devstorage.read_only', provider: 'google' };
  if (url.hostname === 'androidpublisher.googleapis.com') {
    const prefix = `/androidpublisher/v3/applications/${PACKAGE}`;
    const suffix = p.slice(prefix.length);
    if (p.startsWith(prefix) && ((read && (/^\/reviews(?:\/[^/]+)?$/.test(suffix) || /^\/edits\/[^/]+\/tracks\/production$/.test(suffix))) ||
      (method === 'POST' && suffix === '/edits') || (method === 'DELETE' && /^\/edits\/[^/]+$/.test(suffix)))) return { url, scope: 'androidpublisher', provider: 'google' };
  }
  if (read && url.hostname === 'api.appstoreconnect.apple.com' &&
      (/^\/v1\/apps\/6775178022\/(customerReviews|appStoreVersions)$/.test(p) || (p === '/v1/salesReports' && url.searchParams.get('filter[vendorNumber]') === '94396203'))) return { url, scope: '', provider: 'apple' };
  throw new Error('PULSE_TARGET_DENIED');
}

export function pulseAdminAllowed(uid: string, anonymous: boolean, allowed: string): boolean {
  return !anonymous && !!uid && allowed.split(',').map(s => s.trim()).filter(Boolean).includes(uid);
}
