export type StoreSource = 'appstore' | 'googleplay';

export interface Review {
  id: string;
  source: StoreSource;
  rating: number; // 1..5
  title?: string;
  body: string;
  author: string;
  territory?: string;
  createdAt: string; // ISO
  version?: string;
}

export interface RatingSummary {
  source: StoreSource;
  average: number; // 0..5
  total: number; // number of ratings/reviews counted
  histogram: [number, number, number, number, number]; // counts for 1..5 stars
  approximate?: boolean; // true when derived from a limited sample
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

export interface RevenueSummary {
  currency: string;
  today: number;
  last7: number;
  last28: number;
  allTime: number; // total estimated earnings since launch (all-time)
  impressions7: number;
  ecpm7: number; // estimated eCPM over last 7d
  clicks7: number;
  ctr7: number; // 0..1 click-through rate over last 7d
  daily: DailyPoint[]; // earnings per day, last 28d
  adUnits: AdUnitStat[]; // per ad unit, last 28d (sorted by earnings)
  byCountry: NameCount[]; // earnings per country, last 28d (top)
}

export interface AnalyticsSummary {
  activeUsers7: number;
  newUsers7: number;
  sessions7: number;
  screenViews7: number;
  engagementRate7?: number; // 0..1
  installs30: number; // first_open events, last 30d (≈ new installs, incl. iOS)
  uninstalls30: number; // app_remove events, last 30d
  activeToday: number; // active users today
  installsTodayIos: number; // first_open today, iOS
  installsTodayAndroid: number; // first_open today, Android
  activeUsersDaily: DailyPoint[]; // last 28d
  byCountry: NameCount[];
  byDevice: NameCount[];
  topScreens: NameCount[];
  topEvents: NameCount[];
}

export interface SourceStatus {
  live: boolean; // true = real credentials present, false = mock
  ok: boolean; // last fetch succeeded
  error?: string;
}

// ── Firebase: app users + aggregate stats ──────────────────────────
export interface AppUser {
  id: string;
  name: string;
  email?: string;
  avatarId?: string;
  city?: string;
  joinedAt: number; // ms epoch
  totalGames: number;
  attended: number;
  cancelled: number;
  achievements: number;
  yellowCards: number;
  redCards: number;
  friends: number;
  gamesJoined: number; // games the user registered for (achievements.gamesJoined)
  communitiesCreated: number; // communities founded (achievements.teamsCreated)
  invitesSent: number; // invites the user sent (achievements.invitesSent)
  invitedBy?: string; // referrer user id
  hasPush: boolean; // has at least one fcm token
  onboardingCompleted?: boolean; // finished signup flow
  platform?: 'ios' | 'android' | string; // device OS (presence ping)
  acquisition?: { source?: string; campaign?: string; gameId?: string; linkId?: string; at?: number }; // UTM
  isTest: boolean; // heuristic: QA / robo / seeded account
  updatedAt?: number; // last doc write (ms) — ≈ deletion time for deleted accts
  deleted: boolean; // account self-deleted (anonymized, name = "משתמש שהוסר")
  qa?: boolean; // marked as QA tester — unlocks tester-only surfaces in the app
  // ── enriched from Firebase Auth (merged in fetchUsersWithAuth) ──
  provider?: 'google' | 'apple' | 'password' | 'other';
  lastLoginAt?: number; // ms epoch
  lastActiveAt?: number; // ms epoch (token refresh ≈ recent activity)
}

export interface NameCount {
  name: string;
  value: number;
}

export interface AppStats {
  totalUsers: number; // real users (test accounts excluded)
  testUsers: number; // how many test/QA accounts were filtered out
  newUsers7: number;
  newUsers30: number;
  totalGames: number;
  totalGroups: number;
  usersWithGames: number;
  usersNoGames: number;
  pushEnabled: number;
  joinedDaily: DailyPoint[]; // signups per day, last 30d
  byCity: NameCount[]; // users per city (top)
  referralLeaders: NameCount[]; // who invited the most (name → count)
  topPlayers: NameCount[]; // most games attended (name → attended)
  authProviders: NameCount[]; // sign-in method breakdown (Google / Apple / …)
}

// ── AdMob extras ───────────────────────────────────────────────────
export interface AdUnitStat {
  name: string;
  earnings: number;
  impressions: number;
  ecpm: number;
}

// ── Downloads / installs (App Store + Play) ────────────────────────
export interface StoreDownloads {
  total: number; // first-time downloads over the window
  windowDays: number;
  daily: DailyPoint[];
  byCountry: NameCount[];
}

export interface DownloadsSummary {
  ios: StoreDownloads | null;
  android: StoreDownloads | null;
}

// ── Error reports (from the Teamder app's errors collection) ───────
export type ErrorStatus = 'new' | 'reviewed' | 'resolved';

export interface ErrorRecord {
  id: string; // fingerprint
  operation: string;
  title?: string; // friendly Hebrew, written by the app
  category?: 'silent' | 'crash' | 'action' | 'report' | 'suggestion' | 'qa';
  coll?: 'errors' | 'feedback'; // which Firestore collection this came from
  count: number;
  status: ErrorStatus;
  firstSeen: number; // ms epoch
  lastSeen: number; // ms epoch
  message: string;
  code?: string;
  stack?: string;
  context: Record<string, unknown>;
  userId?: string;
  screen?: string;
  platform?: string;
  osVersion?: string;
  appVersion?: string;
}

// ── Per-user activity timeline (derived from Firestore) ────────────
export type TimelineKind =
  | 'joined'
  | 'game'
  | 'community'
  | 'achievement'
  | 'card'
  | 'invited'
  | 'feedback';

export interface TimelineEvent {
  kind: TimelineKind;
  action?: string; // what the user DID — "יצר משחק", "הצטרף לקהילה", ...
  title: string;
  subtitle?: string;
  at: number; // ms epoch
  tone?: 'default' | 'green' | 'amber' | 'red';
}

export interface UserErrorItem {
  id: string; // fingerprint
  title: string;
  category: string;
  count: number;
  lastSeen: number;
  status: 'new' | 'reviewed' | 'resolved';
}

export interface UserActivity {
  user: AppUser;
  invitedByName?: string;
  referredNames: string[]; // users this person invited
  referralCount: number; // how many registered through this user's link
  inviteClicks: number; // how many tapped this user's personal invite link
  gamesCount: number;
  communitiesCount: number;
  timeline: TimelineEvent[];
  errors: UserErrorItem[]; // crashes/errors attributed to this user (NOT in timeline)
}
