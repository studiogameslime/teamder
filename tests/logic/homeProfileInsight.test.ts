import { homeProfileInsight, homeProfileInsights } from '@/utils/homePersonalStats';
import type { PlayerStatsSummary } from '@/services/playerStatsService';
const base: PlayerStatsSummary = { attendedGames: 0, goals: 0, assists: 0, totalRegistered: 0, attendanceRate: 0,
  goalsPerEvening: 0, distinctPlayers: 0, mostPlayedWith: null, mostWinsWith: null, biggestVictim: null,
  nemesis: null, mostAssistedTo: null, mostAssistedBy: null };
test('a record gap of one refers to matching a previous record, not inventing a new one', () => {
  expect(homeProfileInsight({ ...base, attendanceStreak: { current: 4, best: 5 } })).toEqual({ kind: 'streak',
    title: '4 הגעות ברצף!', detail: 'עוד מחזור אחד להשוואת שיא ההגעה שלך.', progress: { current: 4, target: 5 } });
});
test('a tied or ongoing record does not promise a nonexistent larger record', () => {
  const insight = homeProfileInsight({ ...base, attendanceStreak: { current: 5, best: 5 } });
  expect(insight.detail).toContain('הארוך ביותר');expect(insight.progress).toBeUndefined();
});
test.each([{current:1,best:5},{current:0,best:5},{current:NaN,best:5},{current:4,best:3}])('insufficient or invalid streak %j falls back without making a record claim', attendanceStreak => {
  expect(homeProfileInsight({ ...base, totalRegistered: 8, attendanceRate: 88, attendanceStreak }).kind).toBe('attendance');
});
test('no data gets encouragement instead of invented scores, attendance or records', () => {
  const result = homeProfileInsight(base);
  expect(result.kind).toBe('welcome');expect(result.progress).toBeUndefined();
  expect(result.detail).toContain('אחרי המחזור הראשון');
});
test('another personal detail uses distinct teammates rather than repeating goals or round totals', () => {
  const result = homeProfileInsight({ ...base, attendedGames: 2, distinctPlayers: 7 });
  expect(result.kind).toBe('community');expect(result.detail).toContain('7 שחקנים שונים');
});

const now = new Date(2026, 9, 25, 12).getTime();
function scored(scores: number[], extra: Partial<PlayerStatsSummary['highlights']> = {}): PlayerStatsSummary {
  return { ...base, attendedGames: 20, highlights: { points: scores.map((score, i) => ({ score, gameId: `g${i}`, at: now - (5 - i) * 86400000 })),
    recentCount: 5, bestGoals: null, bestAssists: null, recordedRounds: 5, incomplete: false, results: null, ...extra } };
}
const ofKind = (stats: PlayerStatsSummary, kind: string) => homeProfileInsights(stats, now).find(i => i.kind === kind);

test('an outstanding latest score compares against the previous four, without claiming a lifetime record', () => {
  const insight = ofKind(scored([7, 7, 7, 7, 9]), 'form');
  expect(insight?.title).toBe('המחזור האחרון שלך בלט');
  expect(insight?.detail).toContain('9');expect(insight?.detail).toContain('7');
  expect(insight?.detail).not.toMatch(/שיא/);
});

test('improvement uses two recent scores against three previous scores, ordered by time', () => {
  const data = scored([6, 6, 6, 7, 8]);
  data.highlights!.points.reverse();
  const insight = ofKind(data, 'form');
  expect(insight?.title).toBe('המשחק שלך עולה מדרגה');expect(insight?.detail).toContain('7.5');
  expect(insight?.detail).toContain('6');
});

test('consistent good scores qualify, while consistently weak scores get no false praise', () => {
  expect(ofKind(scored([7, 7.2, 7.3, 7.1, 7.4]), 'form')?.title).toContain('יציבות');
  expect(ofKind(scored([2, 2, 2, 2, 2]), 'form')).toBeUndefined();
});

test.each(['incomplete', 'missing', 'duplicate', 'invalid', 'future', 'old'])('%s score history cannot support a form story', state => {
  const data = scored([7, 7, 7, 7, 9]);
  if (state === 'incomplete') data.highlights!.incomplete = true;
  if (state === 'missing') data.highlights!.points.pop();
  if (state === 'duplicate') data.highlights!.points[1].gameId = 'g0';
  if (state === 'invalid') data.highlights!.points[1].score = NaN;
  if (state === 'future') data.highlights!.points[4].at = now + 1;
  if (state === 'old') data.highlights!.points[0].at = now - 91 * 86400000;
  expect(ofKind(data, 'form')).toBeUndefined();
});

