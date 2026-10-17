import React from 'react';
let mockMe:any={id:'viewer',isGuest:true},mockInviter='inviter';
const mockNav={navigate:jest.fn()},mockAuth=jest.fn();
jest.mock('react',()=>{
  let slots:any[]=[],index=0,pending:Array<()=>void>=[];
  const same=(a?:any[],b?:any[])=>!!a&&!!b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const hooks:any={...jest.requireActual('react'),
    __runtime:{begin:()=>{index=0;},effects:()=>{const effects=pending;pending=[];effects.forEach(fn=>fn());},reset:()=>{slots.forEach(slot=>slot?.cleanup?.());slots=[];index=0;pending=[];}},
    useState:(initial:any)=>{const i=index++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,(next:any)=>{slots[i].value=typeof next==='function'?next(slots[i].value):next;}];},
    useRef:(initial:any)=>{const i=index++;return slots[i]??(slots[i]={current:initial});},
    useMemo:(fn:any,deps:any[])=>{const i=index++;if(!same(slots[i]?.deps,deps))slots[i]={deps,value:fn()};return slots[i].value;},
    useCallback:(fn:any,deps:any[])=>hooks.useMemo(()=>fn,deps),
    useEffect:(effect:any,deps:any[])=>{const i=index++;if(!same(slots[i]?.deps,deps)){const previous=slots[i];slots[i]={deps};pending.push(()=>{previous?.cleanup?.();slots[i].cleanup=effect();});}},
  };return hooks;
});

