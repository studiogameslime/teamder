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

// Active mock game night. Registered = 12 of the community; waitlist = 3.
// (The community itself has 25 members — see mockGroup in mockUsers.ts.)
export const mockGame: Game = {
  id: 'game-1',
  groupId: 'g1',
  title: 'חמישי כדורגל',
  startsAt: nextThursdayAt(20, 0),
  fieldName: 'המגרש הקבוע',
  fieldLat: 32.0853,
  fieldLng: 34.7818,
  maxPlayers: 15,

  players: mockPlayers.slice(0, 12).map((p) => p.id),
  waitlist:   mockPlayers.slice(12, 15).map((p) => p.id),
  pending: [],
    participantIds: unionIds(mockPlayers.slice(0, 12).map((p) => p.id), mockPlayers.slice(12, 15).map((p) => p.id), []),
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

function unionIds(...lists: string[][]): string[] {
  return Array.from(new Set(lists.flat()));
}

// ─── v2 mock games ────────────────────────────────────────────────────────
// Variety pack so the new Games tab has data to render across all three
// sections (My / From My Communities / Open). The "current user" is
// daniel = mockPlayers[6].

const ME = mockPlayers[6].id;

export const mockGamesV2: Game[] = [
  // 1. My Game — already registered (status: in players[])
  {
    id: 'gv2-1',
    groupId: 'g1',
    title: 'חמישי כדורגל',
    startsAt: nextThursdayAt(20, 0),
    fieldName: 'המגרש הקבוע',
    maxPlayers: 15,
    players: mockPlayers.slice(0, 12).map((p) => p.id), // includes ME (index 6)
    waitlist: [],
    pending: [],
    status: 'open',
    locked: false,
    currentMatchIndex: 0,
    matches: [],
    createdBy: mockPlayers[0].id,
    isPublic: false,
    requiresApproval: false,
    format: '5v5',
    bringBall: true,
    bringShirts: true,
    createdAt: Date.now() - 1000 * 60 * 60 * 48,
  },
  // 2. From My Community — not yet joined, has open spots
  {
    id: 'gv2-2',
    groupId: 'g1',
    title: 'חמישי כדורגל',
    startsAt: inDays(10, 20, 0),
    fieldName: 'המגרש הקבוע',
    maxPlayers: 15,
    players: mockPlayers.slice(7, 14).map((p) => p.id), // 7 players, 8 spots left
    waitlist: [],
    pending: [],
    status: 'open',
    locked: false,
    currentMatchIndex: 0,
    matches: [],
    createdBy: mockPlayers[0].id,
    isPublic: false,
    requiresApproval: false,
    format: '5v5',
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
    maxPlayers: 12,
    players: mockPlayers.slice(15, 25).map((p) => p.id), // 10 players, 2 spots
    waitlist: [],
    pending: [],
    status: 'open',
    locked: false,
    currentMatchIndex: 0,
    matches: [],
    createdBy: mockPlayers[15].id,
    isPublic: true,
    requiresApproval: true,
    format: '6v6',
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
    maxPlayers: 14,
    players: mockPlayers.slice(0, 14).filter((p) => p.id !== ME).map((p) => p.id),
    waitlist: [mockPlayers[20].id, mockPlayers[21].id],
    pending: [],
    participantIds: unionIds(mockPlayers.slice(0, 14).filter((p) => p.id !== ME).map((p) => p.id), [mockPlayers[20].id, mockPlayers[21].id], []),
    status: 'open',
    locked: false,
    currentMatchIndex: 0,
    matches: [],
    createdBy: mockPlayers[19].id,
    isPublic: true,
    requiresApproval: false,
    format: '7v7',
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
    maxPlayers: 15,
    players: mockPlayers.slice(0, 15).filter((p) => p.id !== ME).map((p) => p.id),
    waitlist: [ME],
    pending: [],
    participantIds: unionIds(mockPlayers.slice(0, 15).filter((p) => p.id !== ME).map((p) => p.id), [ME], []),
    status: 'open',
    locked: false,
    currentMatchIndex: 0,
    matches: [],
    createdBy: mockPlayers[0].id,
    isPublic: false,
    requiresApproval: false,
    format: '5v5',
    bringBall: false,
    bringShirts: true,
    createdAt: Date.now() - 1000 * 60 * 60 * 2,
  },
];
