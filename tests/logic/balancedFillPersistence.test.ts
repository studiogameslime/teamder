jest.mock('@/firebase/config',()=>({getFirebase:jest.fn()}));
import {readDraftTeams,readRotation} from '@/firebase/firestore';
import {buildRoundSides} from '../../functions/src/roundSides';
import {rosterOf} from '@/services/rotationEngine';
test('opt in and completed usage survive actual Firestore readers',()=>{
 const raw={completionMode:'balanced',method:'regular',teams:[{index:0,captainId:'a',playerIds:['a']},{index:1,captainId:'b',playerIds:['b']}]};
 expect(readDraftTeams(raw)?.completionMode).toBe('balanced');
 expect(readDraftTeams({...raw,completionMode:'other'})?.completionMode).toBeUndefined();
 const rotation={playing:[0,1],waiting:[2],loans:[],fillUsage:{a:{games:2,fills:1,lastRound:3},bad:{games:-1,fills:0,lastRound:3}}};
 expect(readRotation(rotation)?.fillUsage).toEqual({a:{games:2,fills:1,lastRound:3}});
});
test('server statistics sides use borrowed actual participants, excluding the waiting home side',()=>{
 const teams=[{index:0,playerIds:['a']},{index:1,playerIds:['b']},{index:2,playerIds:['x','y','z']}];
 const loans=[{playerId:'x',homeTeam:2,filledTeam:0},{playerId:'y',homeTeam:2,filledTeam:1}];
 const sides=buildRoundSides({sideA:rosterOf(0,teams,loans),sideB:rosterOf(1,teams,loans),goals:[],roster:new Set(['a','b','x','y','z']),arrivals:{},isReal:()=>true});
 expect(sides.A).toEqual(['a','x']);expect(sides.B).toEqual(['b','y']);
 expect([...sides.A,...sides.B]).not.toContain('z');
});
