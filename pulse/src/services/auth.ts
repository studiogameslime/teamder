// Token minting for every provider. Pure-JS crypto (jsrsasign) so it runs
// on-device with no native modules.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { KEYUTIL, KJUR } from 'jsrsasign';
import { secrets } from '../secrets';

// ── Apple App Store Connect — ES256 JWT ────────────────────────────
export function appStoreJwt(): string {
  const { issuerId, keyId, privateKeyP8 } = secrets.appStoreConnect;
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const payload = {
    iss: issuerId,
    iat: now,
    exp: now + 60 * 18, // ASC requires <= 20 min
    aud: 'appstoreconnect-v1',
  };
  const key = KEYUTIL.getKey(privateKeyP8);
  return KJUR.jws.JWS.sign(
    'ES256',
    JSON.stringify(header),
    JSON.stringify(payload),
    key as any,
  );
}

// ── Google service account — RS256 JWT → OAuth access token ────────
// One service account covers Google Play (androidpublisher) and GA4
// (analytics). We mint a per-scope token and cache it briefly.
const googleTokenCache: Record<string, { token: string; exp: number }> = {};

// The in-memory cache dies with the process, so EVERY cold start used to pay
// for a 2048-bit RS256 signature in pure JS plus an OAuth round-trip — before
// the first Firestore read could even begin. The token is valid for an hour,
// so it's mirrored to disk and a relaunch within that hour skips both.
//
// Storing it is not a new exposure: the service-account PRIVATE KEY is already
// bundled in this app, and anyone holding that can mint tokens at will. A
// one-hour token adds nothing an attacker didn't already have.
const TOKEN_DISK_PREFIX = 'pulse.gtoken.';

/** Warm the in-memory cache from disk. Safe to call repeatedly. */
async function hydrateToken(scope: string): Promise<void> {
  if (googleTokenCache[scope]) return;
  try {
    const raw = await AsyncStorage.getItem(TOKEN_DISK_PREFIX + scope);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { token?: string; exp?: number };
    if (typeof parsed.token === 'string' && typeof parsed.exp === 'number') {
      googleTokenCache[scope] = { token: parsed.token, exp: parsed.exp };
    }
  } catch {
    /* a corrupt entry just means we mint a fresh token */
  }
}

export async function googleAccessToken(scope: string): Promise<string> {
  await hydrateToken(scope);
  const cached = googleTokenCache[scope];
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.token;

  const { clientEmail, privateKey } = secrets.googleServiceAccount;
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: clientEmail,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const key = KEYUTIL.getKey(privateKey);
  const assertion = KJUR.jws.JWS.sign(
    'RS256',
    JSON.stringify(header),
    JSON.stringify(payload),
    key as any,
  );

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:
      'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' +
      encodeURIComponent(assertion),
  });
  const json = await res.json();
  if (!json.access_token) {
    throw new Error('google token: ' + JSON.stringify(json));
  }
  const entry = { token: json.access_token as string, exp: now + (json.expires_in ?? 3600) };
  googleTokenCache[scope] = entry;
  void AsyncStorage.setItem(TOKEN_DISK_PREFIX + scope, JSON.stringify(entry)).catch(
    () => {},
  );
  return json.access_token;
}

// ── Google OAuth (user account) — refresh token → access token ─────
// One consent covers both AdMob and GA4; the returned access token carries
// whatever scopes were granted, so the same token works for both APIs.
let googleOAuthCache: { token: string; exp: number } | null = null;

export async function googleOAuthToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (googleOAuthCache && googleOAuthCache.exp - 60 > now) {
    return googleOAuthCache.token;
  }
  const { clientId, clientSecret, refreshToken } = secrets.googleOAuth;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:
      `client_id=${encodeURIComponent(clientId)}` +
      `&client_secret=${encodeURIComponent(clientSecret)}` +
      `&refresh_token=${encodeURIComponent(refreshToken)}` +
      '&grant_type=refresh_token',
  });
  const json = await res.json();
  if (!json.access_token) {
    throw new Error('google oauth token: ' + JSON.stringify(json));
  }
  googleOAuthCache = {
    token: json.access_token,
    exp: now + (json.expires_in ?? 3600),
  };
  return json.access_token;
}
