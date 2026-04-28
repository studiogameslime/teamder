import { GameSummary, Group, GroupPublic, User } from '@/types';
import { mockPlayers } from './mockData';

// The current logged-in user (mock mode). The id matches mockPlayers[6] so
// stats/history line up with the existing player object.
export const mockCurrentUser: User = {
  id: mockPlayers[6].id, // "דניאל"
  name: mockPlayers[6].displayName,
  email: 'daniel@example.com',
  avatarId: 'a13', // built-in avatar
  createdAt: Date.now() - 1000 * 60 * 60 * 24 * 90,
  onboardingCompleted: true,
  availability: {
    preferredDays: [4], // Thursday
    timeFrom: '20:00',
    timeTo: '22:00',
    preferredCity: 'תל אביב',
    isAvailableForInvites: true,
  },
  stats: {
    totalGames: 26,
    attended: 24,
    cancelled: 2,
  },
};

// One group seeded as a real ~25-person community. The current user is
// admin AND a community member; 2 outsiders are pending admission.
export const mockGroup: Group = {
  id: 'g1',
  name: 'חמישי כדורגל',
  normalizedName: 'חמישי כדורגל'.trim().toLowerCase(),
  fieldName: 'המגרש הקבוע',
  fieldAddress: 'רחוב הספורט 12, תל אביב',
  city: 'תל אביב',
  description: 'קבוצה ותיקה, שחקנים קבועים, אווירה משפחתית',
  lat: 32.0853,
  lng: 34.7818,
  adminIds: [mockCurrentUser.id],
  playerIds: mockPlayers.slice(0, 23).map((p) => p.id),
  pendingPlayerIds: mockPlayers.slice(23, 25).map((p) => p.id),
  inviteCode: 'ELIN10',
  defaultMaxPlayers: 15,
  isOpen: false,           // admin-approval flow
  maxMembers: 40,
  contactPhone: '+972501234567',
  skillLevel: 'mixed',
  preferredDays: [4],
  preferredHour: '20:00',
  costPerGame: 25,
  notes: 'מים ומגבת אישית. נוהג להגיע 10 דקות מראש לחימום.',
  createdAt: Date.now() - 1000 * 60 * 60 * 24 * 30,
  updatedAt: Date.now() - 1000 * 60 * 60 * 24,
};

// A second mock group so the search screen has more than one result in dev.
export const mockOtherGroup: Group = {
  id: 'g2',
  name: 'שישי בוקר',
  normalizedName: 'שישי בוקר'.trim().toLowerCase(),
  fieldName: 'בית ספר אורט',
  fieldAddress: 'רמת גן',
  city: 'רמת גן',
  adminIds: ['someone-else'],
  playerIds: Array.from({ length: 18 }, (_, i) => `external_${i}`),
  pendingPlayerIds: [],
  inviteCode: 'OTHER1',
  isOpen: true,            // auto-join community
  maxMembers: 30,
  skillLevel: 'intermediate',
  preferredDays: [5],
  preferredHour: '07:00',
  costPerGame: 0,
  createdAt: Date.now() - 1000 * 60 * 60 * 24 * 60,
};

// Public groups feed seed — 5+ groups in varied states relative to the
// mock current user (already-member / pending / open-for-request).
// `mockPublicGroups` is mutable on purpose: createGroup pushes to it so the
// feed reflects newly-created groups during the same session.
export const mockPublicGroups: GroupPublic[] = [
  // 0: user is already a member (mirror of mockGroup)
  {
    id: mockGroup.id,
    name: mockGroup.name,
    normalizedName: mockGroup.normalizedName,
    fieldName: mockGroup.fieldName,
    fieldAddress: mockGroup.fieldAddress,
    city: mockGroup.city,
    description: mockGroup.description,
    memberCount: mockGroup.playerIds.length,
    createdAt: mockGroup.createdAt,
    updatedAt: mockGroup.updatedAt,
  },
  // 1: user has a pending request (so the feed renders "ממתין לאישור")
  {
    id: 'pub_2',
    name: 'שלישי ספורטק',
    normalizedName: 'שלישי ספורטק',
    fieldName: 'ספורטק רעננה',
    fieldAddress: 'רעננה',
    city: 'רעננה',
    description: 'משחק רציני, רמה גבוהה',
    memberCount: 32,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 14,
  },
  // 2-4: open for join request
  {
    id: 'pub_3',
    name: 'שישי בוקר חיפה',
    normalizedName: 'שישי בוקר חיפה',
    fieldName: 'גרין הוקי',
    fieldAddress: 'חיפה',
    city: 'חיפה',
    description: 'מתחילים מ-7 בבוקר, בלי מתחים',
    memberCount: 24,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 100,
  },
  {
    id: 'pub_4',
    name: 'רביעי בלילה ירושלים',
    normalizedName: 'רביעי בלילה ירושלים',
    fieldName: 'מגרש קלרמונט',
    fieldAddress: 'ירושלים',
    city: 'ירושלים',
    description: 'מגרש מקורה, גם בחורף',
    memberCount: 28,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 220,
  },
  {
    id: 'pub_5',
    name: 'באר שבע יום שני',
    normalizedName: 'באר שבע יום שני',
    fieldName: 'אצטדיון רוגוזין',
    fieldAddress: 'באר שבע',
    city: 'באר שבע',
    memberCount: 19,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 50,
  },
  // 5: identical second-group mirror so search has multiple test cases
  {
    id: mockOtherGroup.id,
    name: mockOtherGroup.name,
    normalizedName: mockOtherGroup.normalizedName,
    fieldName: mockOtherGroup.fieldName,
    fieldAddress: mockOtherGroup.fieldAddress,
    city: mockOtherGroup.city,
    memberCount: mockOtherGroup.playerIds.length,
    createdAt: mockOtherGroup.createdAt,
  },
];

export const mockHistory: GameSummary[] = [
  {
    id: 'gn-1',
    groupId: mockGroup.id,
    date: daysAgo(7),
    matchCount: 6,
    lastResult: { teamA: 'team1', teamB: 'team2', winner: 'team1' },
  },
  {
    id: 'gn-2',
    groupId: mockGroup.id,
    date: daysAgo(14),
    matchCount: 5,
    lastResult: { teamA: 'team2', teamB: 'team3', winner: 'team2' },
  },
  {
    id: 'gn-3',
    groupId: mockGroup.id,
    date: daysAgo(21),
    matchCount: 6,
    lastResult: { teamA: 'team1', teamB: 'team3', winner: 'tie' },
  },
  {
    id: 'gn-4',
    groupId: mockGroup.id,
    date: daysAgo(28),
    matchCount: 5,
    lastResult: { teamA: 'team1', teamB: 'team2', winner: 'team2' },
  },
];

function daysAgo(n: number): number {
  return Date.now() - n * 24 * 60 * 60 * 1000;
}
