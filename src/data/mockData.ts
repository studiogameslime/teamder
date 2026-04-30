import { Game, Player } from '@/types';

// 25 mock players for a realistic community size. The first 15 are the same
// names used across earlier mocks so screenshots/demos stay consistent.
const HEBREW_NAMES = [
  'אלין',     'אלוואי',   'משה',     'נדב',     'אורי',
  'רון',      'דניאל',    'יוסי',    'תומר',    'עידו',
  'גל',       'בן',       'ליאור',   'נועם',    'איתן',
  'יואב',     'עמית',    'שחר',     'רועי',    'גיא',
  'אסף',      'ערן',     'דוד',     'אריאל',   'ניר',
];

function avatar(seed: string) {
  return `https://api.dicebear.com/7.x/avataaars/png?seed=${encodeURIComponent(seed)}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;
}

export const mockPlayers: Player[] = HEBREW_NAMES.map((name, i) => ({
  id: `p${i + 1}`,
  displayName: name,
  avatarUrl: avatar(`footy-${i + 1}-${name}`),
  stats: {
    gamesPlayed: 30 + Math.floor(Math.random() * 20),
    wins: 15 + Math.floor(Math.random() * 15),
    losses: 5 + Math.floor(Math.random() * 10),
    ties: Math.floor(Math.random() * 5),
    attendancePct: 75 + Math.floor(Math.random() * 25),
    cancelRate: Math.floor(Math.random() * 20),
  },
}));

// Active mock game night. Filled to 15/15 so live-match demos show three
// fully-populated 5-player teams (5v5 × 3) without needing to shuffle.
export const mockGame: Game = {
  id: 'game-1',
  groupId: 'g1',
  title: 'חמישי כדורגל',
  startsAt: nextThursdayAt(20, 0),
  fieldName: 'המגרש הקבוע',
  fieldLat: 32.0853,
  fieldLng: 34.7818,
  maxPlayers: 15,
  minPlayers: 10,

  players: mockPlayers.slice(0, 15).map((p) => p.id),
  waitlist:   mockPlayers.slice(15, 18).map((p) => p.id),
  pending: [],
  participantIds: unionIds(mockPlayers.slice(0, 15).map((p) => p.id), mockPlayers.slice(15, 18).map((p) => p.id), []),
  ballHolderUserId:    mockPlayers[2].id, // משה
  jerseysHolderUserId: mockPlayers[3].id, // נדב

  status: 'open',
  locked: false,
  currentMatchIndex: 0,
  matches: [],
  weather: { tempC: 22, rainProb: 20 },

  createdBy: mockPlayers[6].id, // דניאל = mockCurrentUser
  isPublic: false,
  requiresApproval: false,
  format: '5v5',
  numberOfTeams: 3,
  fieldType: 'synthetic',
  matchDurationMinutes: 90,
  cancelDeadlineHours: 12,
  bringBall: true,
  bringShirts: true,
  notes: undefined,

  createdAt: Date.now() - 1000 * 60 * 60 * 24,
};

function nextThursdayAt(hour: number, minute: number): number {
  const d = new Date();
  const day = d.getDay();
  const delta = (4 - day + 7) % 7 || 7; // Thursday = 4
  d.setDate(d.getDate() + delta);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

function inDays(n: number, hour = 20, minute = 0): number {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

function daysAgo(n: number, hour = 20, minute = 0): number {
  return inDays(-n, hour, minute);
}

function unionIds(...lists: string[][]): string[] {
  return Array.from(new Set(lists.flat()));
}

// ─── v2 mock games ────────────────────────────────────────────────────────
// Variety pack so the new Games tab has data to render across all three
// sections (My / From My Communities / Open). The "current user" is
// daniel = mockPlayers[6].

const ME = mockPlayers[6].id;

export const mockGamesV2: Game[] = [
  // 1. My Game — already registered, full 15/15 so the live match
  //    screen renders three full teams without a shuffle.
  {
    id: 'gv2-1',
    groupId: 'g1',
    title: 'חמישי כדורגל',
    startsAt: nextThursdayAt(20, 0),
    fieldName: 'המגרש הקבוע',
    fieldLat: 32.0853,
    fieldLng: 34.7818,
    maxPlayers: 15,
    minPlayers: 10,
    players: mockPlayers.slice(0, 15).map((p) => p.id), // includes ME
    waitlist: [],
    pending: [],
    participantIds: unionIds(mockPlayers.slice(0, 15).map((p) => p.id), [], []),
    ballHolderUserId: mockPlayers[2].id,
    jerseysHolderUserId: mockPlayers[3].id,
    status: 'open',
    locked: false,
    currentMatchIndex: 0,
    matches: [],
    weather: { tempC: 23, rainProb: 10 },
    createdBy: mockPlayers[0].id,
    isPublic: false,
    requiresApproval: false,
    format: '5v5',
    numberOfTeams: 3,
    fieldType: 'synthetic',
    matchDurationMinutes: 90,
    cancelDeadlineHours: 12,
    bringBall: true,
    bringShirts: true,
    notes: 'נא להגיע 10 דק׳ מראש לחימום',
    createdAt: Date.now() - 1000 * 60 * 60 * 48,
  },
  // 2. From My Community — not yet joined, has open spots
  {
    id: 'gv2-2',
    groupId: 'g1',
    title: 'חמישי כדורגל',
    startsAt: inDays(10, 20, 0),
    fieldName: 'המגרש הקבוע',
    fieldLat: 32.0853,
    fieldLng: 34.7818,
    maxPlayers: 15,
    minPlayers: 10,
    players: mockPlayers.slice(7, 14).map((p) => p.id), // 7 of 15
    waitlist: [],
    pending: [],
    participantIds: unionIds(mockPlayers.slice(7, 14).map((p) => p.id), [], []),
    status: 'open',
    locked: false,
    currentMatchIndex: 0,
    matches: [],
    weather: { tempC: 21, rainProb: 30 },
    createdBy: mockPlayers[0].id,
    isPublic: false,
    requiresApproval: false,
    format: '5v5',
    numberOfTeams: 3,
    fieldType: 'synthetic',
    matchDurationMinutes: 90,
    cancelDeadlineHours: 12,
    bringBall: false,
    bringShirts: false,
    createdAt: Date.now() - 1000 * 60 * 60 * 6,
  },
  // 3. Open Game — public, in different city, requires approval
  {
    id: 'gv2-3',
    groupId: 'pub_3',
    title: 'שישי בוקר חיפה',
    startsAt: inDays(2, 7, 30),
    fieldName: 'גרין הוקי',
    fieldLat: 32.7940,
    fieldLng: 34.9896,
    maxPlayers: 12,
    minPlayers: 8,
    players: mockPlayers.slice(15, 25).map((p) => p.id), // 10 of 12
    waitlist: [],
    pending: [],
    participantIds: unionIds(mockPlayers.slice(15, 25).map((p) => p.id), [], []),
    status: 'open',
    locked: false,
    currentMatchIndex: 0,
    matches: [],
    weather: { tempC: 19, rainProb: 15 },
    createdBy: mockPlayers[15].id,
    isPublic: true,
    requiresApproval: true,
    format: '6v6',
    numberOfTeams: 2,
    fieldType: 'synthetic',
    matchDurationMinutes: 75,
    cancelDeadlineHours: 6,
    bringBall: true,
    bringShirts: false,
    notes: 'מגרש דשא סינטטי, חניה ברחוב',
    createdAt: Date.now() - 1000 * 60 * 60 * 12,
  },
  // 4. Open Game — public, full + waitlist active
  {
    id: 'gv2-4',
    groupId: 'pub_4',
    title: 'רביעי בלילה ירושלים',
    startsAt: inDays(5, 21, 0),
    fieldName: 'מגרש קלרמונט',
    fieldLat: 31.7683,
    fieldLng: 35.2137,
    maxPlayers: 14,
    minPlayers: 10,
    players: mockPlayers.slice(0, 14).filter((p) => p.id !== ME).map((p) => p.id),
    waitlist: [mockPlayers[20].id, mockPlayers[21].id],
    pending: [],
    participantIds: unionIds(
      mockPlayers.slice(0, 14).filter((p) => p.id !== ME).map((p) => p.id),
      [mockPlayers[20].id, mockPlayers[21].id],
      [],
    ),
    status: 'open',
    locked: false,
    currentMatchIndex: 0,
    matches: [],
    weather: { tempC: 16, rainProb: 50 },
    createdBy: mockPlayers[19].id,
    isPublic: true,
    requiresApproval: false,
    format: '7v7',
    numberOfTeams: 2,
    fieldType: 'asphalt',
    matchDurationMinutes: 90,
    cancelDeadlineHours: 8,
    bringBall: true,
    bringShirts: true,
    createdAt: Date.now() - 1000 * 60 * 60 * 18,
  },
  // 5. My Game — currently on the waitlist (overflow)
  {
    id: 'gv2-5',
    groupId: 'g1',
    title: 'חמישי כדורגל',
    startsAt: inDays(17, 20, 0),
    fieldName: 'המגרש הקבוע',
    fieldLat: 32.0853,
    fieldLng: 34.7818,
    maxPlayers: 15,
    minPlayers: 10,
    players: mockPlayers.slice(0, 15).filter((p) => p.id !== ME).map((p) => p.id),
    waitlist: [ME],
    pending: [],
    participantIds: unionIds(
      mockPlayers.slice(0, 15).filter((p) => p.id !== ME).map((p) => p.id),
      [ME],
      [],
    ),
    status: 'open',
    locked: false,
    currentMatchIndex: 0,
    matches: [],
    weather: { tempC: 24, rainProb: 5 },
    createdBy: mockPlayers[0].id,
    isPublic: false,
    requiresApproval: false,
    format: '5v5',
    numberOfTeams: 3,
    fieldType: 'synthetic',
    matchDurationMinutes: 90,
    cancelDeadlineHours: 12,
    bringBall: false,
    bringShirts: true,
    createdAt: Date.now() - 1000 * 60 * 60 * 2,
  },
  // 6. My community, larger format. 7v7 × 3 teams = 21 max, mid-fill so
  //    the cards "still need players" CTA is visible somewhere.
  {
    id: 'gv2-6',
    groupId: 'g1',
    title: 'שבת אחה״צ — פלייאוף',
    startsAt: inDays(3, 17, 0),
    fieldName: 'המגרש הקבוע',
    fieldLat: 32.0853,
    fieldLng: 34.7818,
    maxPlayers: 21,
    minPlayers: 14,
    players: mockPlayers.slice(0, 13).map((p) => p.id), // 13 of 21, includes ME
    waitlist: [],
    pending: [],
    participantIds: unionIds(mockPlayers.slice(0, 13).map((p) => p.id), [], []),
    ballHolderUserId: mockPlayers[4].id,
    status: 'open',
    locked: false,
    currentMatchIndex: 0,
    matches: [],
    weather: { tempC: 26, rainProb: 0 },
    createdBy: mockPlayers[6].id, // ME organizes
    isPublic: false,
    requiresApproval: false,
    format: '7v7',
    numberOfTeams: 3,
    fieldType: 'grass',
    matchDurationMinutes: 105,
    cancelDeadlineHours: 24,
    bringBall: true,
    bringShirts: true,
    notes: 'טורניר בין-קבוצתי, 3 קבוצות במחזור',
    createdAt: Date.now() - 1000 * 60 * 60 * 4,
  },
  // 7. Recently finished community game — populates the "history" feel
  //    when the user scrolls past upcoming.
  {
    id: 'gv2-7',
    groupId: 'g1',
    title: 'חמישי כדורגל',
    startsAt: daysAgo(2, 20, 0),
    fieldName: 'המגרש הקבוע',
    fieldLat: 32.0853,
    fieldLng: 34.7818,
    maxPlayers: 15,
    minPlayers: 10,
    players: mockPlayers.slice(0, 15).map((p) => p.id),
    waitlist: [],
    pending: [],
    participantIds: unionIds(mockPlayers.slice(0, 15).map((p) => p.id), [], []),
    ballHolderUserId: mockPlayers[2].id,
    jerseysHolderUserId: mockPlayers[3].id,
    status: 'finished',
    locked: true,
    currentMatchIndex: 0,
    matches: [],
    weather: { tempC: 22, rainProb: 0 },
    createdBy: mockPlayers[0].id,
    isPublic: false,
    requiresApproval: false,
    format: '5v5',
    numberOfTeams: 3,
    fieldType: 'synthetic',
    matchDurationMinutes: 90,
    cancelDeadlineHours: 12,
    bringBall: true,
    bringShirts: true,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 4,
  },
  // 8. Brand-new public game with low signup so the Open Games section
  //    has a "join early" feel. Different city again.
  {
    id: 'gv2-8',
    groupId: 'pub_5',
    title: 'באר שבע יום שני',
    startsAt: inDays(4, 19, 30),
    fieldName: 'מגרש קמפוס',
    fieldLat: 31.2620,
    fieldLng: 34.8005,
    maxPlayers: 10,
    minPlayers: 8,
    players: mockPlayers.slice(20, 23).map((p) => p.id), // 3 of 10
    waitlist: [],
    pending: [],
    participantIds: unionIds(mockPlayers.slice(20, 23).map((p) => p.id), [], []),
    status: 'open',
    locked: false,
    currentMatchIndex: 0,
    matches: [],
    weather: { tempC: 28, rainProb: 0 },
    createdBy: mockPlayers[22].id,
    isPublic: true,
    requiresApproval: false,
    format: '5v5',
    numberOfTeams: 2,
    fieldType: 'asphalt',
    matchDurationMinutes: 60,
    cancelDeadlineHours: 4,
    bringBall: false,
    bringShirts: false,
    notes: 'מגרש פתוח, מים מהברזייה ליד',
    createdAt: Date.now() - 1000 * 60 * 60 * 1,
  },
  // 9. My community, a second weekly cadence — 6v6 × 3 teams = 18.
  //    Fills the "next week" calendar slot.
  {
    id: 'gv2-9',
    groupId: 'g1',
    title: 'שני בערב',
    startsAt: inDays(7, 21, 0),
    fieldName: 'המגרש הקבוע',
    fieldLat: 32.0853,
    fieldLng: 34.7818,
    maxPlayers: 18,
    minPlayers: 12,
    players: mockPlayers.slice(0, 16).map((p) => p.id), // 16 of 18, includes ME
    waitlist: [],
    pending: [],
    participantIds: unionIds(mockPlayers.slice(0, 16).map((p) => p.id), [], []),
    ballHolderUserId: mockPlayers[5].id,
    jerseysHolderUserId: mockPlayers[1].id,
    status: 'open',
    locked: false,
    currentMatchIndex: 0,
    matches: [],
    weather: { tempC: 20, rainProb: 25 },
    createdBy: mockPlayers[0].id,
    isPublic: false,
    requiresApproval: false,
    format: '6v6',
    numberOfTeams: 3,
    fieldType: 'synthetic',
    matchDurationMinutes: 90,
    cancelDeadlineHours: 12,
    bringBall: true,
    bringShirts: true,
    createdAt: Date.now() - 1000 * 60 * 60 * 30,
  },
];
