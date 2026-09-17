// appLinks — `footy://open/<where>`, the links a campaign is allowed to point at.
//
// WHY THIS IS NOT deepLinkService. That file parses INVITES: a session or a
// team, plus the attribution that rides along with them, stashed and consumed
// once the user is signed in. A marketing link is a different animal — it names
// a screen, it carries no invite, and it must never touch `invitedBy`. Bending
// parseInviteUrl to also mean "go to the games tab" would put an acquisition
// concern inside the referral path.
//
// It exists because a push or an in-app message that cannot send anyone
// anywhere is only half a message. parseInviteUrl answers null for every URL it
// does not recognise and the caller drops it without a word, so a CTA pointing
// at `footy://communities` did nothing at all — no navigation, no error, no log.
//
// Parsed by hand rather than through expo-linking. These URLs are four shapes
// wide, and a pure module is one the tests can actually run: the suite is plain
// node, where importing an Expo module fails before a single case executes.

/** Where a campaign link may lead. Anything else is not a destination.
 *  A CLOSED LIST on purpose: these URLs are authored in a dashboard by
 *  somebody who is not looking at this repo, and an open mapping from url path
 *  to route name is a way for a typo to become a crash. */
export type AppDestination =
  | 'create-community'
  | 'communities'
  | 'create-game'
  | 'games';

/** What somebody answered when asked why they are here. */
export type UserRole = 'organiser' | 'player';

export interface AppLink {
  dest: AppDestination;
  /** Present when the link is also an ANSWER — the first-run role picker. */
  role?: UserRole;
}

const DESTINATIONS = new Set<string>([
  'create-community',
  'communities',
  'create-game',
  'games',
]);

const ROLES = new Set<string>(['organiser', 'player']);

const OUR_SCHEMES = new Set(['footy', 'teamder']);

/** The same hosting origins deepLinkService accepts, so an https campaign link
 *  behaves exactly like the custom-scheme one. */
const HOSTING_DOMAINS = new Set([
  'teamderfc.web.app',
  'teamderfc.firebaseapp.com',
  'teamder.web.app',
  'teamder.firebaseapp.com',
]);

function queryParam(query: string, key: string): string | undefined {
  for (const pair of query.split('&')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    if (pair.slice(0, eq) !== key) continue;
    try {
      return decodeURIComponent(pair.slice(eq + 1));
    } catch {
      return pair.slice(eq + 1);
    }
  }
  return undefined;
}

/**
 * `footy://open/games?role=player` → `{ dest: 'games', role: 'player' }`.
 *
 * Returns null for anything else — including an unknown destination, which is
 * the case that matters: a dashboard typo must read as "not one of ours" and
 * fall through to the invite parser, not resolve to a route that does not
 * exist.
 *
 * ⚠️ The host is `open`, never `go`: deepLinkService already treats
 * `footy://go` as the generic app-invite link, and reusing it would make a
 * campaign tap register as an acquisition referral instead.
 */
export function parseAppLink(url: string): AppLink | null {
  if (!url) return null;
  const sep = url.indexOf('://');
  if (sep < 0) return null;
  const scheme = url.slice(0, sep).toLowerCase();
  let rest = url.slice(sep + 3);

  const hash = rest.indexOf('#');
  if (hash >= 0) rest = rest.slice(0, hash);
  const q = rest.indexOf('?');
  const query = q >= 0 ? rest.slice(q + 1) : '';
  if (q >= 0) rest = rest.slice(0, q);

  // For a custom scheme the authority IS the first segment, so one split
  // covers `footy://open/games` and `footy:///open/games` alike.
  const segments = rest.split('/').filter((s) => s.length > 0);

  if (scheme === 'http' || scheme === 'https') {
    if (!segments.length || !HOSTING_DOMAINS.has(segments[0].toLowerCase())) return null;
    segments.shift();
  } else if (!OUR_SCHEMES.has(scheme)) {
    return null;
  }

  if (segments[0] !== 'open') return null;
  const dest = segments[1];
  if (!dest || !DESTINATIONS.has(dest)) return null;

  const raw = queryParam(query, 'role');
  return raw && ROLES.has(raw)
    ? { dest: dest as AppDestination, role: raw as UserRole }
    : { dest: dest as AppDestination };
}

/** Build one, so a link in this repo and a link in the dashboard agree. */
export function buildAppLink(dest: AppDestination, role?: UserRole): string {
  return role ? `footy://open/${dest}?role=${role}` : `footy://open/${dest}`;
}
