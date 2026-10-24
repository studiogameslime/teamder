import { normalizePlayerSearch, playerAvailabilityLines, playerSearchMatches, playerAvailabilitySlots } from '../../src/utils/socialPlayers';
import type { SocialPlayer } from '../../src/types/social';
const player: SocialPlayer = {id:'p',name:'אִיתַי לוי',city:'אור יהודה',friend:false,commonClubCount:0,sharedRounds:0,
  availability:{isAvailableForInvites:true,preferredDays:[3,5],preferredTimes:['evening','morning'],availabilitySlots:{3:['evening'],5:['morning']}}};
test('legacy selected days with empty times display every window, matching the editor',()=>{
  const grid=playerAvailabilitySlots({preferredDays:[0,1,2,3,4,5,6],preferredTimes:[],isAvailableForInvites:true});
  expect(Object.keys(grid)).toHaveLength(7);
  for(const day of Object.values(grid))expect(day).toEqual(['morning','noon','evening']);
  expect(playerAvailabilitySlots({preferredDays:[],preferredTimes:['evening'],isAvailableForInvites:true})).toEqual(Object.fromEntries([0,1,2,3,4,5,6].map(d=>[d,['evening']])));
});
test('explicit saved empty grid and opt-out override legacy preferences',()=>{
  expect(playerAvailabilitySlots({...player.availability!,availabilitySlots:{}})).toEqual({});
  expect(playerAvailabilitySlots({...player.availability!,isAvailableForInvites:false})).toEqual({});
  expect(playerAvailabilitySlots(player.availability)).toEqual({3:['evening'],5:['morning']});
});
test('search accepts partial names with diacritics and bidi marks',()=>{
  expect(normalizePlayerSearch('  ⁦אִיתַי⁩  לוי ')).toBe('איתי לוי');
  expect(playerSearchMatches(player,{text:'איתי',city:'יהודה'})).toBe(true);
  expect(playerSearchMatches(player,{friendsOnly:true})).toBe(false);
});
test('precise availability cannot invent the cross product of days and times',()=>{
  expect(playerSearchMatches(player,{day:3,time:'morning'})).toBe(false);
  expect(playerSearchMatches(player,{day:3,time:'evening'})).toBe(true);
  expect(playerSearchMatches(player,{time:'morning'})).toBe(true);
  expect(playerSearchMatches(player,{time:'noon'})).toBe(false);
  expect(playerAvailabilityLines(player.availability)).toEqual(['רביעי · ערב','שישי · בוקר']);
});
test('opted-out availability and deliberately empty slots do not revive old days',()=>{
  const unavailable={...player,availability:{...player.availability!,isAvailableForInvites:false}};
  expect(playerAvailabilityLines(unavailable.availability)).toEqual([]);
  expect(playerSearchMatches(unavailable,{time:'evening'})).toBe(false);
  expect(playerSearchMatches({...player,availability:{...player.availability!,availabilitySlots:{}}},{day:3})).toBe(false);
});

test('multi-select uses any selected day and time but requires an actual matching slot',()=>{
  expect(playerSearchMatches(player,{days:[1,3],times:['noon','evening']})).toBe(true);
  expect(playerSearchMatches(player,{days:[1,3],times:['morning','noon']})).toBe(false);
  expect(playerSearchMatches(player,{days:[1,5]})).toBe(true);
  expect(playerSearchMatches(player,{times:['morning','noon']})).toBe(true);
  expect(playerSearchMatches(player,{days:[],times:[]})).toBe(true);
  expect(playerSearchMatches(player,{days:[3,5],friendsOnly:true})).toBe(false);
  expect(playerSearchMatches({...player,availability:{...player.availability!,isAvailableForInvites:false}},{days:[3,5]})).toBe(false);
});
