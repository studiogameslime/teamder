import {playerDiscoveryMatches} from '../../src/utils/socialPlayers';
import type {SocialPlayer} from '../../src/types/social';
const player:SocialPlayer={id:'matan',name:'מתן לוי',city:'קרית עקרון',friend:true,sharedRounds:12,commonClubCount:1};
test('discovery excludes existing friends unless their explicit filter is enabled',()=>{
  expect(playerDiscoveryMatches(player,{})).toBe(false);
  expect(playerDiscoveryMatches(player,{text:'מתן'})).toBe(false);
  expect(playerDiscoveryMatches(player,{friendsOnly:true})).toBe(true);
  expect(playerDiscoveryMatches(player,{friendsOnly:true,city:'חיפה'})).toBe(false);
  expect(playerDiscoveryMatches({...player,friend:false},{})).toBe(true);
  expect(playerDiscoveryMatches({...player,friend:false},{friendsOnly:true})).toBe(false);
});