jest.mock('react-native',()=>({Image:'Image',Pressable:'Pressable',ScrollView:'ScrollView',Text:'Text',View:'View',StyleSheet:{create:(v:any)=>v}}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:'SafeAreaView'}));
jest.mock('@react-navigation/native',()=>({useRoute:()=>({params:{invitedBy:mockInviter}}),useNavigation:()=>mockNav}));
jest.mock('@expo/vector-icons',()=>({Ionicons:'Icon'}));
jest.mock('@/components/Button',()=>({Button:'Button'}));
jest.mock('@/components/Card',()=>({Card:'Card'}));
jest.mock('@/components/UserAvatar',()=>({UserAvatar:'Avatar'}));
jest.mock('@/components/profile/FriendActionButton',()=>({FriendActionButton:'FriendAction'}));
jest.mock('@/hooks/useAuthenticatedAction',()=>({useAuthenticatedAction:()=>({requestAuth:mockAuth,sheet:null})}));
jest.mock('@/components/anim/MatchCardSkeleton',()=>({MatchCardSkeleton:'Skeleton'}));
jest.mock('@/components/anim/AppearItem',()=>({AppearItem:'AppearItem'}));
jest.mock('@/services/personalInvite',()=>({resolveInviter:jest.fn()}));
jest.mock('@/services/personalInviteLanding',()=>({resolveInviteLandingActivity:jest.fn()}));
jest.mock('@/services/analyticsService',()=>({AnalyticsEvent:{},logEvent:jest.fn()}));
jest.mock('@/store/userStore',()=>({useUserStore:(select:any)=>select({currentUser:mockMe})}));
jest.mock('@/data/roundCover',()=>({resolveRoundCover:()=>1}));
jest.mock('@/data/coverImages',()=>({getCoverSource:()=>1}));
jest.mock('@/theme',()=>({colors:{},RTL_LABEL_ALIGN:'left'}));
import {PersonalInviteScreen} from '@/screens/invite/PersonalInviteScreen';
import {resolveInviter} from '@/services/personalInvite';
import {resolveInviteLandingActivity} from '@/services/personalInviteLanding';
const identity=resolveInviter as jest.Mock,activity=resolveInviteLandingActivity as jest.Mock;
const runtime=(require('react') as any).__runtime;
const children=(n:any)=>React.Children.toArray(n?.props?.children);
const nodes=(n:any):any[]=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(children(n))];
const copy=(n:any):string=>typeof n==='string'?n:Array.isArray(n)?n.map(copy).join(' '):n&&typeof n==='object'?copy(children(n)):'';
const render=()=>{runtime.begin();const t=PersonalInviteScreen();runtime.effects();return t;};
const settle=async()=>{await new Promise(setImmediate);return render();};
beforeEach(()=>{runtime.reset();jest.clearAllMocks();mockMe={id:'viewer',isGuest:true};mockInviter='inviter';identity.mockResolvedValue({inviter:{id:'inviter',name:'אלירן',avatarId:'a13',photoUrl:'https://example.test/avatar.jpg'}});activity.mockResolvedValue({games:[],clubs:[{id:'club',name:'המועדון'}]});});
test('guest sees one inviter name and the real identity image; friendship opens auth without a write',async()=>{
 render();const tree=await settle();expect(copy(tree).match(/אלירן/g)).toHaveLength(1);
 expect(nodes(tree).find(n=>n.type==='Avatar').props.user.photoUrl).toBe('https://example.test/avatar.jpg');
 expect(nodes(tree).some(n=>n.type==='FriendAction')).toBe(false);
 nodes(tree).find(n=>n.type==='Button'&&n.props.title==='התחבר להוספה לחברים').props.onPress();expect(mockAuth).toHaveBeenCalledTimes(1);
 expect(activity).toHaveBeenCalledWith('inviter','viewer',true);
});
test('upgrading an existing guest identity reloads clubs and shows the existing relationship action, without sending automatically',async()=>{
 render();await settle();mockMe={id:'viewer',isGuest:false};render();const tree=await settle();
 expect(activity).toHaveBeenLastCalledWith('inviter','viewer',false);
 expect(nodes(tree).find(n=>n.type==='FriendAction').props).toMatchObject({meId:'viewer',otherUserId:'inviter'});
 expect(mockAuth).not.toHaveBeenCalled();
});
test('no upcoming round still renders independently loaded clubs and opens the public club route',async()=>{
 render();const tree=await settle();expect(nodes(tree).some(n=>n.props.title==='אין כרגע מחזור קרוב שמוצג לך')).toBe(true);
 const club=nodes(tree).find(n=>n.props.club?.id==='club');club.props.onPress();expect(mockNav.navigate).toHaveBeenCalledWith('CommunityDetailsPublic',{groupId:'club'});
});
test('discovery failure is retryable and is never displayed as no upcoming round',async()=>{
 activity.mockRejectedValueOnce(Error('offline'));render();let tree=await settle();
 expect(nodes(tree).some(n=>n.props.title==='אין כרגע מחזור קרוב שמוצג לך')).toBe(false);
 const retry=nodes(tree).find(n=>n.props.title==='הפעילות לא נטענה').props.retry;await retry();tree=await settle();
 expect(nodes(tree).some(n=>n.props.club?.id==='club')).toBe(true);
});
test('a response for a previous invitation cannot replace the new person or activity',async()=>{
 let finish!:(v:any)=>void;activity.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));render();
 mockInviter='new';identity.mockResolvedValue({inviter:{id:'new',name:'חדש'}});activity.mockResolvedValue({games:[],clubs:[]});render();await settle();
 finish({games:[{id:'old-game'}],clubs:[{id:'old-club'}]});const tree=await settle();
 expect(copy(tree)).not.toContain('אלירן');expect(copy(tree)).toContain('חדש');expect(nodes(tree).some(n=>n.props.club?.id==='old-club')).toBe(false);
});
test('a missing inviter and a self invitation offer no friendship action',async()=>{
 mockInviter=undefined as any;identity.mockResolvedValue({inviter:null});render();let tree=await settle();expect(nodes(tree).some(n=>n.type==='FriendAction')).toBe(false);
 runtime.reset();mockInviter='viewer';identity.mockResolvedValue({inviter:{id:'viewer',name:'אני'}});render();tree=await settle();expect(nodes(tree).some(n=>n.type==='FriendAction'||n.props.title==='התחבר להוספה לחברים')).toBe(false);
});
