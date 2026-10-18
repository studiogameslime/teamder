import React from 'react';

let mockSlots:any[]=[],mockHook=0,mockPending:{index:number;effect:()=>void|(()=>void)}[]=[];
let mockFocus:(()=>void)|null=null;
let mockViewer:any={id:'manager',isGuest:false};
const mockHydrate=jest.fn().mockResolvedValue(undefined);
jest.mock('react',()=>({...jest.requireActual('react'),
  useState:(initial:any)=>{const index=mockHook++;if(!mockSlots[index])mockSlots[index]={value:typeof initial==='function'?initial():initial};
    return[mockSlots[index].value,(next:any)=>{mockSlots[index].value=typeof next==='function'?next(mockSlots[index].value):next;}];},
  useRef:(initial:any)=>{const index=mockHook++;if(!mockSlots[index])mockSlots[index]={current:initial};return mockSlots[index];},
  useMemo:(fn:()=>unknown)=>fn(),useCallback:(fn:unknown)=>fn,
  useEffect:(effect:()=>void|(()=>void),deps:any[])=>{const index=mockHook++,previous=mockSlots[index];
    if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps[i])))mockPending.push({index,effect});
    mockSlots[index]={...previous,deps};},
}));
jest.mock('react-native',()=>({View:'View',Text:'Text',Pressable:'Pressable',StyleSheet:{create:(value:unknown)=>value}}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:'SafeAreaView'}));
jest.mock('@react-navigation/native',()=>({useRoute:()=>({params:{}}),useFocusEffect:(fn:()=>void)=>{mockFocus=fn;}}));
jest.mock('@expo/vector-icons',()=>({Ionicons:'Icon'}));
jest.mock('@/components/ScreenHeader',()=>({ScreenHeader:'Header'}));
jest.mock('@/components/SoccerBallLoader',()=>({SoccerBallLoader:'Loader'}));
jest.mock('@/components/ScrollSurface',()=>({ScrollSurface:'Scroll'}));
jest.mock('@/components/match/tabs/MatchTabShell',()=>({TabScroll:'TabScroll'}));
jest.mock('@/components/UserAvatar',()=>({UserAvatar:'Avatar'}));
jest.mock('@/services/gameService',()=>({gameService:{getGameById:jest.fn(),getRoundHistory:jest.fn()}}));
jest.mock('@/services/errorLog',()=>({logError:jest.fn()}));
jest.mock('@/services/analyticsService',()=>({logEvent:jest.fn(),AnalyticsEvent:{MatchRoundsOpened:'rounds'}}));
jest.mock('@/store/gameStore',()=>({useGameStore:(select:any)=>select({players:{},hydratePlayers:mockHydrate})}));
jest.mock('@/store/userStore',()=>({useUserStore:Object.assign((select:any)=>select({currentUser:mockViewer}),{getState:()=>({currentUser:mockViewer})})}));
jest.mock('@/utils/draft',()=>jest.requireActual('@/utils/teamIdentity'));
jest.mock('@/components/match/rotationView',()=>({teamColor:(index:number,teams:any[])=>{
  const identity=jest.requireActual('@/utils/teamIdentity');return(identity.chosenFor(index,teams)??identity.TEAM_PALETTE[index])?.hex??'#2563EB';
}}));
jest.mock('@/theme',()=>({colors:{primary:'#2563EB',text:'#12234D',textMuted:'#64748B',surface:'#FFF',border:'#CBD5E1',bg:'#F8FAFC',divider:'#E2E8F0'},spacing:{sm:8,md:12,lg:16,xl:24,xxl:32},typography:{body:{},h3:{},caption:{}},RTL_LABEL_ALIGN:'left'}));
jest.mock('@/i18n/he',()=>({he:{matchRoundsTitle:'משחקים',matchRoundsLiveTitle:'משחקים במחזור',matchRoundsEmptyTitle:'אין משחקים שמורים',matchRoundsEmptySub:'אין תיעוד',matchRoundsLiveEmptyTitle:'טרם הסתיים משחק',matchRoundsLiveEmptySub:'יופיע בהמשך',gdGamesNoCoverageTitle:'אין תיעוד',gdGamesNoCoverageBody:'חסר כיסוי',gdGamesEmptyTitle:'המחזור עוד לא שוחק',gdGamesEmptyBody:'יופיע בהמשך',matchRoundsCount:(n:number)=>`${n} משחקים`,matchRoundsCountFiltered:(n:number,total:number)=>`${n} מתוך ${total}`,
  matchRoundsRoundN:(n:number)=>`משחק ${n}`,matchRoundsWon:(name:string)=>`${name} ניצחו`,matchRoundsWonLegacy:(name:string)=>`${name} ניצחה`,matchRoundsWonPens:(name:string)=>`${name} בפנדלים`,matchRoundsVsKeeper:(name:string)=>`מול ${name}`,matchRoundsUnknownPlayer:'שחקן',matchRoundsGuest:'אורח',matchRoundsAssist:(name:string)=>`בישול: ${name}`}}));

