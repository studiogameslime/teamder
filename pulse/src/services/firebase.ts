// Firebase service — reads the app's users/games/groups and derives a rich
// set of aggregate stats for the dashboard. Falls back to mock until the
// service account is present.

import { config } from '../config';
import { has } from '../secrets';
import type {
  AppStats,
  AppUser,
  DailyPoint,
  NameCount,
  TimelineEvent,
  UserActivity,
} from '../types';
import {
  countCollection,
  getDoc,
  listAll,
  patchDoc,
  queryArrayContains,
  queryByCreatedAt,
  queryEquals,
  type FsDoc,
} from './firestoreRest';
import { googleAccessToken } from './auth';
import { cached } from './cache';

const DAY = 24 * 60 * 60 * 1000;

// Heuristic: is this a QA / robot / seeded test account (not a real user)?
//   • Firebase Test Lab / Play pre-launch robots → @cloudtestlabaccounts.com
//   • Seeded fake users follow a faker pattern: word.NNNNN@gmail.com
export function isTestAccount(email?: string, name?: string): boolean {
  const e = (email ?? '').toLowerCase();
  if (!e) return false; // no email (e.g. Apple/phone) → treat as real
  if (e.endsWith('@cloudtestlabaccounts.com')) return true;
  if (/^[a-z]+\.\d{4,6}@gmail\.com$/.test(e)) return true;
  void name;
  return false;
}

function emptyUser(id: string): AppUser {
  return {
    id,
    name: '—',
    joinedAt: 0,
    totalGames: 0,
    attended: 0,
    cancelled: 0,
    achievements: 0,
    yellowCards: 0,
    redCards: 0,
    friends: 0,
    gamesJoined: 0,
    communitiesCreated: 0,
    invitesSent: 0,
    hasPush: false,
    isTest: false,
    deleted: false,
  };
}

function mapUser(d: FsDoc): AppUser {
  const stats = d.stats ?? {};
  const discipline = d.discipline ?? {};
  const achievements = d.achievements ?? {};
  const availability = d.availability ?? {};
  return {
    id: d.id,
    name: d.name ?? 'ללא שם',
    email: d.email ?? undefined,
    avatarId: d.avatarId ?? undefined,
    city: availability.homeCity ?? undefined,
    joinedAt: Number(d.createdAt ?? 0),
    totalGames: Number(stats.totalGames ?? 0),
    attended: Number(stats.attended ?? 0),
    cancelled: Number(stats.cancelled ?? 0),
    achievements: Array.isArray(achievements.unlocked)
      ? achievements.unlocked.length
      : 0,
    yellowCards: Number(discipline.yellowCards ?? 0),
    redCards: Number(discipline.redCards ?? 0),
    friends: Array.isArray(d.friends) ? d.friends.length : 0,
    gamesJoined: Number(achievements.gamesJoined ?? 0),
    communitiesCreated: Number(achievements.teamsCreated ?? 0),
    invitesSent: Number(achievements.invitesSent ?? 0),
    invitedBy: d.invitedBy ?? undefined,
    hasPush: Array.isArray(d.fcmTokens) && d.fcmTokens.length > 0,
    onboardingCompleted: d.onboardingCompleted === true,
    platform: typeof d.platform === 'string' ? d.platform : undefined,
    acquisition: d.acquisition && typeof d.acquisition === 'object'
      ? {
          source: d.acquisition.source ?? undefined,
          campaign: d.acquisition.campaign ?? undefined,
          gameId: d.acquisition.gameId ?? undefined,
          linkId: d.acquisition.linkId ?? undefined,
          at: d.acquisition.at ? Number(d.acquisition.at) : undefined,
        }
      : undefined,
    isTest: isTestAccount(d.email, d.name),
    updatedAt: d.updatedAt ? Number(d.updatedAt) : undefined,
    deleted: d.name === 'משתמש שהוסר',
    qa: d.qa === true,
  };
}

