import { observeCaughtError } from '../utils/errorObservation';

/** Optional on old binaries. Native queues contain fixed codes, never payloads. */
export type NativeDiagnosticBridge = {
  takeDiagnostics?: () => Promise<unknown>;
};

const origins: Record<string, { source: string; handler: string }> = {
  'native.overflow': { source: 'src/native/nativeDiagnostics.ts', handler: 'nativeQueueOverflow' },
  'capture.overlay-list': { source: 'plugins/screenshot-src/ScreenCaptureModule.kt', handler: 'collectOverlayDecorViews' },
  'capture.overlay-draw': { source: 'plugins/screenshot-src/ScreenCaptureModule.kt', handler: 'compositeOverlayWindows' },
  'watch.widgets': { source: 'plugins/wear-src/watch/WatchBridgeModule.kt', handler: 'publishState' },
  'watch.context': { source: 'modules/watch-bridge/ios/WatchBridgeModule.swift', handler: 'updateApplicationContext' },
  'watch.message': { source: 'modules/watch-bridge/ios/WatchBridgeModule.swift', handler: 'sendMessage' },
  'watch.activation': { source: 'modules/watch-bridge/ios/WatchBridgeModule.swift', handler: 'activationDidComplete' },
};

/** A failed diagnostic read must not change screenshot or watch delivery. */
export async function drainNativeDiagnostics(bridge: NativeDiagnosticBridge): Promise<void> {
  if (!bridge.takeDiagnostics) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const entries = await Promise.race([
      bridge.takeDiagnostics(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Native diagnostic read timed out')), 750);
      }),
    ]);
    if (!Array.isArray(entries)) return;
    for (const code of entries.slice(0, 32)) {
      if (typeof code !== 'string' || !Object.prototype.hasOwnProperty.call(origins, code)) continue;
      const error = Object.assign(new Error('Native operation failed: ' + code), { code: 'native/' + code });
      observeCaughtError(error, { ...origins[code], site: 'native:' + code });
    }
  } catch (error) {
    observeCaughtError(error, { source: 'src/native/nativeDiagnostics.ts', handler: 'drainNativeDiagnostics', site: 'native:diagnostic-read' });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
