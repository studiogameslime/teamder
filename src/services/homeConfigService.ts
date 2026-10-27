import { retryRead } from './readRetry';
import { observeCaughtError } from '../utils/errorObservation';
// homeConfigService — Pulse-controlled master switches for home-screen surfaces,
// stored in Firestore under appConfig/features. The Teamder app reads them; the
// Pulse dashboard flips them (no app release needed). Contract mirrors
// appConfig/ads: only an explicit `false` disables — a missing doc/field means
// "on", and any read error fails OPEN (show).

import { doc, getDoc } from 'firebase/firestore';
import { USE_MOCK_DATA, getFirebase } from '@/firebase/config';

/** Master switch for the home "פנויים לשחק לידך" availability CALENDAR view
 *  (the weekly heatmap only — NOT the "set availability" prompt shown to users
 *  who haven't marked availability). appConfig/features.availabilityCardEnabled
 *  === false → hide the calendar for everyone. */
let lastAvailabilityCardEnabled = true;
export async function getAvailabilityCardEnabled(): Promise<boolean> {
  if (USE_MOCK_DATA) return true;
  try {
    const { db } = getFirebase();
    const snap = await retryRead(() => getDoc(doc(db, 'appConfig', 'features')), () => {});
    if (!snap.exists()) return lastAvailabilityCardEnabled = true;
    const data = snap.data() as { availabilityCardEnabled?: unknown };
    return lastAvailabilityCardEnabled = data.availabilityCardEnabled !== false;
  } catch (caughtErrorf205a50faf) {
    observeCaughtError(caughtErrorf205a50faf, {"source":"src/services/homeConfigService.ts","handler":"getAvailabilityCardEnabled","site":"homeConfigService:f205a50faf"});
    return lastAvailabilityCardEnabled; // Preserve an explicit last-known disable; otherwise fail-open — a config read hiccup must never blank the home
  }
}
