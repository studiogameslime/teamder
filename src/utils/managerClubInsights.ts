import type { Game, Group } from '@/types';
import { activeGuestCount } from '@/types';
import { eveningPlayState, needsPlayVerification } from './eveningPlayed';
import { memberIds, registered } from './managerDashboard';

export type ClubResult = { id: string; scoreA: number; scoreB: number };
export type ClubResults = Record<string, { rows: ClubResult[]; unavailable: boolean; truncated: boolean }>;
export function clubHistory(group: Group, games: Game[], now: number) {
  return [...new Map(games.filter(g => g.groupId === group.id && g.startsAt < now && eveningPlayState(g) === 'happened').map(g => [g.id, g])).values()]
    .sort((a,b) => b.startsAt-a.startsAt || a.id.localeCompare(b.id));
}
const rosterIds = (g: Game) => [...new Set(g.players)].filter(id => registered(g,id));
const occupancy = (g: Game) => rosterIds(g).length + activeGuestCount(g.guests);
export function managerClubInsights(group: Group, games: Game[], now: number) {
  const history = clubHistory(group,games,now), recent = history.slice(0,10), previous = history.slice(10,20);
  const upcoming = games.filter(g => g.groupId === group.id && g.startsAt > now && ['open','locked','scheduled'].includes(g.status)).sort((a,b)=>a.startsAt-b.startsAt)[0];
  const average = (rows: Game[]) => rows.length ? rows.reduce((n,g)=>n+occupancy(g),0)/rows.length : null;
  const returned = memberIds(group).flatMap(userId => {
    const joined = group.joinedAt?.[userId];
    const eligible = history.filter(g=>typeof joined!=='number'||g.startsAt>=joined);
    const at = upcoming && registered(upcoming,userId) ? -1 : eligible.findIndex(g=>registered(g,userId));
    // A return must be recent, have at least three missed evenings and a known earlier registration.
    if (at < -1 || at >= 3 || (at===-1 && !(upcoming && registered(upcoming,userId)))) return [];
    const before = eligible.slice(at+1);
    const gap = before.findIndex(g=>registered(g,userId));
    if (gap < 3) return [];
    const game = at === -1 ? upcoming! : eligible[at];
    return [{ userId, gap, gameId:game.id, at:game.startsAt, upcoming:at===-1 }];
  }).sort((a,b)=>b.at-a.at || a.userId.localeCompare(b.userId));
  const newcomers = memberIds(group).flatMap(userId => {
    const joinedAt = group.joinedAt?.[userId];
    if (typeof joinedAt!=='number'||!Number.isFinite(joinedAt)||joinedAt>now||joinedAt<now-30*86400000) return [];
    const completed = history.filter(g=>g.startsAt>=joinedAt && registered(g,userId)).length;
    const next = games.some(g=>g.groupId===group.id && g.startsAt>=joinedAt && registered(g,userId) &&
      (g.status==='active' || (g.startsAt>now && ['open','locked','scheduled'].includes(g.status))));
    return [{userId,joinedAt,completed,next}];
  }).sort((a,b)=>b.joinedAt-a.joinedAt || a.userId.localeCompare(b.userId));
  return { recent, previous, unique: new Set(recent.flatMap(rosterIds)).size, average:average(recent),
    previousAverage:recent.length===10&&previous.length===10?average(previous):null,
    full:recent.filter(g=>g.maxPlayers>0&&occupancy(g)>=g.maxPlayers).length,
    returned,newcomers, newcomerRegistered:newcomers.filter(n=>n.completed>0||n.next).length,
    rounds:recent.map(g=>({game:g,registered:occupancy(g),accounts:rosterIds(g).length,guests:activeGuestCount(g.guests)})) };
}
export function clubBalance(games: Game[], results: ClubResults) {
  let draws=0,oneGoal=0,wide=0,covered=0,unavailable=0,missing=0,invalid=0;
  for (const g of games) {
    const entry=results[g.id];
    if (!entry || entry.unavailable) { unavailable++; continue; }
    if (entry.truncated) unavailable++;
    const rows=[...new Map(entry.rows.map(r=>[r.id,r])).values()];
    let valid=0;
    for (const r of rows) {
      if (![r.scoreA,r.scoreB].every(v=>Number.isSafeInteger(v)&&v>=0)) { invalid++; continue; }
      valid++;
      const gap=Math.abs(r.scoreA-r.scoreB);
      if(gap===0)draws++; else if(gap===1)oneGoal++; else wide++;
    }
    if(valid) covered++; else missing++;
  }
  const total=draws+oneGoal+wide;
  return {draws,oneGoal,wide,total,covered,unavailable,missing,invalid,closePercent:total?Math.round((draws+oneGoal)/total*100):null};
}

/** Sealed count survives legacy evenings without a per-game score history. */
export function clubRoundNumbers(games: Game[], results: ClubResults) {
  const rounds=games.map(game=>{
    const sealed=game.committedRoundCount;
    const known=typeof sealed==='number'&&Number.isSafeInteger(sealed)&&sealed>=0;
    const entry=results[game.id];
    const recorded=entry&&!entry.unavailable?new Set(entry.rows.map(r=>r.id)).size:0;
    // An empty legacy subcollection does not prove that no games were played.
    const count=known?(entry?.truncated&&sealed<=recorded?null:Math.max(sealed,recorded)):entry&&!entry.unavailable&&!entry.truncated&&recorded>0?recorded:null;
    return {game,count};
  });
  const available=rounds.filter((r):r is typeof r & {count:number}=>r.count!==null);
  const total=available.reduce((n,r)=>n+r.count,0);
  const maximum=available.length?Math.max(...available.map(r=>r.count)):null;
  return {rounds,total,covered:available.length,missing:rounds.length-available.length,
    average:available.length?total/available.length:null,maximum,
    busiest:available.filter(r=>r.count===maximum)};
}

export function managerNeedsAttention(group: Group, games: Game[], now:number) {
  const ids=memberIds(group),members=new Set(ids);
  const pending=[...new Set(group.pendingPlayerIds??[])].filter(id=>!members.has(id));
  const unverified=[...new Map(games.filter(g=>g.groupId===group.id&&Number.isFinite(g.startsAt)&&g.startsAt<=now&&g.startsAt>=now-90*86400000&&needsPlayVerification(g)).map(g=>[g.id,g])).values()]
    .sort((a,b)=>a.startsAt-b.startsAt);
  const unrated=group.internalRating?ids.filter(id=>{const rating=group.adminRatings?.[id];return typeof rating!=='number'||!Number.isFinite(rating)||rating<=0||rating>5;}):[];
  return {pending,unverified,unrated,topics:Number(pending.length>0)+Number(unverified.length>0)+Number(unrated.length>0)};
}
