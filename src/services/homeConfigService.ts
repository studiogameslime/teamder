// homeConfigService — Pulse-controlled master switches for home-screen surfaces,
// stored in Firestore under appConfig/features. The Teamder app reads them; the
// Pulse dashboard flips them (no app release needed). Contract mirrors
// appConfig/ads: only an explicit `false` disables — a missing doc/field means
// "on", and any read error fails OPEN (show).

import { doc, getDoc } from 'firebase/firestore';
import { USE_MOCK_DATA, getFirebase } from '@/firebase/config';

/** Master switch for the home "פנויים לשחק לידך" availability surface
 *  (calendar + the "set availability" prompt). appConfig/features
 *  .availabilityCardEnabled === false → hide it for everyone. */
export async function getAvailabilityCardEnabled(): Promise<boolean> {
  if (USE_MOCK_DATA) return true;
  try {
    const { db } = getFirebase();
    const snap = await getDoc(doc(db, 'appConfig', 'features'));
    if (!snap.exists()) return true;
    const data = snap.data() as { availabilityCardEnabled?: unknown };
    return data.availabilityCardEnabled !== false;
  } catch {
    return true; // fail-open — a config read hiccup must never blank the home
  }
}