// Short cache for the full users list. It is NO LONGER loaded on poll/open —
// only on demand by the Users / Campaigns / Segment screens. The TTL still
// dedupes the few places that call it within one interaction.
const USERS_TTL_MS = 3 * 60_000;
let usersCache: { at: number; data: AppUser[] } | null = null;

export async function fetchUsers(opts: { force?: boolean } = {}): Promise<AppUser[]> {
  if (!has.firebase()) return [];
  if (!opts.force && usersCache && Date.now() - usersCache.at < USERS_TTL_MS) {
    return usersCache.data;
  }
  const docs = await listAll('users');
  const mapped = docs.map(mapUser).sort((a, b) => b.joinedAt - a.joinedAt);
  usersCache = { at: Date.now(), data: mapped };
  return mapped;
}

// A single user by id — one doc read. For screens that need just one user's
// basic fields without loading the whole collection.
export async function fetchUserById(id: string): Promise<AppUser | null> {
  if (!has.firebase()) return null;
  const doc = await getDoc(`users/${id}`).catch(() => null);
  return doc ? mapUser(doc) : null;
}

export interface UserCounts {
  total: number; // all signups (server count() — 1 read)
  newToday: number; // real (non-test/deleted) signups since local midnight
}

// Cheap headline numbers for the Overview WITHOUT reading the whole users
// collection: a count() aggregation (1 read) for the total, and a tight
// createdAt range query (reads only today's signups) for "new today".
export async function fetchUserCounts(): Promise<UserCounts> {
  if (!has.firebase()) return { total: 0, newToday: 0 };
  const midnight = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const [total, todayDocs] = await Promise.all([
    countCollection('users').catch(() => 0),
    queryByCreatedAt('users', midnight, Date.now()).catch(() => [] as FsDoc[]),
  ]);
  const newToday = todayDocs.map(mapUser).filter((u) => !u.isTest && !u.deleted).length;
  return { total, newToday };
}

// Toggle a user's QA-tester flag. Writes `qa` on the user doc — the app gates
// tester-only surfaces (e.g. the screenshot→bug-report popup) on this. Patches
// the in-memory cache too so the dashboard reflects it without a refetch.
export async function setUserQa(userId: string, qa: boolean): Promise<boolean> {
  const ok = await patchDoc(`users/${userId}`, { qa });
  if (ok && usersCache) {
    usersCache.data = usersCache.data.map((u) =>
      u.id === userId ? { ...u, qa } : u,
    );
  }
  return ok;
}

// Firestore users enriched with Firebase Auth data (login provider, last
// login, last activity) — merged by uid. Auth has no entry for deleted
// accounts, so those keep only their (anonymized) Firestore fields.
export async function fetchUsersWithAuth(force = false): Promise<AppUser[]> {
  return cached('usersAuth', fetchUsersWithAuthUncached, { force });
}

