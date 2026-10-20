import { didEveningHappen, type PlayableEvening } from './eveningPlayed';
import type { UserActivity } from '../types';

type RawRound = PlayableEvening & Record<string, any>;
export const PLAYER_ROUND_FIELDS = ['title','createdBy','createdAt','joinedAt','startsAt','isOrphanContext','city','fieldAddress','fieldName','groupId','status','arrivals','visibility','players','waitlist','pending','endedBy','playVerified','liveMatch.startedAt','liveMatch.phase','liveMatch.activeIntervals','liveMatch.timerEvents','liveMatch.timerAccumulatedMs','liveMatch.timerLastStartedAt','liveMatch.goals','liveMatch.scoreA','liveMatch.scoreB','rotation','committedRoundCount'];
export function playerRoundFacts(game: RawRound, uid: string, now=Date.now()) {
  const contains = (key:string) => Array.isArray(game[key]) && game[key].includes(uid);
  const registration = contains('players') ? 'registered' : contains('waitlist') ? 'waiting' : contains('pending') ? 'pending' : 'none';
  // Matches src/utils/playedGames.ts:isAttendedGame. Arrival is an opt-out:
  // historical rounds usually have no arrival entry at all. Being invited,
  // waiting or creating a round alone is not evidence of playing it.
  const attended = !!uid && didEveningHappen(game)
    && !(typeof game.startsAt === 'number' && game.startsAt >= now)
    && contains('players') && game.arrivals?.[uid] !== 'no_show';
  return { registration, attended, managed:game.createdBy===uid };
}
export function playerSummary(data:UserActivity, now=Date.now()) {
  const games=data.related?.games ?? [];
  const clubs=(data.related?.groups ?? []).filter(g=>g.detail.member===true || g.detail.manager===true);
  const future=games.filter(g=>g.at>now && !['cancelled','finished'].includes(g.status) && ['registered','waiting','pending'].includes(String(g.detail.registration))).sort((a,b)=>a.at-b.at);
  const attended=games.filter(g=>g.detail.attended===true).sort((a,b)=>b.at-a.at);
  return {clubs,future,attended,registered:future.filter(g=>g.detail.registration==='registered'),managed:games.filter(g=>g.detail.managed===true),managing:clubs.filter(g=>g.detail.manager===true),partial:!data.related || [...data.failedSources ?? [],...data.limitedSources ?? []].some(s=>/מחזור|מועדונ/.test(s))};
}