test.each([
  [2, 8, 'לסדר לאחרים'], [8, 2, 'לרוב הכובש'], [6, 5, 'גם מסיים'],
])('play style is derived from goals %i and assists %i', (goals, assists, title) => {
  expect(ofKind({ ...base, goals, assists }, 'playstyle')?.title).toContain(title);
});

test('a few actions or one-sided small samples do not invent a balanced playing style', () => {
  expect(ofKind({ ...base, goals: 2, assists: 2 }, 'playstyle')).toBeUndefined();
  expect(ofKind({ ...base, goals: 4, assists: 4 }, 'playstyle')).toBeUndefined();
});

test('goal involvement divides goals plus assists by attended rounds, not registrations or mini games', () => {
  const insight = ofKind({ ...base, attendedGames: 10, totalRegistered: 99, goals: 10, assists: 5, goalsPerEvening: 88 }, 'impact');
  expect(insight?.detail).toContain('1.5');expect(insight?.detail).toContain('למחזור');
  expect(ofKind({ ...base, attendedGames: 0, goals: 10, assists: 5 }, 'impact')).toBeUndefined();
  expect(ofKind({ ...base, attendedGames: 4, goals: 10, assists: 5 }, 'impact')).toBeUndefined();
});

test('an involvement average rounded to one uses a singular and approximate label', () => {
  expect(ofKind({ ...base, attendedGames: 54, goals: 31, assists: 24 }, 'impact')?.detail).toBe('בערך שער או בישול אחד למחזור ששיחקת, לפי הנתונים המצטברים.');
});

test('connection shares use the relevant assist or goal denominator and reject conflicting totals', () => {
  const data = { ...base, goals: 20, assists: 10, mostAssistedTo: { uid: 'p', count: 4 } };
  expect(ofKind(data, 'connection')?.detail).toContain('40%');
  expect(ofKind({ ...data, mostAssistedTo: { uid: 'p', count: 11 } }, 'connection')).toBeUndefined();
  expect(ofKind({ ...base, goals: 10, mostAssistedBy: { uid: 'p', count: 3 } }, 'connection')?.detail).toContain('30%');
});

test('positive results use mini games, including draws, and disclose the recorded round coverage', () => {
  const data = scored([6, 6, 6, 6, 6], { results: { wins: 6, losses: 2, ties: 2, games: 10, rounds: 3 } });
  expect(ofKind(data, 'results')?.detail).toContain('60%');
  expect(ofKind(data, 'results')?.detail).toContain('10 משחקים');
  expect(ofKind(data, 'results')?.detail).toContain('3 מחזורים');
  data.highlights!.results!.ties = 3;
  expect(ofKind(data, 'results')).toBeUndefined();
  data.highlights!.results!.ties = 2;data.highlights!.incomplete = true;
  expect(ofKind(data, 'results')).toBeUndefined();
});

test('a participation milestone is strictly future, close, and independent of goal milestones', () => {
  expect(ofKind({ ...base, attendedGames: 49 }, 'journey')?.detail).toContain('עוד מחזור אחד');
  expect(ofKind({ ...base, attendedGames: 50 }, 'journey')).toBeUndefined();
  expect(ofKind({ ...base, attendedGames: 54 }, 'journey')).toBeUndefined();
});

test.each([NaN, Infinity, -1, 2.5])('invalid lifetime counters %s never produce performance claims', value => {
  const all = homeProfileInsights({ ...base, goals: value, assists: value, attendedGames: value }, now);
  expect(all.some(i => ['impact', 'playstyle', 'connection', 'journey'].includes(i.kind))).toBe(false);
});

test('daily selection is stable within a day, changes on the next day, and only selects qualified stories', () => {
  const data = { ...base, attendedGames: 49, goals: 30, assists: 25, distinctPlayers: 12, attendanceStreak: { current: 4, best: 5 } };
  const chosen = homeProfileInsight(data, { playerId: 'u1', now });
  expect(homeProfileInsight(data, { playerId: 'u1', now: now + 3600000 })).toEqual(chosen);
  expect(homeProfileInsight(data, { playerId: 'u1', now: now + 86400000 })).not.toEqual(chosen);
  expect(homeProfileInsights(data, now)).toContainEqual(chosen);
  expect(homeProfileInsight(base, { playerId: 'u1', now }).kind).toBe('welcome');
  expect(homeProfileInsight(data, { playerId: 'u1', now: Infinity })).toBeDefined();
});
