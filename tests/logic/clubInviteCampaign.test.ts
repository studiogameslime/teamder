jest.mock('react-native',()=>({Share:{sharedAction:'sharedAction',share:jest.fn()}}));
jest.mock('@/services/groupService',()=>({groupService:{get:jest.fn()}}));
jest.mock('@/store/userStore',()=>({useUserStore:{getState:jest.fn()}}));
jest.mock('@/services/inviteLinkService',()=>({createShortInviteUrl:jest.fn(async()=> 'https://example.test/invite')}));
jest.mock('@/services/deepLinkService',()=>({deepLinkService:{buildInviteUrl:jest.fn(()=> 'https://example.test/long')}}));
jest.mock('@/services/analyticsService',()=>({AnalyticsEvent:{InviteShared:'invite_shared'},logEvent:jest.fn()}));
jest.mock('@/i18n/he',()=>({he:{inviteShareSubject:'הזמנה',communityInviteShareBody:({name,link}:any)=>name+' '+link}}));
import { Share } from 'react-native';
import { groupService } from '@/services/groupService';
import { useUserStore } from '@/store/userStore';
import { createShortInviteUrl } from '@/services/inviteLinkService';
import { logEvent } from '@/services/analyticsService';
import { clubInviteCampaignId, eligibleClubInvite, shareClubInviteCampaign } from '@/services/clubInviteCampaign';

beforeEach(()=>{
 jest.clearAllMocks();
 (useUserStore.getState as jest.Mock).mockReturnValue({currentUser:{id:'owner'}});
 (groupService.get as jest.Mock).mockResolvedValue({id:'club_A',name:'המועדון',adminIds:['owner'],playerIds:['owner'],isPersonal:false});
 (Share.share as jest.Mock).mockResolvedValue({action:'sharedAction'});
});
test.each(['https://evil.test/club_A','footy://club-invite/{{ trigger.properties.groupId }}','footy://club-invite/a%2Fb','footy://club-invite/club_A?other=1'])('rejects an unrelated, unresolved or ambiguous action %s',url=>expect(clubInviteCampaignId(url)).toBeNull());
test('uses the campaign club, never the selected club, and attributes to the signed-in organiser',async()=>{
 await shareClubInviteCampaign('footy://club-invite/club_A','campaign');
 expect(groupService.get).toHaveBeenCalledWith('club_A',{fromServer:true});
 expect(createShortInviteUrl).toHaveBeenCalledWith(expect.objectContaining({id:'club_A',invitedBy:'owner',type:'team'}));
 expect(logEvent).toHaveBeenCalledWith('invite_shared',expect.objectContaining({groupId:'club_A',campaignId:'campaign'}));
});
test.each([null,{id:'club_A',adminIds:['other'],playerIds:[]},{id:'club_A',adminIds:['owner'],playerIds:Array(10).fill('p')},{id:'club_A',adminIds:['owner'],playerIds:[],isPersonal:true}])('does not show or share an ineligible club',async club=>{
 (groupService.get as jest.Mock).mockResolvedValue(club);
 expect(await shareClubInviteCampaign('footy://club-invite/club_A','campaign')).toBe(false);
 expect(Share.share).not.toHaveBeenCalled();expect(logEvent).not.toHaveBeenCalled();
});
test('changing accounts while a roster is loading cannot share under the next identity',async()=>{
 (groupService.get as jest.Mock).mockImplementation(async()=>{
   (useUserStore.getState as jest.Mock).mockReturnValue({currentUser:{id:'other'}});
   return {id:'club_A',adminIds:['owner','other'],playerIds:[]};
 });
 expect(await eligibleClubInvite('footy://club-invite/club_A')).toBeNull();
 expect(Share.share).not.toHaveBeenCalled();
});
test('a dismissed share sheet is not a completed invitation',async()=>{
 (Share.share as jest.Mock).mockResolvedValue({action:'dismissedAction'});
 expect(await shareClubInviteCampaign('footy://club-invite/club_A','campaign')).toBe(false);
 expect(logEvent).not.toHaveBeenCalled();
});
test('a roster read error remains a failure, never an empty eligible club',async()=>{
 (groupService.get as jest.Mock).mockRejectedValue(Error('offline'));
 await expect(eligibleClubInvite('footy://club-invite/club_A')).rejects.toThrow('offline');
});
