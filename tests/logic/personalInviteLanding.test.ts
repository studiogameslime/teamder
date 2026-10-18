jest.mock('@/services/personalInvite', () => ({ resolveInviteActivity: jest.fn(), MAX_CLUBS: 3 }));
jest.mock('@/services/socialPlayersService', () => ({ socialPlayersService: {profile: jest.fn()} }));
jest.mock('@/services/groupService', () => ({ groupService: {getPublic: jest.fn()} }));
import {resolveInviteLandingActivity} from '@/services/personalInviteLanding';
import {resolveInviteActivity} from '@/services/personalInvite';
import {socialPlayersService} from '@/services/socialPlayersService';
import {groupService} from '@/services/groupService';
const activity=resolveInviteActivity as jest.Mock, profile=socialPlayersService.profile as jest.Mock, mirror=groupService.getPublic as jest.Mock;
beforeEach(()=>{jest.resetAllMocks();activity.mockResolvedValue({games:[],clubs:[]});profile.mockResolvedValue({clubs:[]});mirror.mockImplementation(async id=>({id,name:`מועדון ${id}`,memberCount:12}));});
test('anonymous browsing never calls the full-account profile or private membership APIs',async()=>{
 activity.mockResolvedValue({games:[{id:'g'}],clubs:[{id:'c'}]});
 expect(await resolveInviteLandingActivity('inviter','guest',true)).toEqual({games:[{id:'g'}],clubs:[{id:'c'}]});
 expect(profile).not.toHaveBeenCalled();expect(mirror).not.toHaveBeenCalled();
});
test('a full account sees publicly mirrored clubs even without an upcoming round',async()=>{
 profile.mockResolvedValue({clubs:[{id:'a',name:'private payload must not render'},{id:'a'},{id:'b'}]});
 const result=await resolveInviteLandingActivity('inviter','viewer',false);
 expect(profile).toHaveBeenCalledWith('inviter');expect(mirror.mock.calls).toEqual([['a'],['b']]);
 expect(result.games).toEqual([]);expect(result.clubs.map(c=>c.name)).toEqual(['מועדון a','מועדון b']);
});
test('profile failures preserve public rounds and clubs, with a retryable partial state',async()=>{
 profile.mockRejectedValue(Error('profile denied'));activity.mockResolvedValue({games:[{id:'g',startsAt:1}],clubs:[{id:'c'}]});
 expect(await resolveInviteLandingActivity('inviter','viewer',false)).toMatchObject({games:[{id:'g'}],clubs:[{id:'c'}],clubsUnavailable:true});
});
test('a discovery failure does not claim there is no upcoming round or discard independently loaded clubs',async()=>{
 activity.mockRejectedValue(Error('offline'));profile.mockResolvedValue({clubs:[{id:'a'}]});
 expect(await resolveInviteLandingActivity('inviter','viewer',false)).toMatchObject({gamesUnavailable:true,clubs:[{id:'a'}]});
});
test('failed or absent public mirrors never fall back to private club payloads',async()=>{
 profile.mockResolvedValue({clubs:[{id:'hidden',name:'secret'},{id:'failed'},{id:'good'},{id:'over-cap'}]});
 mirror.mockImplementation(async id=>{if(id==='failed')throw Error('offline');return id==='hidden'?null:{id,name:'public'};});
 const result=await resolveInviteLandingActivity('inviter','viewer',false);
 expect(result.clubs).toEqual([{id:'good',name:'public'}]);expect(result.clubsUnavailable).toBe(true);expect(mirror).toHaveBeenCalledTimes(3);
});
test('both requests failing propagates the error instead of a fabricated empty state',async()=>{
 activity.mockRejectedValue(Error('offline'));profile.mockRejectedValue(Error('denied'));
 await expect(resolveInviteLandingActivity('inviter','viewer',false)).rejects.toThrow('offline');
});
