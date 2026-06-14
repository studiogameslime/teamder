// Native PixelCopy screen capture (Android). Reads the real window surface so
// maps/GL/video aren't black, unlike react-native-view-shot's Canvas path.
// Backed by the ScreenCapture native module (plugins/withScreenCapture.js);
// returns null when the module is absent (iOS, Expo Go, pre-rebuild) so the
// caller can fall back.

import { NativeModules } from 'react-native';

interface ScreenCaptureNative {
  captureFullScreen(quality: number, maxWidth: number): Promise<string>;
}

const native = (NativeModules as { ScreenCapture?: ScreenCaptureNative })
  .ScreenCapture;

export const hasNativeScreenCapture = !!native?.captureFullScreen;

/** Base64 JPEG (no data: prefix) of the current window, or null if the native
 *  module isn't available / the capture failed. */
export async function captureFullScreenBase64(
  opts: { quality?: number; maxWidth?: number } = {},
): Promise<string | null> {
  if (!native?.captureFullScreen) return null;
  try {
    return await native.captureFullScreen(opts.quality ?? 0.4, opts.maxWidth ?? 600);
  } catch {
    return null;
  }
}
