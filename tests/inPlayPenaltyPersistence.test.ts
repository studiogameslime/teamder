jest.mock('@/firebase/config',()=>({getFirebase:jest.fn()}));
import {readLiveMatch,readStats} from '@/firebase/firestore';
import {parseSeasonTable} from '@/utils/seasonArchive';
import {mergeAllTime} from '@/utils/allTimeTable';
import {savedRoundLive} from '@/utils/savedRoundView';

test('real readers preserve regulation event, linked goal and scoring split, including unknown keeper',()=>{
 const penalty={id:'p',team:'A',kickerId:'a',keeperId:null,outcome:'goal',minute:5,clockMs:272000,at:123};
 const live=readLiveMatch({phase:'roundRunning',assignments:{},benchOrder:[],scoreA:1,scoreB:0,
  inPlayPenalties:[penalty],goals:[{id:'g',penaltyId:'p',team:'A',scorerId:'a',minute:5,at:123}]})!;
 expect(live.inPlayPenalties).toEqual([penalty]);expect(live.goals![0].penaltyId).toBe('p');
 expect(readStats({stats:{penTaken:7,penScored:5,penInPlayTaken:3,penInPlayScored:2}})).toMatchObject({penTaken:7,penScored:5,penInPlayTaken:3,penInPlayScored:2});
 const restored=savedRoundLive(live,{roundId:'r',teamA:['a'],teamB:['b'],winnerSide:'A',scoreA:1,scoreB:0,goals:[{penaltyId:'p',team:'A',scorerId:'a',assisterId:null,ownGoal:false}],inPlayPenalties:live.inPlayPenalties,at:1000});
 expect(restored.inPlayPenalties).toEqual([penalty]);expect(restored.goals![0].penaltyId).toBe('p');
});
test('closed seasons retain the regulation split and club attempt count; all-time combines them with old shootout-only seasons',()=>{
 const old=parseSeasonTable({players:{a:{userId:'a',penTaken:5,penScored:4}},totals:{rounds:2}});
 const recent=parseSeasonTable({players:{a:{userId:'a',penTaken:6,penScored:3,penInPlayTaken:2,penInPlayScored:1}},totals:{rounds:3,inPlayPenalties:3}});
 const all=mergeAllTime([old,recent]);expect(all.inPlayPenalties).toBe(3);
 expect(all.players[0]).toMatchObject({penTaken:11,penScored:7,penInPlayTaken:2,penInPlayScored:1});
 expect(all.players[0].penScored-all.players[0].penInPlayScored!).toBe(6);
 expect(old.inPlayPenalties).toBeUndefined();
});
