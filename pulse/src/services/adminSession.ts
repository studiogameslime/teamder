import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { invalidate } from './cache';

const apiKey = process.env.EXPO_PUBLIC_PULSE_FIREBASE_API_KEY ?? '';
const endpoint = 'https://us-central1-soccer-app-52b6b.cloudfunctions.net/pulseAdminProxy';
const REFRESH_KEY = 'pulse.session.refresh';
type Capability = 'firebase' | 'appStore' | 'appleDownloads' | 'play' | 'playDownloads' | 'analytics' | 'admob';
let capabilities: Partial<Record<Capability, boolean>> = {};
let token: { id: string; refresh: string; until: number } | null = null;
let refreshing: Promise<string> | null = null;
let generation = 0;
let storageWork: Promise<void> = Promise.resolve();
function persistRefresh(refresh: string | null, epoch: number): Promise<void> {
  const work = storageWork.catch(() => {}).then(async () => {
    if (epoch !== generation) throw new Error('ההתחברות השתנתה');
    if (refresh === null) await SecureStore.deleteItemAsync(REFRESH_KEY);
    else await SecureStore.setItemAsync(REFRESH_KEY, refresh, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
    if (epoch !== generation) { await SecureStore.deleteItemAsync(REFRESH_KEY); throw new Error('ההתחברות השתנתה'); }
  });
  storageWork = work;
  return work;
}
const listeners = new Set<() => void>();
let authenticated = false;
export function hasCapability(key: Capability): boolean { return authenticated && capabilities[key] === true; }
export function isPulseSignedIn(): boolean { return authenticated; }
export function onPulseSessionChanged(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
function emit() { listeners.forEach(fn => fn()); }

async function clearLegacyCache() {
  invalidate();
  const keys = (await AsyncStorage.getAllKeys()).filter(k => k.startsWith('pulse.gtoken.') || k.startsWith('pulse.cache.'));
  if (keys.length) await AsyncStorage.multiRemove(keys);
}
async function authRequest(operation: string, body: Record<string, unknown>) {
  if (!apiKey) throw new Error('חסרה הגדרת חיבור מאובטח לפולס');
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${operation}?key=${encodeURIComponent(apiKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error('ההתחברות לא הצליחה. בדקו את פרטי החשבון ונסו שוב');
  return response.json() as Promise<{ idToken: string; refreshToken: string; expiresIn: string }>;
}
async function acceptLogin(data: { idToken: string; refreshToken: string; expiresIn: string }) {
  const epoch = ++generation;
  token = { id: data.idToken, refresh: data.refreshToken, until: Date.now() + Number(data.expiresIn) * 1000 };
  try {
    const session = await pulseAdminRequest({ operation: 'session' });
    if (epoch !== generation) throw new Error('ההתחברות השתנתה');
    await clearLegacyCache();
    await persistRefresh(data.refreshToken, epoch);
    if (epoch !== generation) throw new Error('ההתחברות השתנתה');
    capabilities = session.capabilities ?? {}; authenticated = true; emit();
  } catch (error) {
    if (epoch === generation) { token = null; capabilities = {}; authenticated = false; }
    throw error;
  }
}
export async function signInPulseEmail(email: string, password: string): Promise<void> {
  await acceptLogin(await authRequest('signInWithPassword', { email: email.trim(), password, returnSecureToken: true }));
}
export async function signInPulseGoogle(): Promise<void> {
  const webClientId = process.env.EXPO_PUBLIC_PULSE_GOOGLE_WEB_CLIENT_ID;
  if (!webClientId) throw new Error('חסרה הגדרת כניסה עם גוגל');
  GoogleSignin.configure({ webClientId });
  await GoogleSignin.hasPlayServices();
  const result = await GoogleSignin.signIn();
  if (result.type !== 'success' || !result.data.idToken) throw new Error('ההתחברות בוטלה');
  await acceptLogin(await authRequest('signInWithIdp', { postBody: `id_token=${encodeURIComponent(result.data.idToken)}&providerId=google.com`, requestUri: 'http://localhost', returnSecureToken: true, returnIdpCredential: false, autoCreate: false }));
}
async function idToken(): Promise<string> {
  if (token && token.until > Date.now() + 60000) return token.id;
  if (refreshing) return refreshing;
  const epoch = generation;
  refreshing = (async () => {
    const refresh = token?.refresh ?? await SecureStore.getItemAsync(REFRESH_KEY);
    if (!refresh || !apiKey) throw new Error('נדרשת התחברות לפולס');
    const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refresh)}` });
    if (!response.ok) throw new Error('נדרשת התחברות מחדש לפולס');
    const data = await response.json();
    if (epoch !== generation) throw new Error('ההתחברות השתנתה');
    token = { id: data.id_token, refresh: data.refresh_token, until: Date.now() + Number(data.expires_in) * 1000 };
    await persistRefresh(token.refresh, epoch);
    if (epoch !== generation || !token) throw new Error('ההתחברות השתנתה');
    return token.id;
  })().finally(() => { refreshing = null; });
  return refreshing;
}
export async function pulseAdminRequest(body: Record<string, unknown>): Promise<any> {
  const epoch = generation;
  const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${await idToken()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (epoch !== generation) throw new Error('ההתחברות השתנתה');
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) { authenticated = false; capabilities = {}; emit(); }
    throw new Error(response.status === 403 ? 'לחשבון הזה אין הרשאת כניסה לפולס' : 'לא ניתן להשלים את הבקשה המאובטחת');
  }
  const data = await response.json();
  if (epoch !== generation) throw new Error('ההתחברות השתנתה');
  return data;
}
export async function restorePulseSession(): Promise<void> {
  const epoch = generation;
  await clearLegacyCache();
  if (!(await SecureStore.getItemAsync(REFRESH_KEY))) return;
  const session = await pulseAdminRequest({ operation: 'session' });
  if (epoch !== generation) throw new Error('ההתחברות השתנתה');
  capabilities = session.capabilities ?? {}; authenticated = true; emit();
}
export async function signOutPulse(): Promise<void> {
  ++generation; token = null; authenticated = false; capabilities = {}; emit();
  await persistRefresh(null, generation);
  await clearLegacyCache();
  await GoogleSignin.signOut().catch(() => {});
}
