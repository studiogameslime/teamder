import { hasCapability } from './services/adminSession';
export const has = {
  firebase: () => hasCapability('firebase'), appStore: () => hasCapability('appStore'),
  appleDownloads: () => hasCapability('appleDownloads'), play: () => hasCapability('play'),
  playDownloads: () => hasCapability('playDownloads'), analytics: () => hasCapability('analytics'),
  admob: () => hasCapability('admob'),
};
