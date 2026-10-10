// Master switch for the Teamder home "פנויים לשחק לידך" availability card,
// stored at appConfig/features.availabilityCardEnabled. The Teamder app reads
// this and hides the whole home availability surface when it's false. Same
// contract as adsConfig: missing doc/field = enabled (matches the app default).
import { getDoc, patchDoc } from './firestoreRest';

export async function fetchAvailabilityCardEnabled(): Promise<boolean> {
  const doc = await getDoc('appConfig/features').catch(() => null);
  return doc?.availabilityCardEnabled !== false;
}

export async function setAvailabilityCardEnabled(enabled: boolean): Promise<boolean> {
  return patchDoc('appConfig/features', {
    availabilityCardEnabled: enabled,
    updatedAt: Date.now(),
  });
}
