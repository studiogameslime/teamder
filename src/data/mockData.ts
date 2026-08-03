import { Game, Player } from '@/types';
import type { RoundHistoryDoc } from '@/utils/eveningStats';

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
  visibility: 'community' as const,
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
  // 0a. DEMO — advanced live match mid-round. Seeds an active rotation with a
  //     goal log (incl. an assist), a "went home" player with a timestamp, and
  //     a win streak, so the live scoreboard + rotation panel render fully for
  //     fix-verification screenshots.
  {
    id: 'gv2-live',
    groupId: 'g1',
    title: 'ליגת השכונה',
    startsAt: Date.now() - 1000 * 60 * 20,
    fieldName: 'מגרש סינטטי · גני תקווה',
    fieldLat: 32.0853,
    fieldLng: 34.7818,
    maxPlayers: 10,
    minPlayers: 8,
    players: mockPlayers.slice(0, 10).map((p) => p.id), // p1..p10, ME=p7 included
    waitlist: [],
    pending: [],
    participantIds: unionIds(mockPlayers.slice(0, 10).map((p) => p.id), [], []),
    ballHolderUserId: mockPlayers[2].id,
    jerseysHolderUserId: mockPlayers[3].id,
    status: 'open',
    locked: false,
    currentMatchIndex: 0,
    matches: [],
    weather: { tempC: 23, rainProb: 10 },
    createdBy: mockPlayers[6].id, // ME organizes → admin can enter live
    visibility: 'community' as const,
    requiresApproval: false,
    format: '5v5',
    numberOfTeams: 2,
    fieldType: 'synthetic',
    // 15-min round (not 8) so the live count-up clock keeps showing a clean
    // value like 03:12 well past launch instead of slipping into red "+overtime"
    // while footage is being captured.
    matchDurationMinutes: 15,
    cancelDeadlineHours: 12,
    bringBall: true,
    bringShirts: true,
    createdAt: Date.now() - 1000 * 60 * 60 * 4,
    advancedMode: true,
    draftTeams: {
      method: 'snake',
      numTeams: 2,
      createdAt: Date.now() - 1000 * 60 * 30,
      createdBy: mockPlayers[6].id,
      teams: [
        { index: 0, captainId: 'p1', playerIds: ['p1', 'p2', 'p3', 'p4', 'p5'] },
        { index: 1, captainId: 'p6', playerIds: ['p6', 'p7', 'p8', 'p9', 'p10'] },
      ],
      // אורי (p5) הלך הביתה מקבוצה א' לפני 12 דק׳ — מוצג עם השעה בפאנל.
      leftHome: [{ playerId: 'p5', homeTeam: 0, at: Date.now() - 1000 * 60 * 12 }],
    },
    rotation: {
      playing: [0, 1],
      waiting: [],
      loans: [],
      wins: { '0': 2, '1': 1 }, // קבוצה א' ברצף 2 נצחונות (streak pill)
      round: 2,
      updatedAt: Date.now() - 1000 * 60 * 3,
    },
    liveMatch: {
      phase: 'roundRunning',
      startedAt: Date.now() - 1000 * 60 * 25,
      assignments: {
        p1: 'teamA', p2: 'teamA', p3: 'teamA', p4: 'teamA',
        p6: 'teamB', p7: 'teamB', p8: 'teamB', p9: 'teamB', p10: 'teamB',
      },
      benchOrder: [],
      scoreA: 2,
      scoreB: 1,
      goals: [
        { id: 'mg1', team: 'A', scorerId: 'p1', assisterId: 'p2', minute: 4, at: Date.now() - 1000 * 60 * 6 },
        { id: 'mg2', team: 'B', scorerId: 'p6', assisterId: null, minute: 11, at: Date.now() - 1000 * 60 * 4 },
        { id: 'mg3', team: 'A', scorerId: 'p3', assisterId: 'p1', minute: 18, at: Date.now() - 1000 * 60 * 2 },
      ],
      winsByTeam: { A: 2, B: 1 },
      roundNumber: 2,
      timerRunning: true,
      // clean, realistic running clock: 02:34 and counting up
      timerLastStartedAt: Date.now() - (1000 * 60 * 2 + 1000 * 34),
      timerAccumulatedMs: 0,
    },
  },
  // 0a2. DEMO — advanced 5v5 with THREE full teams (15 players): teams 0+1 play,
  //      team 2 (ירוקה) waits in full. A mid-match "went home" now has a real
  //      donor → the replacement picker opens instead of the team playing short.
  {
    id: 'gv2-live3',
    groupId: 'g1',
    title: 'ליגת השכונה · 3 קבוצות',
    startsAt: Date.now() - 1000 * 60 * 20,
    fieldName: 'מגרש סינטטי · גני תקווה',
    fieldLat: 32.0853,
    fieldLng: 34.7818,
    maxPlayers: 15,
    minPlayers: 12,
    players: mockPlayers.slice(0, 15).map((p) => p.id),
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
    createdBy: mockPlayers[6].id, // ME (דניאל) → admin can enter live
    visibility: 'community' as const,
    requiresApproval: false,
    format: '5v5',
    numberOfTeams: 3,
    fieldType: 'synthetic',
    matchDurationMinutes: 15,
    cancelDeadlineHours: 12,
    bringBall: true,
    bringShirts: true,
    createdAt: Date.now() - 1000 * 60 * 60 * 4,
    advancedMode: true,
    draftTeams: {
      method: 'snake',
      numTeams: 3,
      createdAt: Date.now() - 1000 * 60 * 30,
      createdBy: mockPlayers[6].id,
      teams: [
        { index: 0, captainId: mockPlayers[0].id, playerIds: [0, 1, 2, 3, 4].map((i) => mockPlayers[i].id) },
        { index: 1, captainId: mockPlayers[5].id, playerIds: [5, 6, 7, 8, 9].map((i) => mockPlayers[i].id) },
        { index: 2, captainId: mockPlayers[10].id, playerIds: [10, 11, 12, 13, 14].map((i) => mockPlayers[i].id) },
      ],
    },
    rotation: {
      playing: [0, 1],
      waiting: [2],
      loans: [],
      wins: { '0': 1, '1': 1 },
      round: 2,
      updatedAt: Date.now() - 1000 * 60 * 3,
    },
    liveMatch: {
      phase: 'roundRunning',
      startedAt: Date.now() - 1000 * 60 * 25,
      assignments: {
        [mockPlayers[0].id]: 'teamA', [mockPlayers[1].id]: 'teamA', [mockPlayers[2].id]: 'teamA',
        [mockPlayers[3].id]: 'teamA', [mockPlayers[4].id]: 'teamA',
        [mockPlayers[5].id]: 'teamB', [mockPlayers[6].id]: 'teamB', [mockPlayers[7].id]: 'teamB',
        [mockPlayers[8].id]: 'teamB', [mockPlayers[9].id]: 'teamB',
      },
      benchOrder: [],
      scoreA: 1,
      scoreB: 1,
      goals: [
        { id: 'm3g1', team: 'A', scorerId: mockPlayers[0].id, assisterId: mockPlayers[1].id, minute: 5, at: Date.now() - 1000 * 60 * 5 },
        { id: 'm3g2', team: 'B', scorerId: mockPlayers[5].id, assisterId: null, minute: 9, at: Date.now() - 1000 * 60 * 3 },
      ],
      winsByTeam: { A: 1, B: 1 },
      roundNumber: 2,
      timerRunning: true,
      timerLastStartedAt: Date.now() - (1000 * 60 * 2 + 1000 * 10),
      timerAccumulatedMs: 0,
    },
  },
  // 0b. DEMO — advanced timer-only game that already has a score but the clock
  //     was reset to 00:00 (the "reset keeps goals" fix). Re-entering shows the
  //     CTA as "המשך משחק" instead of "התחל" (continue-vs-start fix).
  {
    id: 'gv2-resume',
    groupId: 'g1',
    title: 'כדורגל רביעי',
    startsAt: Date.now() - 1000 * 60 * 40,
    fieldName: 'מגרש קהילתי · רמת גן',
    fieldLat: 32.0853,
    fieldLng: 34.7818,
    maxPlayers: 10,
    minPlayers: 8,
    players: mockPlayers.slice(0, 10).map((p) => p.id),
    waitlist: [],
    pending: [],
    participantIds: unionIds(mockPlayers.slice(0, 10).map((p) => p.id), [], []),
    ballHolderUserId: mockPlayers[2].id,
    jerseysHolderUserId: mockPlayers[3].id,
    status: 'open',
    locked: false,
    currentMatchIndex: 0,
    matches: [],
    weather: { tempC: 23, rainProb: 10 },
    createdBy: mockPlayers[6].id,
    visibility: 'community' as const,
    requiresApproval: false,
    format: '5v5',
    numberOfTeams: 2,
    fieldType: 'synthetic',
    matchDurationMinutes: 8,
    cancelDeadlineHours: 12,
    bringBall: true,
    bringShirts: true,
    createdAt: Date.now() - 1000 * 60 * 60 * 4,
    advancedMode: true,
    liveMatch: {
      phase: 'roundEnded',
      startedAt: Date.now() - 1000 * 60 * 50,
      assignments: {},
      benchOrder: [],
      scoreA: 3,
      scoreB: 2,
      goals: [],
      timerRunning: false,
      timerLastStartedAt: null,
      timerAccumulatedMs: 0, // reset to 00:00 → started=false → "המשך משחק"
    },
  },
  // 1. My Game — already registered, full 15/15 so the live match
  //    screen renders three full teams without a shuffle. Scheduled a couple
  //    of weeks out so it doesn't time-clash with the joinable gv2-2 (which
  //    is THIS Thursday) — keeps the "אני מגיע" hero join free of an
  //    overlap-warning popup.
  {
    id: 'gv2-1',
    groupId: 'g1',
    title: 'חמישי כדורגל',
    startsAt: inDays(13, 20, 0),
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
    visibility: 'community' as const,
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
    // 3-team split — for previewing the כוחות editor with three columns.
    draftTeams: {
      method: 'snake' as const,
      numTeams: 3,
      createdAt: Date.now() - 1000 * 60 * 25,
      createdBy: ME,
      teams: [
        {
          index: 0,
          captainId: mockPlayers[0].id,
          playerIds: [0, 1, 2, 3, 4].map((i) => mockPlayers[i].id),
        },
        {
          index: 1,
          captainId: mockPlayers[5].id,
          playerIds: [5, 6, 7, 8, 9].map((i) => mockPlayers[i].id),
        },
        {
          index: 2,
          captainId: mockPlayers[10].id,
          playerIds: [10, 11, 12, 13, 14].map((i) => mockPlayers[i].id),
        },
      ],
    },
  },
  // 2. From My Community — not yet joined, almost full (14/16). This is the
  //    promo "hero" game: this Thursday, ME not registered → card shows the
  //    "אני מגיע" join CTA, and joining takes it 14→15.
  {
    id: 'gv2-2',
    groupId: 'g1',
    title: 'חמישי כדורגל',
    startsAt: nextThursdayAt(20, 0),
    fieldName: 'המגרש הקבוע',
    fieldLat: 32.0853,
    fieldLng: 34.7818,
    maxPlayers: 16,
    minPlayers: 10,
    players: mockPlayers.slice(7, 21).map((p) => p.id), // 14 of 16, ME (idx 6) excluded
    waitlist: [],
    pending: [],
    participantIds: unionIds(mockPlayers.slice(7, 21).map((p) => p.id), [], []),
    status: 'open',
    locked: false,
    currentMatchIndex: 0,
    matches: [],
    weather: { tempC: 23, rainProb: 10 },
    createdBy: mockPlayers[0].id,
    visibility: 'community' as const,
    requiresApproval: false,
    format: '5v5',
    numberOfTeams: 3,
    fieldType: 'synthetic',
    matchDurationMinutes: 90,
    cancelDeadlineHours: 12,
    bringBall: false,
    bringShirts: false,
    createdAt: Date.now() - 1000 * 60 * 60 * 6,
    // Two guests for the guest-rating demo: one ME added (→ editable rating),
    // one another player added (→ ME, an admin, sees it read-only).
    guests: [
      {
        id: 'guest-roi',
        name: 'רועי',
        estimatedRating: 4,
        addedBy: ME,
        createdAt: Date.now() - 1000 * 60 * 30,
      },
      {
        id: 'guest-omer',
        name: 'עומר',
        estimatedRating: 3.5,
        addedBy: mockPlayers[1].id,
        createdAt: Date.now() - 1000 * 60 * 20,
      },
    ],
    // 4-team split — for previewing the כוחות editor with four columns
    // (includes both guests as chips).
    draftTeams: {
      method: 'snake' as const,
      numTeams: 4,
      createdAt: Date.now() - 1000 * 60 * 25,
      createdBy: ME,
      teams: [
        {
          index: 0,
          captainId: mockPlayers[7].id,
          playerIds: [7, 8, 9].map((i) => mockPlayers[i].id),
        },
        {
          index: 1,
          captainId: mockPlayers[10].id,
          playerIds: [10, 11, 12].map((i) => mockPlayers[i].id),
        },
        {
          index: 2,
          captainId: mockPlayers[13].id,
          playerIds: [
            mockPlayers[13].id,
            mockPlayers[14].id,
            'guest:guest-roi',
          ],
        },
        {
          index: 3,
          captainId: mockPlayers[15].id,
          playerIds: [
            mockPlayers[15].id,
            mockPlayers[16].id,
            'guest:guest-omer',
          ],
        },
      ],
    },
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
    visibility: 'public' as const,
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
    visibility: 'public' as const,
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
    visibility: 'community' as const,
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
    pending: mockPlayers.slice(13, 16).map((p) => p.id), // 3 awaiting my approval
    participantIds: unionIds(mockPlayers.slice(0, 13).map((p) => p.id), [], mockPlayers.slice(13, 16).map((p) => p.id)),
    ballHolderUserId: mockPlayers[4].id,
    status: 'open',
    locked: false,
    currentMatchIndex: 0,
    matches: [],
    weather: { tempC: 26, rainProb: 0 },
    createdBy: mockPlayers[6].id, // ME organizes
    visibility: 'community' as const,
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
    visibility: 'community' as const,
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
    visibility: 'public' as const,
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
    visibility: 'community' as const,
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

// Mock per-mini-game history for the finished game gv2-7 — powers a live
// verification of the "היסטוריית המשחקונים" screen in FORCE_MOCK runs. Teams:
// A = p1..p5, B = p6..p10 (p7 "דניאל" = the mock current user). Shows goals,
// assists, an own goal, and a penalty-shootout round.
export const mockRoundHistory: Record<string, RoundHistoryDoc[]> = {
  'gv2-7': [
    {
      roundId: '1',
      teamA: ['p1', 'p2', 'p3', 'p4', 'p5'],
      teamB: ['p6', 'p7', 'p8', 'p9', 'p10'],
      scoreA: 3,
      scoreB: 1,
      winnerSide: 'A',
      goals: [
        { scorerId: 'p1', assisterId: 'p3', ownGoal: false, team: 'A' },
        { scorerId: 'p2', assisterId: null, ownGoal: false, team: 'A' },
        { scorerId: 'p1', assisterId: 'p4', ownGoal: false, team: 'A' },
        { scorerId: 'p6', assisterId: null, ownGoal: false, team: 'B' },
      ],
      at: 1000,
    },
    {
      roundId: '2',
      teamA: ['p1', 'p2', 'p3', 'p4', 'p5'],
      teamB: ['p6', 'p7', 'p8', 'p9', 'p10'],
      scoreA: 2,
      scoreB: 2,
      winnerSide: 'tie',
      goals: [
        { scorerId: 'p5', assisterId: 'p2', ownGoal: false, team: 'A' },
        { scorerId: 'p3', assisterId: null, ownGoal: false, team: 'A' },
        { scorerId: 'p7', assisterId: 'p6', ownGoal: false, team: 'B' },
        { scorerId: 'p9', assisterId: null, ownGoal: false, team: 'B' },
      ],
      penalties: [
        { kickerId: 'p1', keeperId: 'p10', scored: true, team: 'A' },
        { kickerId: 'p6', keeperId: 'p5', scored: true, team: 'B' },
        { kickerId: 'p2', keeperId: 'p10', scored: false, team: 'A' },
        { kickerId: 'p7', keeperId: 'p5', scored: true, team: 'B' },
        { kickerId: 'p3', keeperId: 'p10', scored: true, team: 'A' },
        { kickerId: 'p8', keeperId: 'p5', scored: false, team: 'B' },
        { kickerId: 'p4', keeperId: 'p10', scored: true, team: 'A' },
        { kickerId: 'p9', keeperId: 'p5', scored: false, team: 'B' },
      ],
      at: 2000,
    },
    {
      roundId: '3',
      teamA: ['p1', 'p2', 'p3', 'p4', 'p5'],
      teamB: ['p6', 'p7', 'p8', 'p9', 'p10'],
      scoreA: 4,
      scoreB: 2,
      winnerSide: 'A',
      goals: [
        { scorerId: 'p1', assisterId: 'p5', ownGoal: false, team: 'A' },
        { scorerId: 'p2', assisterId: null, ownGoal: false, team: 'A' },
        { scorerId: 'p3', assisterId: 'p1', ownGoal: false, team: 'A' },
        { scorerId: 'p4', assisterId: null, ownGoal: false, team: 'A' },
        { scorerId: 'p8', assisterId: null, ownGoal: false, team: 'B' },
        { scorerId: 'p5', assisterId: null, ownGoal: true, team: 'A' },
      ],
      at: 3000,
    },
  ],
};

// Mock "מה חדש" config — powers the WhatsNew modal in FORCE_MOCK runs (mock
// mode pretends the user came from 1.0.80, so all of these show).
export const mockWhatsNew = {
  enabled: true,
  items: [
    { version: '1.0.84', emoji: '📋', title: 'היסטוריית המשחקונים',
      body: 'אחרי כל ערב — מי נגד מי, גולים, בישולים, פנדלים ותוצאה לכל משחקון.' },
    { version: '1.0.84', emoji: '✋', title: 'שובר-שוויון בפנדלים',
      body: 'משחקון שנגמר בתיקו? מכריעים בפנדלים, עם סטטיסטיקת בועט ושוער.' },
    { version: '1.0.82', emoji: '🎨', title: 'עיצוב חדש לכרטיסי המשחקים',
      body: 'תפוסה, הסטטוס שלך ופרטי המשחק — הכל במבט אחד.' },
    { version: '1.0.82', emoji: '🕒', title: '"משחק בדרך"',
      body: 'משחקי מועדון שההרשמה בהם עוד תיפתח, עם ספירה לאחור עד הפתיחה.' },
    { version: '1.0.81', emoji: '✨', title: 'סיכום הערב שלך',
      body: 'כרטיס אישי ומעוצב לשיתוף — הגולים, הבישולים והתואר שלך מהערב.' },
  ],
};
