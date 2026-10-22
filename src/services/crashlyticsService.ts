import { NativeModules, Platform } from 'react-native';
import { USE_MOCK_DATA } from '../firebase/config';
import { redactDiagnosticText } from '../utils/diagnosticRedaction';

export interface CrashlyticsError {
  operation: string;
  message: string;
  code?: string;
  stack?: string;
  source?: string;
  handler?: string;
  site?: string;
  isFatal?: boolean;
}

type CrashlyticsSdk = Pick<typeof import('@react-native-firebase/crashlytics'), 'getCrashlytics' | 'recordError'>;
type Reporter = { sdk: CrashlyticsSdk; instance: ReturnType<CrashlyticsSdk['getCrashlytics']> };
let reporter: Reporter | null | undefined;
const counts = new Map<string, number>();
const PER_SIGNATURE_CAP = 8;
const SIGNATURE_CAP = 128;

// The Pulse reporter retains entity ids for reconstruction. This separate sink
// receives no account, action journal or arbitrary context, and strips labelled
// account ids and local user directories from error text as well.
function clean(value: string, limit: number): string {
  return redactDiagnosticText(value)
    .replace(/\b(uid|userId|user_id)["']?\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;)}\]]+)/gi, '$1=[redacted]')
    .replace(/\busers\/[^/\s"'<>()[\]{}?,;]+/gi, 'users/[redacted]')
    .replace(/\/(Users|home)\/[^/\s]+/g, '/$1/[redacted]')
    .slice(0, limit);
}

/** Secondary, best-effort native sink. Never feed a reporter failure to Pulse. */
export function reportCrashlyticsError(input: CrashlyticsError): void {
  try {
    if ((typeof __DEV__ !== 'undefined' && __DEV__) || USE_MOCK_DATA ||
        (Platform.OS !== 'android' && Platform.OS !== 'ios') ||
        !NativeModules?.RNFBCrashlyticsModule) return;

    const operation = clean(input.operation, 100);
    const code = input.code ? clean(input.code, 100) : undefined;
    const signature = JSON.stringify([operation, code]);
    const count = counts.get(signature) ?? 0;
    // Do not evict old signatures: that would let a hot signature bypass its
    // process cap. The second cap also bounds the map and total report volume.
    if (count >= PER_SIGNATURE_CAP || (!counts.has(signature) && counts.size >= SIGNATURE_CAP)) return;

    if (reporter === undefined) {
      reporter = null;
      // Old binaries and Expo Go do not contain this native module. Requiring
      // it only after the guards keeps both paths usable during OTA rollout.
      const sdk = require('@react-native-firebase/crashlytics') as CrashlyticsSdk;
      reporter = { sdk, instance: sdk.getCrashlytics() };
    }
    if (!reporter) return;

    const metadata = [
      `operation=${operation}`,
      code ? `code=${code}` : '',
      ...(['source', 'handler', 'site'] as const).map(key =>
        typeof input[key] === 'string' ? `${key}=${clean(input[key], 160)}` : ''),
      input.isFatal ? 'fatal=true' : '',
    ].filter(Boolean).join('; ');
    // Create a fresh Error: never mutate, forward its cause, or retain the
    // original object, whose extra properties can contain private payloads.
    const error = new Error(`${clean(input.message, 2000)}\n[${metadata}]`);
    error.name = 'TeamderError';
    error.stack = clean(input.stack || error.stack || '', 6000);
    counts.set(signature, count + 1);
    // JS errors stay nonfatal here. ErrorUtils' existing handler still owns
    // fatal behaviour; native crashes are collected by the native SDK itself.
    reporter.sdk.recordError(reporter.instance, error, `Teamder.${operation}`);
  } catch {
    // In particular, do not call observeCaughtError/logError from this sink.
  }
}