async function fetchUsersWithAuthUncached(): Promise<AppUser[]> {
  const users = await fetchUsers();
  if (!has.firebase()) return users;
  const auth = new Map<
    string,
    { provider: AppUser['provider']; lastLoginAt?: number; lastActiveAt?: number }
  >();
  try {
    const token = await googleAccessToken(
      'https://www.googleapis.com/auth/cloud-platform',
    );
    const project = config.firebase.projectId;
    let pageToken = '';
    do {
      const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:batchGet` +
          `?maxResults=500${pageToken ? `&nextPageToken=${pageToken}` : ''}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) break;
      const data = await res.json();
      for (const u of data.users ?? []) {
        const provs: string[] = (u.providerUserInfo ?? []).map(
          (p: any) => p.providerId,
        );
        const primary =
          provs.find((p) => ['google.com', 'apple.com', 'password'].includes(p)) ??
          provs[0];
        const provider: AppUser['provider'] =
          primary === 'google.com'
            ? 'google'
            : primary === 'apple.com'
              ? 'apple'
              : primary === 'password'
                ? 'password'
                : 'other';
        auth.set(u.localId, {
          provider,
          lastLoginAt: u.lastLoginAt ? Number(u.lastLoginAt) : undefined,
          lastActiveAt: u.lastRefreshAt ? Date.parse(u.lastRefreshAt) : undefined,
        });
      }
      pageToken = data.nextPageToken ?? '';
    } while (pageToken);
  } catch {
    /* auth unavailable — return Firestore-only users */
  }
  return users.map((u) => {
    const a = auth.get(u.id);
    return a ? { ...u, ...a } : u;
  });
}

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function topCounts(
  pairs: Array<[string, number]>,
  limit: number,
): NameCount[] {
  return pairs
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

export async function fetchAppStats(): Promise<AppStats | null> {
  if (!has.firebase()) return null;

  const all = await fetchUsers();
  const users = all.filter((u) => !u.isTest); // real users only
  const now = Date.now();

  // Counts (cheap server-side aggregations; fall back to 0 on error).
  const [totalGames, totalGroups, authProviders] = await Promise.all([
    countCollection('games').catch(() => 0),
    countCollection('groups').catch(() => 0),
    fetchAuthProviders().catch(() => [] as NameCount[]),
  ]);

  const newUsers7 = users.filter((u) => now - u.joinedAt < 7 * DAY).length;
  const newUsers30 = users.filter((u) => now - u.joinedAt < 30 * DAY).length;

  // signups per day, last 30d
  const byDay = new Map<string, number>();
  for (let i = 29; i >= 0; i--) byDay.set(dayKey(now - i * DAY), 0);
  users.forEach((u) => {
    if (now - u.joinedAt < 30 * DAY) {
      const k = dayKey(u.joinedAt);
      if (byDay.has(k)) byDay.set(k, (byDay.get(k) ?? 0) + 1);
    }
  });
  const joinedDaily: DailyPoint[] = Array.from(byDay, ([date, value]) => ({
    date,
    value,
  }));

  // users per city
  const cityMap = new Map<string, number>();
  users.forEach((u) => {
    if (u.city) cityMap.set(u.city, (cityMap.get(u.city) ?? 0) + 1);
  });
  const byCity = topCounts([...cityMap.entries()], 8);

  // referral leaderboard: who invited the most (invitedBy → referrer)
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  const refMap = new Map<string, number>();
  users.forEach((u) => {
    if (u.invitedBy) refMap.set(u.invitedBy, (refMap.get(u.invitedBy) ?? 0) + 1);
  });
  const referralLeaders = topCounts(
    [...refMap.entries()].map(([id, c]) => [nameById.get(id) ?? id, c]),
    8,
  );

  // top players by games attended
  const topPlayers = topCounts(
    users.map((u) => [u.name, u.attended] as [string, number]),
    8,
  ).filter((p) => p.value > 0);

  return {
    totalUsers: users.length,
    testUsers: all.length - users.length,
    newUsers7,
    newUsers30,
    totalGames,
    totalGroups,
    usersWithGames: users.filter((u) => u.totalGames > 0).length,
    usersNoGames: users.filter((u) => u.totalGames === 0).length,
    pushEnabled: users.filter((u) => u.hasPush).length,
    joinedDaily,
    byCity,
    referralLeaders,
    topPlayers,
    authProviders,
  };
}

// ── sign-in method breakdown (Firebase Auth) ───────────────────────
const PROVIDER_LABEL: Record<string, string> = {
  'google.com': 'Google',
  'apple.com': 'Apple',
  password: 'אימייל',
  phone: 'טלפון',
  'facebook.com': 'Facebook',
};

export async function fetchAuthProviders(): Promise<NameCount[]> {
  if (!has.firebase()) return [];
  const token = await googleAccessToken(
    'https://www.googleapis.com/auth/cloud-platform',
  );
  const project = config.firebase.projectId;
  const counts: Record<string, number> = {};
  let pageToken = '';
  do {
    const url =
      `https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:batchGet` +
      `?maxResults=500${pageToken ? `&nextPageToken=${pageToken}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) break;
    const data = await res.json();
    for (const u of data.users ?? []) {
      if (isTestAccount(u.email, u.displayName)) continue; // skip test accounts
      const provs: string[] = (u.providerUserInfo ?? []).map(
        (p: any) => p.providerId,
      );
      const primary = provs.find((p) => PROVIDER_LABEL[p]) ?? provs[0] ?? 'אחר';
      const label = PROVIDER_LABEL[primary] ?? primary;
      counts[label] = (counts[label] ?? 0) + 1;
    }
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);

  return Object.entries(counts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

/** Set of uids that belong to (or admin) at least one community — powers the
 *  "in any group" / "not in any group" segment filter. */
// A community as a map point — where players actually cluster. Communities
// carry an exact lat/lng + city, so this is the richest location signal we
// have (most users never set a home city, but they DO join communities).
export interface CommunityPoint {
  id: string;
  name: string;
  city?: string;
  lat?: number;
  lng?: number;
  members: number;
}

export async function fetchCommunityPoints(force = false): Promise<CommunityPoint[]> {
  if (!has.firebase()) return [];
  return cached('commPoints', communityPointsUncached, { force });
}

async function communityPointsUncached(): Promise<CommunityPoint[]> {
  try {
    const groups = await listAll('groups');
    return groups.map((g) => {
      const ids = new Set<string>([
        ...((g.playerIds as string[] | undefined) ?? []),
        ...((g.adminIds as string[] | undefined) ?? []),
      ]);
      return {
        id: g.id,
        name: typeof g.name === 'string' ? g.name : '',
        city: typeof g.city === 'string' && g.city.trim() ? g.city.trim() : undefined,
        lat: typeof g.lat === 'number' ? g.lat : undefined,
        lng: typeof g.lng === 'number' ? g.lng : undefined,
        members: ids.size,
      };
    });
  } catch {
    return [];
  }
}

export interface GamePoint {
  id: string;
  title?: string;
  city?: string;
  lat?: number;
  lng?: number;
  players: number;
}

// Every game ever, reduced to a plottable point. Coordinates come from the
// field's lat/lng; games with only a city fall back to the city centroid on
// the map. No street addresses — locations & cities only.
export async function fetchGamePoints(force = false): Promise<GamePoint[]> {
  if (!has.firebase()) return [];
  return cached('gamePoints', gamePointsUncached, { force });
}

async function gamePointsUncached(): Promise<GamePoint[]> {
  try {
    const games = await listAll('games');
    return games.map((g) => {
      const ids = new Set<string>([
        ...((g.participantIds as string[] | undefined) ?? []),
        ...((g.players as string[] | undefined) ?? []),
      ]);
      return {
        id: g.id,
        title: typeof g.title === 'string' && g.title.trim() ? g.title.trim() : undefined,
        city: typeof g.city === 'string' && g.city.trim() ? g.city.trim() : undefined,
        lat: typeof g.fieldLat === 'number' ? g.fieldLat : undefined,
        lng: typeof g.fieldLng === 'number' ? g.fieldLng : undefined,
        players: ids.size,
      };
    });
  } catch {
    return [];
  }
}

export async function fetchGroupMemberSet(force = false): Promise<Set<string>> {
  if (!has.firebase()) return new Set<string>();
  return cached('groupMembers', groupMemberSetUncached, { force });
}

async function groupMemberSetUncached(): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    const groups = await listAll('groups');
    for (const g of groups) {
      for (const u of (g.playerIds as string[] | undefined) ?? []) set.add(u);
      for (const u of (g.adminIds as string[] | undefined) ?? []) set.add(u);
    }
  } catch {
    /* best-effort */
  }
  return set;
}

