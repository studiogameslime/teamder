import type { CommunityPlayerEvent, Game, Group } from '@/types';
import { activeGuestCount } from '@/types';
import { eveningPlayState } from './eveningPlayed';

export type ScorePoint = { gameId: string; at: number; score: number };
export type RatingAdvice = { userId: string; rating: number; direction: 'up' | 'down'; points: ScorePoint[]; delta: number };
export type RatingSeries = { userId: string; rating: number | null; points: ScorePoint[] };
export const REGULAR_WINDOW = 10;
export const REGULAR_MINIMUM = 7;
export const memberIds = (group: Group) => [...new Set([...group.adminIds, ...group.playerIds])];
export const registered = (g: Game, uid: string) => g.players.includes(uid) && !g.cancellations?.[uid];
export function registrationState(g: Game, uid: string) {
  if (g.players.includes(uid)) return 'registered';
  if (g.waitlist.includes(uid)) return 'waitlist';
  if (g.pending?.includes(uid)) return 'pending';
  if (g.rejectedPlayerIds?.includes(uid)) return 'rejected';
  if (typeof g.cancellations?.[uid] === 'number') return 'cancelled';
  return 'none';
}
/** Available scores remain visible even without a recommendation or an admin rating. */
export function ratingSeries(group: Group, games: Game[], scores: Record<string, Record<string, number>>): RatingSeries[] {
  const history = games.filter(g => g.groupId === group.id && eveningPlayState(g) === 'happened').sort((a,b) => a.startsAt-b.startsAt);
  return memberIds(group).flatMap(userId => {
    const rating = group.adminRatings?.[userId];
    const points = history.flatMap(g => {
      const score = scores[g.id]?.[userId];
      return typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 10
        ? [{ gameId:g.id, at:g.startsAt, score }] : [];
    }).slice(-5);
    if (!points.length) return [];
    return [{userId, rating:typeof rating==='number'&&Number.isFinite(rating)&&rating>0&&rating<=5?rating:null,points}];
  });
}
/** Trend is evidence for REVIEW, not an estimator of absolute football skill. */
export function ratingAdvice(group: Group, games: Game[], scores: Record<string, Record<string, number>>): RatingAdvice[] {
  if (!group.internalRating) return [];
  return ratingSeries(group,games,scores).flatMap(({userId,rating,points}) => {
    if (rating === null || points.length < 5) return [];
    const delta = (points[3].score+points[4].score-points[0].score-points[1].score)/2;
    // Plateaus and a small correction must not hide a sustained change.
    // Both recent scores must support the shift, so one outlier cannot decide.
    const agreeing = points.slice(1).filter((p,i) => (p.score-points[i].score)*Math.sign(delta) > 0).length;
    const baseline = (points[0].score + points[1].score) / 2;
    const sustained = points.slice(-2).every(p => (p.score-baseline)*Math.sign(delta) >= 0.5);
    if (Math.abs(delta) < 1 || agreeing < 2 || !sustained || (delta > 0 && rating >= 5)) return [];
    return [{ userId, rating, direction:delta > 0 ? 'up' as const : 'down' as const, points, delta }];
  }).sort((a,b) => Math.abs(b.delta)-Math.abs(a.delta) || a.userId.localeCompare(b.userId));
}
export function managerOverview(group: Group, games: Game[], now: number) {
  const ids = memberIds(group);
  const history = games.filter(g => g.groupId === group.id && g.startsAt < now && eveningPlayState(g) === 'happened').sort((a,b) => b.startsAt-a.startsAt);
  const upcoming = games.filter(g => g.groupId === group.id && g.startsAt > now && ['open','scheduled','locked'].includes(g.status)).sort((a,b)=>a.startsAt-b.startsAt)[0];
  const members = ids.map(userId => {
    const knownJoin = group.joinedAt?.[userId];
    const firstKnown = history.filter(g=>registered(g,userId)||typeof g.cancellations?.[userId]==='number').reduce((min,g)=>Math.min(min,g.startsAt),Infinity);
    const start = typeof knownJoin==='number'&&Number.isFinite(knownJoin) ? knownJoin : firstKnown;
    // No join date and no historical involvement is unknown, not years of absence.
    const eligible = history.filter(g => g.startsAt >= start);
    const recent = eligible.slice(0,REGULAR_WINDOW);
    const count = recent.filter(g => registered(g,userId)).length;
    const regular = recent.length === REGULAR_WINDOW && count >= REGULAR_MINIMUM;
    const absentIndex = eligible.findIndex(g => registered(g,userId));
    const missed = absentIndex < 0 ? eligible.length : absentIndex;
    const beforeAbsence = eligible.slice(missed,missed+REGULAR_WINDOW);
    const wasRegular = beforeAbsence.length === REGULAR_WINDOW && beforeAbsence.filter(g=>registered(g,userId)).length >= REGULAR_MINIMUM;
    const cancellationGames = history.filter(g => typeof g.cancellations?.[userId] === 'number');
    const late = cancellationGames.filter(g=>typeof g.cancelDeadlineHours === 'number' && g.cancellations![userId] > g.startsAt-g.cancelDeadlineHours*3600000).length;
    return { userId, regular, wasRegular, count, sample:recent.length,
      totalRegistered:eligible.filter(g => registered(g,userId)).length, totalSample:eligible.length,
      missed, cancellations:cancellationGames.length, late };
  });
  const roster = new Set(upcoming?.players ?? []);
  const known = new Set(ids);
  const regularCount = members.filter(m=>m.regular && roster.has(m.userId)).length;
  const newCount = members.filter(m=>m.sample < REGULAR_WINDOW && roster.has(m.userId)).length;
  const clubCount = [...roster].filter(id=>known.has(id)).length;
  const guests = upcoming ? activeGuestCount(upcoming.guests ?? []) : 0;
  return { upcoming, members, regularCount, newCount, occasionalCount:clubCount-regularCount-newCount, clubCount,
    externalCount:roster.size-clubCount, guests, total:roster.size+guests,
    missing:upcoming ? members.filter(m=>m.regular && registrationState(upcoming,m.userId) !== 'registered') : [],
    absent:members.filter(m=>m.missed >= 3 || (m.wasRegular && m.missed >= 2)).sort((a,b)=>b.missed-a.missed),
    cancellationCount:members.reduce((n,m)=>n+m.cancellations,0), lateCount:members.reduce((n,m)=>n+m.late,0) };
}
export function equipmentCounts(group: Group, events: CommunityPlayerEvent[], since: number, now: number) {
  const counts = Object.fromEntries(memberIds(group).map(id=>[id,{userId:id,ball:0,jerseys:0}]));
  const seen = new Set<string>();
  for (const e of events) {
    if (e.groupId !== group.id || e.at < since || e.at > now || e.returned || e.revoked || !counts[e.userId] || !['ball','jerseys'].includes(e.type)) continue;
    // One round/holder/item, even when the end-of-round sheet was saved twice.
    const key = e.gameId ? `${e.gameId}:${e.userId}:${e.type}` : e.id;
    if (seen.has(key)) continue;
    seen.add(key);
    counts[e.userId][e.type as 'ball'|'jerseys']++;
  }
  return Object.values(counts).sort((a,b)=>(b.ball+b.jerseys)-(a.ball+a.jerseys) || a.userId.localeCompare(b.userId));
}
