jest.mock('../../pulse/src/services/cache',()=>({cached:(_key:string,fn:()=>unknown)=>fn()}));
jest.mock('../../pulse/src/services/firestoreRest',()=>({getDoc:jest.fn(),queryEquals:jest.fn(),queryChildDocuments:jest.fn().mockResolvedValue([]),listAll:jest.fn()}));
import {getDoc,queryEquals,listAll} from '../../pulse/src/services/firestoreRest';
import {fetchRoundDetails,rosterIds,playerRating} from '../../pulse/src/services/gameDetails';
beforeEach(()=>jest.clearAllMocks());
test('roster preserves the registration bucket and deduplicates the legacy projection',()=>{
 expect(rosterIds({players:['a'],participantIds:['a','b'],pending:['b','c'],waitlist:['d'],cancellations:{a:1,e:2},adminRemovals:{f:3}})).toEqual([{id:'a',bucket:'רשום'},{id:'b',bucket:'ממתין לאישור'},{id:'c',bucket:'ממתין לאישור'},{id:'d',bucket:'ברשימת המתנה'},{id:'e',bucket:'ביטל הרשמה'},{id:'f',bucket:'הוסר בידי מנהל'}]);
});
test('internal ratings take precedence and an unrated player does not inherit the crowd score',()=>{
 expect(playerRating({internalRating:true,adminRatings:{a:4},hideInternalRating:true},'a',{average:2,count:8})).toEqual({rating:4,ratingSource:'דירוג מנהל פרטי'});
 expect(playerRating({internalRating:true,adminRatings:{}},'a',{average:2,count:8})).toEqual({});
 expect(playerRating({},'a',{average:0,count:0})).toEqual({});
});
test('details fetch just the selected game, roster, group, match records and scoped cards',async()=>{
 (getDoc as jest.Mock).mockImplementation(async(path:string)=>path==='games/g'?{id:'g',groupId:'club',players:['a'],waitlist:['b'],guests:[{id:'guest',name:'אורח',estimatedRating:3}],arrivals:{a:'arrived'},advancedMode:true}:path==='groups/club'?{id:'club',name:'מועדון',internalRating:true,adminRatings:{a:4}}:path==='users/a'?{id:'a',name:'שחקן',discipline:{events:[{id:'old',type:'yellow',gameId:'g',createdAt:10}]}}:path==='users/b'?{id:'b',name:'ממתין'}:null);
 (queryEquals as jest.Mock).mockImplementation(async(collection:string)=>collection==='rounds'?[{id:'round',gameId:'g'}]:[{id:'card',userId:'a',type:'red',at:5},{id:'unrelated',userId:'someone',type:'yellow'}]);
 const result=await fetchRoundDetails('g');expect(result.players).toHaveLength(3);expect(result.players[0].rating).toBe(4);expect(result.players[2].rating).toBe(3);expect(result.cards.map(c=>c.id)).toEqual(['legacy:old','card']);expect(result.row.detail.arrivals).toBe(1);expect(listAll).not.toHaveBeenCalled();expect(getDoc).not.toHaveBeenCalledWith('groups/club/ratings/a');expect(queryEquals).toHaveBeenCalledWith('rounds','gameId','g',500);
});
test('rating failures remain unknown and a missing game rejects',async()=>{
 (getDoc as jest.Mock).mockImplementation(async(path:string)=>{if(path==='games/g')return{id:'g',groupId:'club',players:['a']};if(path==='groups/club')return{id:'club'};if(path.includes('/ratings/'))throw Error('offline');return{id:'a',name:'שחקן'}});(queryEquals as jest.Mock).mockResolvedValue([]);
 const result=await fetchRoundDetails('g');expect(result.players[0].ratingUnknown).toBe(true);expect(result.players[0].rating).toBeUndefined();expect(result.failedSources).toContain('דירוג a');
 (getDoc as jest.Mock).mockResolvedValue(null);await expect(fetchRoundDetails('missing')).rejects.toThrow('PULSE_GAME_NOT_FOUND');
});
