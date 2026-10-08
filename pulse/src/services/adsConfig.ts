// Master switch for app-open ads, stored at appConfig/ads.appOpenEnabled.
// The Teamder app reads this BEFORE its Remote Config ad rules: off = no
// app-open ad for anyone; on = the normal cooldown/cap/grace apply.

import { getDoc, patchDoc } from './firestoreRest';

export async function fetchAppOpenEnabled(): Promise<boolean> {
  const doc = await getDoc('appConfig/ads').catch(() => null);
  // Missing doc/field = enabled (matches the app's default).
  return doc?.appOpenEnabled !== false;
}

export async function setAppOpenEnabled(enabled: boolean): Promise<boolean> {
  return patchDoc('appConfig/ads', { appOpenEnabled: enabled, updatedAt: Date.now() });
}

// Master switch for the banner ad, stored at appConfig/ads.bannerEnabled.
// Same contract as appOpenEnabled: off = no banner for anyone; on = banners
// show per the existing rules. The Teamder app reads this before mounting
// any AdBanner.
export async function fetchBannerEnabled(): Promise<boolean> {
  const doc = await getDoc('appConfig/ads').catch(() => null);
  return doc?.bannerEnabled !== false;
}

export async function setBannerEnabled(enabled: boolean): Promise<boolean> {
  return patchDoc('appConfig/ads', { bannerEnabled: enabled, updatedAt: Date.now() });
}
