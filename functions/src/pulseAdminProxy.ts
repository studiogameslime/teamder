import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { KJUR, KEYUTIL } from 'jsrsasign';
import { pulseProxyTarget, pulseAdminAllowed } from './pulseProxyPolicy';

const adminUids = defineSecret('PULSE_ADMIN_UIDS');
const upstreamKeys = defineSecret('PULSE_UPSTREAM_CREDENTIALS');
type Keys = { googleServiceAccount?: { clientEmail: string; privateKey: string }; googleOAuth?: { clientId: string; clientSecret: string; refreshToken: string }; appStoreConnect?: { issuerId: string; keyId: string; privateKeyP8: string } };
const tokens = new Map<string, { value: string; until: number }>();

async function upstreamToken(provider: 'google' | 'oauth' | 'apple', scope: string, keys: Keys): Promise<string> {
  const cacheKey = `${provider}:${scope}`, cached = tokens.get(cacheKey), now = Math.floor(Date.now() / 1000);
  if (cached && cached.until > now + 60) return cached.value;
  if (provider === 'apple') {
    const k = keys.appStoreConnect;
    if (!k) throw new Error('PULSE_PROVIDER_NOT_CONFIGURED');
    const value = KJUR.jws.JWS.sign('ES256', JSON.stringify({ alg: 'ES256', kid: k.keyId, typ: 'JWT' }), JSON.stringify({ iss: k.issuerId, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' }), KEYUTIL.getKey(k.privateKeyP8) as unknown as string);
    tokens.set(cacheKey, { value, until: now + 600 });
    return value;
  }
  const form = new URLSearchParams();
  if (provider === 'oauth') {
    const k = keys.googleOAuth;
    if (!k) throw new Error('PULSE_PROVIDER_NOT_CONFIGURED');
    form.set('grant_type', 'refresh_token'); form.set('client_id', k.clientId); form.set('client_secret', k.clientSecret); form.set('refresh_token', k.refreshToken);
  } else {
    const k = keys.googleServiceAccount;
    if (!k) {
      if (!['datastore', 'cloud-platform'].includes(scope)) throw new Error('PULSE_PROVIDER_NOT_CONFIGURED');
      return (await admin.app().options.credential!.getAccessToken()).access_token;
    }
    const assertion = KJUR.jws.JWS.sign('RS256', JSON.stringify({ alg: 'RS256', typ: 'JWT' }), JSON.stringify({ iss: k.clientEmail, scope: `https://www.googleapis.com/auth/${scope}`, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }), KEYUTIL.getKey(k.privateKey) as unknown as string);
    form.set('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer'); form.set('assertion', assertion);
  }
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: form, signal: AbortSignal.timeout(15000), redirect: 'error' });
  const data = await response.json() as { access_token?: string; expires_in?: number };
  if (!response.ok || !data.access_token) throw new Error('PULSE_PROVIDER_AUTH_FAILED');
  tokens.set(cacheKey, { value: data.access_token, until: now + Math.min(data.expires_in ?? 3600, 3600) });
  return data.access_token;
}

export const pulseAdminProxy = onRequest({ region: 'us-central1', cors: false, secrets: [adminUids, upstreamKeys], timeoutSeconds: 60, memory: '256MiB', maxInstances: 3 }, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'METHOD_NOT_ALLOWED' }); return; }
  const bearer = req.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
  if (!bearer) { res.status(401).json({ error: 'AUTH_REQUIRED' }); return; }
  let uid: string;
  try {
    const user = await admin.auth().verifyIdToken(bearer, true);
    if (!pulseAdminAllowed(user.uid, user.firebase?.sign_in_provider === 'anonymous', adminUids.value())) { res.status(403).json({ error: 'PULSE_ACCESS_DENIED' }); return; }
    uid = user.uid;
  } catch { res.status(401).json({ error: 'AUTH_REQUIRED' }); return; }
  try {
    const keys = JSON.parse(upstreamKeys.value() || '{}') as Keys;
    if (req.body?.operation === 'session') {
      res.json({ uid, capabilities: { firebase: true, appStore: !!keys.appStoreConnect, appleDownloads: !!keys.appStoreConnect, play: !!keys.googleServiceAccount, playDownloads: !!keys.googleServiceAccount, analytics: !!keys.googleOAuth, admob: !!keys.googleOAuth } }); return;
    }
    const method = String(req.body?.method ?? 'GET').toUpperCase();
    const target = pulseProxyTarget(req.body?.url, method);
    const body = req.body?.body;
    if (body !== undefined && (typeof body !== 'string' || Buffer.byteLength(body) > 1000000)) { res.status(400).json({ error: 'INVALID_BODY' }); return; }
    if (target.url.hostname === 'firestore.googleapis.com' && !['GET', 'POST'].includes(method) &&
        decodeURIComponent(target.url.pathname).includes('/documents/users/')) {
      const path = decodeURIComponent(target.url.pathname).split('/documents/')[1];
      const fields = body ? JSON.parse(body).fields : null;
      // Pulse's sole user mutation is the existing QA flag. Administrative
      // monitoring must not become an arbitrary account/privilege editor.
      if (method !== 'PATCH' || path.split('/').length !== 2 || !fields || Object.keys(fields).some(k => k !== 'qa') ||
          typeof fields.qa?.booleanValue !== 'boolean' || target.url.searchParams.getAll('updateMask.fieldPaths').some(k => k !== 'qa')) { res.status(403).json({ error: 'PULSE_TARGET_DENIED' }); return; }
      target.url.searchParams.set('currentDocument.exists', 'true');
    }
    const quota = admin.firestore().doc(`serverRateLimits/${uid}_pulse`), now = Date.now();
    await admin.firestore().runTransaction(async tx => {
      const old = (await tx.get(quota)).data() ?? {};
      const fresh = typeof old.start !== 'number' || now - old.start >= 60000;
      if (!fresh && old.count >= 500) throw new Error('PULSE_RATE_LIMIT');
      tx.set(quota, { start: fresh ? now : old.start, count: fresh ? 1 : old.count + 1 });
    });
    const token = await upstreamToken(target.provider, target.scope, keys);
    const upstream = await fetch(target.url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body } : {}), redirect: 'error', signal: AbortSignal.timeout(45000) });
    if (!upstream.ok) {
      const failure = await upstream.json().catch(() => null) as {error?: {status?: string}} | null;
      const status = ['ALREADY_EXISTS','FAILED_PRECONDITION','NOT_FOUND'].includes(failure?.error?.status ?? '') ? failure!.error!.status : 'UPSTREAM_REQUEST_FAILED';
      res.json({ status: upstream.status, body: JSON.stringify({ error: {status} }), encoding: 'text' }); return;
    }
    // Stream with a hard bound; never allocate an unbounded provider response.
    const chunks: Buffer[] = []; let length = 0;
    const reader = upstream.body?.getReader();
    if (reader) try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const data = Buffer.from(chunk.value); length += data.length;
        if (length > 23000000) { await reader.cancel(); throw new Error('PULSE_RESPONSE_TOO_LARGE'); }
        chunks.push(data);
      }
    } finally { reader.releaseLock(); }
    res.json({ status: upstream.status, body: Buffer.concat(chunks).toString('base64'), encoding: 'base64', contentType: upstream.headers.get('content-type') });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    res.status(code === 'PULSE_RATE_LIMIT' ? 429 : code === 'PULSE_TARGET_DENIED' ? 403 : 502).json({ error: code.startsWith('PULSE_') ? code : 'PULSE_REQUEST_FAILED' });
  }
});
