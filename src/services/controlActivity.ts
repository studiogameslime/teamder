import { captureProductActor, recordProductAction } from './productActor';
import { recordDiagnostic } from './diagnosticJournal';
type Handler = (this: unknown, ...args: any[]) => unknown;
type Site = { id: string; kind: string };
const cache = new WeakMap<Handler, Map<string, Handler>>();
const descriptions = new WeakMap<Handler, Site>();
let active: Site | undefined;

/** Only a compile-time code and gesture are sent. Do not forward handler arguments. */
function send(site: Site, actor: string | null) {
  recordProductAction(site.id,actor);
  try {
    const { USE_MOCK_DATA } = require('../firebase/config') as typeof import('../firebase/config');
    if (USE_MOCK_DATA) return;
    const analytics = (require('@react-native-firebase/analytics') as typeof import('@react-native-firebase/analytics')).default;
    void analytics().logEvent('teamder_ui_action', {
      content_id: site.id,
      content_type: site.kind,
    }).catch(() => { recordDiagnostic('act','control_delivery_failed'); });
  } catch { recordDiagnostic('act','control_delivery_unavailable'); }
}

/** A Button may forward a handler through several wrappers. The deepest
 * delegated handler identifies the caller's control. Count that press once. */
export function trackControl<T>(id: string, kind: string, handler: T): T {
  return bindControl(id, kind, handler, true);
}

/** Custom components may defer their caller until after a sheet closes. Only
 * a native gesture sends an event; deferred callbacks never start another. */
export function describeControl<T>(id: string, kind: string, handler: T): T {
  return bindControl(id, kind, handler, false);
}

function bindControl<T>(id: string, kind: string, handler: T, boundary: boolean): T {
  if (typeof handler !== 'function') return handler;
  const fn = handler as Handler;
  let bySite = cache.get(fn);
  if (!bySite) { bySite = new Map(); cache.set(fn, bySite); }
  const key = (boundary ? 'native:' : 'caller:') + id;
  const previous = bySite.get(key);
  if (previous) return previous as T;
  const site = descriptions.get(fn) ?? { id, kind };
  function wrapped(this: unknown, ...args: unknown[]) {
    if (!boundary && !active) return fn.apply(this,args);
    const top = active === undefined;
    const actor = top ? captureProductActor() : null;
    active = site;
    try { return fn.apply(this, args); }
    finally {
      if (top) {
        const chosen = active;
        active = undefined;
        if (chosen) send(chosen, actor);
      }
    }
  }
  if (!boundary) descriptions.set(wrapped,site);
  bySite.set(key, wrapped);
  return wrapped as T;
}

/** Keep the option's source label when a menu closes before invoking it. */
export function inheritControl<T>(from: unknown, handler: T): T {
  const site = typeof from === 'function' ? descriptions.get(from as Handler) : undefined;
  return site ? describeControl(site.id, site.kind, handler) : handler;
}