// ── per-user activity timeline ─────────────────────────────────────
const CARD_REASON: Record<string, string> = {
  late: 'איחור',
  no_show: 'אי-הגעה',
  manual: 'ידני',
};

// Everything shown on ONE user's screen — fetched on demand, scoped tightly to
// that user (targeted equality/array-contains queries, never a full-collection
// scan). This is the only place we read a user's games/groups/feedback/errors.
export async function fetchUserActivity(userId: string): Promise<UserActivity> {
  if (!has.firebase()) {
    return {
      user: emptyUser(userId),
      referredNames: [],
      referralCount: 0,
      inviteClicks: 0,
      gamesCount: 0,
      communitiesCount: 0,
      timeline: [],
      errors: [],
    };
  }

  const [doc, gamesA, gamesB, groupsP, groupsA, feedbackAll, errorsAll, clicksDoc, referredDocs] =
    await Promise.all([
      getDoc(`users/${userId}`),
      queryArrayContains('games', 'participantIds', userId).catch(() => []),
      queryArrayContains('games', 'players', userId).catch(() => []),
      queryArrayContains('groups', 'playerIds', userId).catch(() => []),
      queryArrayContains('groups', 'adminIds', userId).catch(() => []),
      // Only THIS user's feedback / errors — not the whole collections.
      queryEquals('feedback', 'userId', userId).catch(() => [] as FsDoc[]),
      queryEquals('errors', 'lastUserId', userId).catch(() => [] as FsDoc[]),
      // Per-inviter clicks on the personal invite link (written by the
      // trackLinkClick CF when someone opens /app?invitedBy=<uid>).
      getDoc(`inviteClicks/${userId}`).catch(() => null),
      // Who this user invited — targeted query, not a scan of all users.
      queryEquals('users', 'invitedBy', userId).catch(() => [] as FsDoc[]),
    ]);

  // de-dupe games + groups by id
  const games = dedupe([...gamesA, ...gamesB]);
  const groups = dedupe([...groupsP, ...groupsA]);
  const user = doc ? mapUser(doc) : emptyUser(userId);
  const referred = referredDocs.map(mapUser);

  const timeline: TimelineEvent[] = [];
  timeline.push({ kind: 'joined', title: 'נרשם לאפליקציה', at: user.joinedAt });

  games.forEach((g) => {
    const isCreator = g.createdBy === userId;
    // When THIS user joined (uid→ms map written on registration). Creators
    // use the game's createdAt (they made it then). Joiners use their own
    // join time — falling back to createdAt for games joined before the
    // app started recording joinedAt (historical data has no join time).
    const joinedAt =
      g.joinedAt && typeof g.joinedAt === 'object'
        ? Number((g.joinedAt as Record<string, unknown>)[userId])
        : 0;
    const at = isCreator
      ? Number(g.createdAt ?? 0)
      : joinedAt || Number(g.createdAt ?? g.startsAt ?? 0);
    const isOrphan = g.isOrphanContext === true;
    timeline.push({
      kind: 'game',
      action: isCreator
        ? isOrphan
          ? 'יצר משחק חד פעמי'
          : 'יצר משחק'
        : isOrphan
          ? 'נרשם למשחק חד פעמי'
          : 'נרשם למשחק',
      title: g.title ?? 'משחק',
      subtitle: [g.city ?? g.fieldAddress, g.fieldName].filter(Boolean).join(' · ') || undefined,
      at,
      tone: isCreator ? 'green' : 'default',
    });
  });
  groups.forEach((gr) => {
    // Personal/hidden groups ("המשחקים של…") are auto-created behind a
    // quick (one-off) game — they're a system container, not a real
    // community the user deliberately created. Skip them; the quick GAME
    // itself already shows up with a clear "יצר משחק חד פעמי" action.
    if (gr.isPersonal === true || gr.hidden === true) return;
    const isCreator =
      gr.creatorId === userId || (gr.adminIds ?? [])[0] === userId;
    const isAdmin = (gr.adminIds ?? []).includes(userId);
    timeline.push({
      kind: 'community',
      action: isCreator ? 'יצר קהילה' : isAdmin ? 'מנהל בקהילה' : 'הצטרף לקהילה',
      title: gr.name ?? 'קבוצה',
      subtitle: gr.city ?? undefined,
      at: Number(gr.createdAt ?? 0),
      tone: isCreator ? 'green' : 'default',
    });
  });

  const unlocked = (doc?.achievements?.unlocked ?? []) as any[];
  unlocked.forEach((a) => {
    timeline.push({
      kind: 'achievement',
      title: 'הישג: ' + (a.id ?? ''),
      at: Number(a.unlockedAt ?? 0),
      tone: 'green',
    });
  });

  const cardEvents = (doc?.discipline?.events ?? []) as any[];
  cardEvents.forEach((e) => {
    const yellow = e.type === 'yellow';
    timeline.push({
      kind: 'card',
      title: (yellow ? '🟨 כרטיס צהוב' : '🟥 כרטיס אדום') +
        (e.reason ? ' · ' + (CARD_REASON[e.reason] ?? e.reason) : ''),
      at: Number(e.createdAt ?? 0),
      tone: yellow ? 'amber' : 'red',
    });
  });

  // bug reports & feature suggestions this user submitted
  feedbackAll
    .filter((f) => f.userId === userId)
    .forEach((f) => {
      const isBug = f.type !== 'suggestion';
      const msg = String(f.message ?? '').trim();
      timeline.push({
        kind: 'feedback',
        title: isBug ? '🐛 דיווח על תקלה' : '💡 הצעה לשיפור',
        subtitle: msg.length > 90 ? msg.slice(0, 90) + '…' : msg || undefined,
        at: Number(f.createdAt ?? 0),
        tone: isBug ? 'amber' : 'green',
      });
    });

  // who this user invited (from the targeted query above)
  referred.forEach((u) => {
    timeline.push({
      kind: 'invited',
      title: 'הזמין את ' + u.name,
      at: u.joinedAt,
      tone: 'green',
    });
  });

  // Crashes/errors attributed to this user (the doc's last occurrence was them,
  // or their uid is in the captured context). Shown in a SEPARATE section —
  // intentionally NOT mixed into the activity timeline.
  const userErrors = errorsAll
    .filter(
      (e) =>
        e.lastUserId === userId ||
        (e.lastContext as { userId?: string } | undefined)?.userId === userId,
    )
    .map((e) => ({
      id: e.id,
      title: (e.title as string) || (e.operation as string) || 'שגיאה',
      category: (e.category as string) || 'action',
      count: Number(e.count ?? 1),
      lastSeen: Number(e.lastSeen ?? 0),
      // Keep resolved/in-review bugs on the user's card with their status,
      // instead of them looking identical to open ones.
      status: ((e.status as string) || 'new') as 'new' | 'reviewed' | 'resolved',
    }))
    // Open issues first, resolved sink to the bottom; newest within each.
    .sort((a, b) => {
      const rank = (s: string) => (s === 'resolved' ? 1 : 0);
      if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
      return b.lastSeen - a.lastSeen;
    });

  // The inviter's name — one targeted doc read, only if this user was invited.
  let invitedByName: string | undefined;
  if (user.invitedBy) {
    const inv = await getDoc(`users/${user.invitedBy}`).catch(() => null);
    invitedByName = inv ? mapUser(inv).name : undefined;
  }

  return {
    user,
    invitedByName,
    referredNames: referred.map((u) => u.name),
    referralCount: referred.length,
    inviteClicks: clicksDoc ? Number((clicksDoc as { clicks?: number }).clicks ?? 0) : 0,
    gamesCount: games.length,
    communitiesCount: groups.length,
    timeline: timeline.filter((e) => e.at > 0).sort((a, b) => b.at - a.at),
    errors: userErrors,
  };
}

function dedupe(docs: FsDoc[]): FsDoc[] {
  const seen = new Set<string>();
  const out: FsDoc[] = [];
  for (const d of docs) {
    if (!seen.has(d.id)) {
      seen.add(d.id);
      out.push(d);
    }
  }
  return out;
}
