// JS handle for the iOS WatchConnectivity sender (Expo native module).
// Android uses the classic NativeModules.WatchBridge (Wear Data Layer) instead;
// this local module is iOS-only (see expo-module.config.json).
import { requireNativeModule } from 'expo-modules-core';

export interface WatchBridge {
  /** Push the stringified WatchPayload to the paired Apple Watch. */
  publishState(json: string): Promise<void>;
  /** True only when a paired Apple Watch has the Teamder watch app installed. */
  isWatchPaired(): boolean;
}

// Returns null on platforms/builds where the native module isn't present.
export function getWatchBridge(): WatchBridge | null {
  try {
    return requireNativeModule('WatchBridge') as WatchBridge;
  } catch {
    return null;
  }
}
