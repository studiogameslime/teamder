// breadcrumbs — the last N things that happened, carried on every report.
//
// Asked for by the owner on 02.10, in the middle of a report he knew nobody
// could reproduce: "אני מניח שזה יהיה בעיין לשחזר את זה… אני רוצה שאתה תמיד
// ברמת הקליינט תשמור את הצעדים שהמשתמש עושה, כל קליק שלו, כל גלילה, כל פעולה
// שהוא עושה, ואם הוא מדווח על משהו או שיש לו שגיאה אתה תשמור את הצעדים
// המדוייקים". He is right, and the bug he was reporting is exactly the class
// this exists for: a tap that produces NOTHING leaves no analytics event, no
// navigation, no error — nothing in any log we keep. The absence is the
// evidence, and until now there was nowhere for an absence to show up.
//
// So the trail records two kinds of thing:
//
//   • `tap` — a raw touch, with where it landed. Written from a capture
//     handler at the very root of the tree, so it fires for EVERY touch,
//     including one that no button ever claims.
//   • everything else — screens, actions, errors — the things that normally
//     follow a tap.
//
// A tap with nothing after it is a dead tap. That is the whole trick.
//
// ⚠️ This is a DIAGNOSTIC trail, not analytics. It never leaves the device on
// its own: it is read when a person submits a report, and at no other time.
// Keep it that way — see `format()` for what it is allowed to contain.

/** What kind of step this is. Kept to one short word so the trail stays legible. */
export type CrumbKind = 'tap' | 'nav' | 'act' | 'err' | 'scroll';

interface Crumb {
  kind: CrumbKind;
  /** The human-readable bit: a screen name, an event name, a coordinate. */
  label: string;
  at: number;
}

/**
 * How many steps to keep.
 *
 * Fifty covers roughly the last minute of ordinary use, which is as far back
 * as anybody remembers when they write "suddenly it stopped responding". More
 * than that and the trail stops fitting in a report doc beside its screenshot.
 */
const MAX = 50;

/**
 * Taps closer together than this are the same gesture as far as the trail is
 * concerned (a double-tap, a stutter on a slow screen). Recording both says
 * nothing the first one did not.
 */
const TAP_DEDUPE_MS = 120;

const ring: Crumb[] = [];
let lastTapAt = 0;

function push(kind: CrumbKind, label: string): void {
  ring.push({ kind, label, at: Date.now() });
  if (ring.length > MAX) ring.splice(0, ring.length - MAX);
}

/**
 * A raw touch, wherever it landed.
 *
 * Coordinates are rounded to whole points: the trail is read by a person
 * trying to work out WHICH control was under the finger, and a decimal place
 * helps nobody.
 */
export function crumbTap(x: number, y: number): void {
  const now = Date.now();
  if (now - lastTapAt < TAP_DEDUPE_MS) return;
  lastTapAt = now;
  push('tap', `${Math.round(x)},${Math.round(y)}`);
}

/** A screen change. */
export function crumbNav(screen: string): void {
  // Re-entering the screen you are already on is navigation noise — a tab bar
  // re-press, a state change that re-reports the route.
  const last = ring[ring.length - 1];
  if (last?.kind === 'nav' && last.label === screen) return;
  push('nav', screen);
}

/** Something the app actually DID — an analytics event, a submit, a toggle. */
export function crumbAct(name: string, detail?: string): void {
  push('act', detail ? `${name}(${detail})` : name);
}

/** A failure. The operation name only — the error itself goes to `errorLog`. */
export function crumbErr(operation: string): void {
  push('err', operation);
}

/**
 * The trail, oldest first, as one compact line per step.
 *
 * Timestamps are RELATIVE — "how long before the report" — because that is
 * the only form in which they are read, and an absolute clock would be one
 * more thing to correlate by hand. A step that follows its predecessor within
 * a tenth of a second shows `+0.0s`, which is itself informative: that is what
 * a tap and the action it triggered look like.
 *
 * Contains no message bodies, no names, no ids — screen names, event names and
 * coordinates only. Anything richer belongs on the report itself, where the
 * person writing it chose to put it.
 */
export function formatTrail(): string {
  if (ring.length === 0) return '';
  const end = ring[ring.length - 1].at;
  return ring
    .map((c) => {
      const ago = ((end - c.at) / 1000).toFixed(1);
      return `-${ago}s ${c.kind} ${c.label}`;
    })
    .join('\n');
}

/** Drop everything. Called on sign-out so one person's trail cannot reach another's report. */
export function clearTrail(): void {
  ring.length = 0;
  lastTapAt = 0;
}

/** How many steps are held right now. For tests. */
export function trailLength(): number {
  return ring.length;
}
