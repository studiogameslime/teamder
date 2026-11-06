import { liveTeamsEndToEndWorld } from '../helpers/liveTeamsEndToEndWorld';
import { roundCommitKey } from '@/services/rotationEngine';
import { parseSeasonTable } from '@/utils/seasonArchive';
import { mergeAllTime } from '@/utils/allTimeTable';
import { closeSeason } from '../../functions/src/seasonRollover';
import type { DraftTeam } from '@/types';
import roster from '../../docs/audits/2026-11-04-system-night/evidence/evening-roster.json';

jest.mock('../../functions/node_modules/firebase-admin', () => ({ firestore: { FieldValue: { delete: () => ({ __delete: true }) } } }));
jest.mock('../../functions/src/serverErrorLog', () => ({ observeCaughtError: jest.fn() }));

test('three mini-games crossing midnight, same-name guest correction, partial close and retry preserve one evening', async () => {
  jest.useFakeTimers();
  try {
    const startsAt = Date.parse('2026-11-02T23:51:00+02:00');
    jest.setSystemTime(startsAt);
    const w = liveTeamsEndToEndWorld(3);
    const game = w.state();
    const member = roster.joining;
    const guest = 'guest:' + roster.guests[0].id;
    expect(game.id).toBe(roster.gameId);
    expect(game.groupId).toBe(roster.groupId);
    expect(new Set(game.draftTeams.teams.flatMap((team:any) => team.playerIds))).toEqual(new Set(roster.players));
    expect(roster.players).not.toContain(roster.leaving);
    game.startsAt = startsAt;
    game.players = [...roster.players];
    game.waitlist = [...roster.waitlist];
    game.participantIds = [...roster.participantIds];
    game.maxPlayers = roster.maxPlayers;
    game.guests = structuredClone(roster.guests);
    w.documents.set('users/' + member, { name: 'דני' });
    async function commitGame() {
      const decision = await w.service.prepareRoundResult('audit','owner');
      const {rotation, teams} = decision.skeleton;
      await w.service.commitFilledRotation('audit',decision.draft,{rotation,teams},undefined,
        {userId:'owner',userName:'מנהל'},decision.skeleton.source);
    }
    async function scoreForA() {
      const current = w.read();
      const index = current.rotation!.playing[0];
      const scorer = current.draftTeams!.teams.find((team: DraftTeam) => team.index === index)!.playerIds[1];
      await w.service.recordGoal('audit', {team:'A',scorerId:scorer,minute:2,expectedRoundId:roundCommitKey(current.rotation!)});
    }

    // The seeded first mini-game already has one goal and one assist.
    await commitGame();
    jest.setSystemTime(startsAt + 8 * 60_000);
    await scoreForA();
    await commitGame();
    jest.setSystemTime(startsAt + 18 * 60_000);
    await scoreForA();
    await w.service.endEvening('audit');
    await w.finishStages();
    const history = await w.service.getRoundHistory('audit');
    expect(history.map((r:any) => [r.scoreA, r.scoreB])).toEqual([[1,0],[1,0],[1,0]]);
    expect(history[1].at).toBeLessThan(Date.parse('2026-11-03T00:00:00+02:00'));
    expect(history[2].at).toBeGreaterThan(Date.parse('2026-11-03T00:00:00+02:00'));

    const summary = () => w.roundSummaryService.get('audit','club');
    const profile = () => w.playerStats().compute(member,{
      totals: Promise.resolve(w.documents.get('users/'+member).stats),
      isCurrent: () => false, // Base statistics only; no optional highlight queries.
    });
    expect((await summary()).stats).toMatchObject({rounds:3,goals:3,assists:1});
    expect(await profile()).toMatchObject({attendedGames:1,totalRegistered:1,goals:1,goalsPerEvening:1});
    expect(w.documents.get('communityPlayerStats/club__'+member)).toMatchObject({games:1,goals:1});
    await w.service.addRetroGoal('audit',member,null,'member-goal');
    await w.service.addRetroGoal('audit',guest,null,'guest-goal');
    await w.service.addRetroGoal('audit',guest,null,'guest-goal');
    expect((await summary()).stats).toMatchObject({rounds:3,goals:5,assists:1});
    expect(await w.service.getRoundHistory('audit')).toEqual(history);
    expect(await profile()).toMatchObject({attendedGames:1,totalRegistered:1,goals:2,goalsPerEvening:2});
    expect(await w.service.getCommunityChampionship('club')).toMatchObject({totalRounds:3,totalGoals:4,guestGoals:1});
    expect(w.documents.get('gamePlayerStats/audit__'+guest)).toMatchObject({goals:1,isGuest:true});
    expect(w.documents.has('users/'+guest)).toBe(false);

    const close = () => closeSeason({db:w.db as any, groupId:'club',seasonId:'s1',seasonNo:1,
      startsAt:startsAt-24*60*60_000,completedRounds:1,now:Date.now()});
    // Club totals are wound back last. Earlier player rows have already been wound back.
    w.failAt('communityStats/club');
    await expect(close()).rejects.toThrow('UNAVAILABLE');
    const frozen = structuredClone(w.documents.get('seasonSummary/club__s1'));
    expect(frozen).toMatchObject({completedRounds:1,totals:{goals:4,guestGoals:1,rounds:3}});
    expect(frozen.zeroedAt).toBeUndefined();
    expect(w.documents.get('communityPlayerStats/club__'+member)).toMatchObject({games:0,goals:0});
    expect(w.documents.get('communityStats/club')).toMatchObject({goals:4,guestGoals:1,rounds:3});
    w.failAt();
    await expect(close()).resolves.toMatchObject({archived:true});
    await expect(close()).resolves.toMatchObject({archived:false});
    const archive = w.documents.get('seasonSummary/club__s1');
    expect(archive.players).toEqual(frozen.players);
    expect(archive.totals).toEqual(frozen.totals);
    expect(archive.zeroedAt).toBe(Date.now());
    expect(w.documents.get('seasonCards/club__s1')).toMatchObject({completedRounds:1});
    const live = await w.service.getCommunityChampionship('club');
    expect(live).toMatchObject({totalRounds:0,totalGoals:0,guestGoals:0});
    const allTime = mergeAllTime([live, parseSeasonTable(archive)]);
    expect(allTime).toMatchObject({totalRounds:3,totalGoals:4,guestGoals:1});
    expect(allTime.players.find(p => p.uid === member)).toMatchObject({games:1,goals:2});
    expect(await profile()).toMatchObject({attendedGames:1,goals:2});
    expect((await summary()).stats).toMatchObject({rounds:3,goals:5});
  } finally {
    jest.useRealTimers();
  }
});

test('missing kickoff and unverified evenings do not manufacture a winning attendance streak', async () => {
  const w = liveTeamsEndToEndWorld(3);
  const member = 't0-p0';
  const past = Date.parse('2026-11-01T20:00:00+02:00');
  const finished = {status:'finished', players:[member], participantIds:[member], groupId:'club'};
  w.documents.set('games/dated', {...finished,startsAt:past,endedBy:'admin',arrivals:{[member]:'no_show'}});
  w.documents.set('games/undated', {...finished,endedBy:'admin'});
  w.documents.set('games/auto', {...finished,startsAt:past+60_000,endedBy:'auto'});
  w.documents.set('games/cancelled', {...finished,startsAt:past+120_000,status:'cancelled',playVerified:true});
  const stats = await w.playerStats().compute(member,{goals:2,isCurrent:()=>false});
  expect(stats).toMatchObject({attendedGames:1,totalRegistered:2,attendanceRate:50,goalsPerEvening:2});
  expect(stats).not.toHaveProperty('attendanceStreak');
});
