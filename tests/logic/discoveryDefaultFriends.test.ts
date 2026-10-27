import {playerDiscoveryMatches} from '../../src/utils/socialPlayers';
import type {SocialPlayer} from '../../src/types/social';
const player:SocialPlayer={id:'matan',name:'מתן לוי',city:'קרית עקרון',friend:true,sharedRounds:12,commonClubCount:1};
test('all-player discovery includes existing friends and supports their partial names',()=>{
  expect(playerDiscoveryMatches(player,{})).toBe(true);
  expect(playerDiscoveryMatches(player,{text:'מתן'})).toBe(true);
  expect(playerDiscoveryMatches(player,{text:'לוי'})).toBe(true);
  expect(playerDiscoveryMatches(player,{text:'  ⁦מָתָן⁩  לוי '})).toBe(true);
  expect(playerDiscoveryMatches(player,{friendsOnly:true})).toBe(true);
  expect(playerDiscoveryMatches(player,{friendsOnly:true,city:'חיפה'})).toBe(false);
  expect(playerDiscoveryMatches({...player,friend:false},{})).toBe(true);
  expect(playerDiscoveryMatches({...player,friend:false},{friendsOnly:true})).toBe(false);
});

test('friendship does not bypass name, city or availability filters',()=>{
  expect(playerDiscoveryMatches(player,{text:'איתי'})).toBe(false);
  expect(playerDiscoveryMatches(player,{city:'חיפה'})).toBe(false);
  expect(playerDiscoveryMatches(player,{day:3})).toBe(false);
  expect(playerDiscoveryMatches({...player,availability:{preferredDays:[3],isAvailableForInvites:true,availabilitySlots:{3:['evening']}}},{days:[3],times:['evening']})).toBe(true);
});