import { MatchRoundsScreen } from '@/screens/games/MatchRoundsScreen';
import { gameService } from '@/services/gameService';
import { logEvent } from '@/services/analyticsService';
const getGame=gameService.getGameById as jest.Mock,getRounds=gameService.getRoundHistory as jest.Mock;
const game=(id='one',colorKey='green')=>({id,guests:[],draftTeams:{teams:[{index:0,colorKey,playerIds:['p0']},{index:1,colorKey:'blue',playerIds:['p1']}]}});
const round=(id='saved')=>({roundId:id,teamA:['p0'],teamB:['p1'],teamAIndex:0,teamBIndex:1,scoreA:1,scoreB:0,winnerSide:'A',goals:[],at:1});
function render(gameId='one',extra:any={}) {mockHook=0;return MatchRoundsScreen({gameId,live:true,...extra});}
function effects(){const pending=mockPending;mockPending=[];for(const {index,effect}of pending){mockSlots[index].cleanup?.();mockSlots[index].cleanup=effect();}}
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
const nodes=(node:any):any[]=>!node||typeof node!=='object'?[]:[node,...React.Children.toArray(node.props?.children).flatMap(nodes)];
const copy=(node:any):string=>{if(typeof node==='string'||typeof node==='number')return String(node);return node&&typeof node==='object'?React.Children.toArray(node.props?.children).map(copy).join(' '):'';};
const cards=(node:any)=>nodes(node).filter(n=>typeof n.type==='function'&&n.type.name==='RoundCard');
const retry=(node:any)=>nodes(node).find(n=>n.props?.testID==='match-rounds-retry');
const deferred=()=>{let resolve!:(value:any)=>void;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
beforeEach(()=>{mockSlots=[];mockHook=0;mockPending=[];mockFocus=null;mockViewer={id:'manager',isGuest:false};jest.clearAllMocks();
  getGame.mockReset().mockResolvedValue(game());getRounds.mockReset().mockResolvedValue([round()]);});

test.each(['game','history'])('initial %s failure shows retry rather than an empty history, and retry recovers',async kind=>{
  (kind==='game'?getGame:getRounds).mockRejectedValueOnce(Error('offline'));
  render();mockFocus!();effects();await flush();
  const failed=render();expect(copy(failed)).toContain('לא הצלחנו לטעון את המשחקים');expect(copy(failed)).not.toContain('טרם הסתיים משחק');
  expect(cards(failed)).toHaveLength(0);expect(retry(failed).props.disabled).toBe(false);
  retry(failed).props.onPress();render();effects();
  const waiting=render();expect(retry(waiting).props.disabled).toBe(true);expect(copy(waiting)).toContain('טוענים…');
  await flush();const recovered=render();expect(cards(recovered)).toHaveLength(1);expect(retry(recovered)).toBeUndefined();
});

test('a genuinely empty successful history remains empty without an error',async()=>{
  getRounds.mockResolvedValueOnce([]);render();effects();await flush();const empty=render();
  expect(copy(empty)).toContain('טרם הסתיים משחק');expect(retry(empty)).toBeUndefined();
});

test.each(['game','history'])('failed %s refresh retains the previous round, identities and filter source; retry updates',async kind=>{
  render();mockFocus!();effects();await flush();const first=render();expect(cards(first)).toHaveLength(1);
  (kind==='game'?getGame:getRounds).mockRejectedValueOnce(Error('offline-refresh'));
  mockFocus!();render();effects();await flush();const failed=render();
  expect(copy(failed)).toContain('לא הצלחנו לעדכן את המשחקים');expect(cards(failed)[0].props.round.roundId).toBe('saved');
  expect(cards(failed)[0].props.teams[0].colorKey).toBe('green');
  getGame.mockResolvedValueOnce(game('one','orange'));getRounds.mockResolvedValueOnce([round(),round('next')]);
  retry(failed).props.onPress();render();effects();await flush();const fresh=render();
  expect(cards(fresh)).toHaveLength(2);expect(cards(fresh)[0].props.teams[0].colorKey).toBe('orange');expect(retry(fresh)).toBeUndefined();
});

test('changing game hides the old round before effects and ignores its late response',async()=>{
  render();mockFocus!();effects();await flush();render();
  const old=deferred();getRounds.mockReturnValueOnce(old.promise);mockFocus!();render();effects();
  getGame.mockResolvedValueOnce(game('two'));getRounds.mockResolvedValueOnce([round('new-game')]);
  const switching=render('two');expect(cards(switching)).toHaveLength(0);expect(nodes(switching).some(n=>n.type==='Loader')).toBe(true);
  effects();await flush();expect(cards(render('two'))[0].props.round.roundId).toBe('new-game');
  old.resolve([round('late-old')]);await flush();expect(cards(render('two'))[0].props.round.roundId).toBe('new-game');
});

test('a session change invalidates a pending response before a rerender and never hydrates its identities',async()=>{
  const pending=deferred();getRounds.mockReturnValueOnce(pending.promise);render();effects();
  mockViewer={id:'other-manager',isGuest:false};pending.resolve([round('old-account')]);await flush();
  expect(logEvent).not.toHaveBeenCalled();expect(mockHydrate).not.toHaveBeenCalled();
  getGame.mockResolvedValueOnce(game());getRounds.mockResolvedValueOnce([round('new-account')]);
  const switched=render();expect(cards(switched)).toHaveLength(0);effects();await flush();
  expect(cards(render())[0].props.round.roundId).toBe('new-account');
});

test('a previously loaded account is hidden synchronously when the session identity changes',async()=>{
  render();effects();await flush();expect(cards(render())).toHaveLength(1);
  mockViewer={id:'another',isGuest:false};expect(cards(render())).toHaveLength(0);
});

test('a missing game or absent session cannot look like a successful empty round',async()=>{
  getGame.mockResolvedValueOnce(null);render();effects();await flush();expect(retry(render())).toBeDefined();
  mockViewer=null;render('two');effects();await flush();expect(cards(render('two'))).toHaveLength(0);expect(retry(render('two'))).toBeDefined();
  expect(getGame).toHaveBeenCalledTimes(1);expect(getRounds).toHaveBeenCalledTimes(1);
});

test('the first focus does not duplicate the initial load; a real refocus reloads',async()=>{
  render();mockFocus!();render();effects();await flush();render();expect(getRounds).toHaveBeenCalledTimes(1);
  mockFocus!();render();effects();await flush();expect(getRounds).toHaveBeenCalledTimes(2);
});

test('a response after unmount does not publish data or hydrate users',async()=>{
  const pending=deferred();getRounds.mockReturnValueOnce(pending.promise);render();effects();
  for(const slot of mockSlots)slot.cleanup?.();pending.resolve([round()]);await flush();
  expect(mockHydrate).not.toHaveBeenCalled();expect(logEvent).not.toHaveBeenCalled();
});

test('the rendered history distinguishes goal, save, miss and unclassified legacy failure',async()=>{
  getRounds.mockResolvedValueOnce([{...round(),penalties:[
    {kickerId:'p0',keeperId:'p1',team:'A',scored:true,outcome:'goal'},
    {kickerId:'p1',keeperId:'p0',team:'B',scored:false,outcome:'save'},
    {kickerId:'p0',keeperId:'p1',team:'A',scored:false,outcome:'miss'},
    {kickerId:'p1',keeperId:'p0',team:'B',scored:false},
  ]}]);
  render();effects();await flush();const element=cards(render())[0];const detail=element.type(element.props);
  for(const result of ['גול','עצירה','החטאה','לא הובקע'])expect(copy(detail)).toContain(result);
});

test('a registered guest assist survives the history resolver without a user lookup',async()=>{
  getGame.mockResolvedValueOnce({...game(),guests:[{id:'scorer',name:'אורח כובש'},{id:'assist',name:'אורח מבשל'}]});
  getRounds.mockResolvedValueOnce([{...round(),teamA:['guest:scorer','guest:assist'],teamB:[],goals:[{scorerId:'guest:scorer',assisterId:'guest:assist',team:'A'}]}]);
  render();effects();await flush();const element=cards(render())[0];const detail=element.type(element.props);
  expect(copy(detail)).toContain('אורח כובש');expect(copy(detail)).toContain('בישול: אורח מבשל');
  expect(mockHydrate).not.toHaveBeenCalled();
});

test('opening colours win over the allocation colour while the original roster stays available',async()=>{
  const current=game();const original=current.draftTeams.teams.map(team=>({...team,colorKey:team.index===0?'red':'blue',playerIds:[`original-${team.index}`]}));
  getGame.mockResolvedValueOnce({...current,draftTeams:{...current.draftTeams,originalTeams:original}});
  render();effects();await flush();const element=cards(render())[0];const detail=element.type(element.props);
  expect(copy(detail)).toContain('הירוקים ניצחו');expect(copy(detail)).not.toContain('האדומים ניצחו');
  expect(element.props.teams[0].playerIds).toEqual(['original-0']);
  expect(nodes(detail).some(node=>Object.assign({},...[node.props?.style].flat()).backgroundColor==='#22C55E')).toBe(true);
});

test('an index-less historical round matches original players but uses the chosen live identity',async()=>{
  const current={...game(),draftTeams:{teams:[{index:0,colorKey:'green',playerIds:['old-b']},{index:1,colorKey:'orange',playerIds:['old-a']}],
    originalTeams:[{index:0,colorKey:'red',playerIds:['old-a']},{index:1,colorKey:'blue',playerIds:['old-b']}]}};
  getGame.mockResolvedValueOnce(current);getRounds.mockResolvedValueOnce([{...round(),teamAIndex:-1,teamBIndex:-1,teamA:['old-a'],teamB:['old-b']}]);
  render();effects();await flush();const element=cards(render())[0];const detail=element.type(element.props);
  expect(copy(detail)).toContain('הירוקים ניצחו');expect(copy(detail)).not.toContain('הכתומים ניצחו');
});

test('a long scorer and assist receive independent wrapping lines instead of competing for one row',async()=>{
  const scorerName='אלכסנדר בן יהודה לוי כהן',assistName='אלרואי שם משפחה ארוך';
  getGame.mockResolvedValueOnce({...game(),guests:[{id:'long-scorer',name:scorerName},{id:'long-assist',name:assistName}]});
  getRounds.mockResolvedValueOnce([{...round(),teamA:['guest:long-scorer','guest:long-assist'],teamB:[],goals:[{scorerId:'guest:long-scorer',assisterId:'guest:long-assist',team:'A',minute:12}]}]);
  render();effects();await flush();const element=cards(render())[0],detail=element.type(element.props);
  const details=nodes(detail).find(node=>node.type==='View'&&React.Children.toArray(node.props.children).length===2&&
    React.Children.toArray(node.props.children).every((child:any)=>child.type==='Text')&&copy(node).includes(scorerName)&&copy(node).includes(assistName));
  expect(details).toBeDefined();expect(details.props.style.flexDirection).not.toBe('row');
  expect(details.props.style.flex).toBe(1);expect(details.props.style.minWidth).toBe(0);
  for(const line of React.Children.toArray(details.props.children) as any[])expect(line.props.numberOfLines).toBeUndefined();
});
