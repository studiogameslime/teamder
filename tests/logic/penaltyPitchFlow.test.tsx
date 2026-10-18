jest.mock('@/services/errorLog',()=>({logError:jest.fn()}));
import React from 'react';

let mockSlots: any[] = [];
let mockCursor = 0;
let mockEffects: Array<() => void> = [];
let mockChanged = false;
let mockWindow = {height:820,width:390,fontScale:1};
const mockRecord = jest.fn();
const mockStart = jest.fn();
const mockChangeFirst = jest.fn();
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: any) => {
    const index = mockCursor++;
    if (!(index in mockSlots)) mockSlots[index] = typeof initial === 'function' ? initial() : initial;
    return [mockSlots[index], (next: any) => { const value = typeof next === 'function' ? next(mockSlots[index]) : next; if (value !== mockSlots[index]) mockChanged = true; mockSlots[index] = value; }];
  },
  useRef: (initial: any) => { const index = mockCursor++; if (!(index in mockSlots)) mockSlots[index] = { current: initial }; return mockSlots[index]; },
  useMemo: (factory: () => unknown) => { mockCursor++; return factory(); },
  useEffect: (effect: () => void, dependencies?: any[]) => {
    const index = mockCursor++, previous = mockSlots[index];
    if (!previous || !dependencies || dependencies.some((value, item) => value !== previous.dependencies?.[item])) {
      mockEffects.push(effect); mockSlots[index] = { dependencies };
    }
  },
}));
jest.mock('react-native', () => ({ ActivityIndicator:'Busy', Pressable:'Pressable', ScrollView:'ScrollView', Text:'Text', View:'View', StyleSheet:{ create:(value:unknown)=>value, hairlineWidth:1, absoluteFill:{} }, useWindowDimensions:()=>mockWindow }));
jest.mock('@expo/vector-icons',()=>({Ionicons:'Icon'}));
jest.mock('@/components/SafeModal',()=>({SafeModal:'Modal'}));
jest.mock('@/components/UserAvatar',()=>({UserAvatar:'Avatar'}));
jest.mock('@/components/match/MatchActionPitch',()=>({MatchActionPitch:'Pitch'}));
jest.mock('@/components/match/MatchPlayerPicker',()=>({MatchPlayerPicker:'Picker'}));
jest.mock('@/components/match/TeamShirt',()=>({TeamShirtIllustration:'Shirt'}));
jest.mock('@/components/match/rotationView',()=>({
  makeResolver:(players:any)=> (id:string)=>players[id]??{},
  buildRoster:(index:number,teams:any[],_rotation:unknown,resolve:(id:string)=>any)=>teams.find(team=>team.index===index)?.playerIds.map((id:string)=>({id,name:resolve(id).displayName??id,avatarId:resolve(id).avatarId,photoUrl:resolve(id).photoUrl,isFiller:false}))??[],
  teamName:(index:number)=>['האדומים','הכחולים','הירוקים'][index],
  teamColor:(index:number)=>['#EF4444','#3B82F6','#22C55E'][index],
  teamTextColor:(index:number)=>['#B91C1C','#1D4ED8','#15803D'][index],
}));
jest.mock('@/services/gameService',()=>({gameService:{recordShootoutKick:(...args:any[])=>mockRecord(...args),startShootout:(...args:any[])=>mockStart(...args),changeShootoutFirstTeam:(...args:any[])=>mockChangeFirst(...args),setShootoutKeeper:jest.fn(),undoLastShootoutKick:jest.fn(),updateLastShootoutKick:jest.fn()}}));
jest.mock('@/services/rotationEngine',()=>({roundCommitKey:()=> 'round-one'}));
jest.mock('@/services/analyticsService',()=>({AnalyticsEvent:{},logEvent:jest.fn()}));
jest.mock('@/theme',()=>({RTL_LABEL_ALIGN:'left'}));
import { Shootout } from '@/components/match/ShootoutWizard';

function find(node:any,type:string):any[] {
  if(!node||typeof node!=='object')return [];
  if(Array.isArray(node))return node.flatMap(child=>find(child,type));
  return [...(node.type===type?[node]:[]),...find(node.props?.children,type)];
}
function content(node:any):string {
  if(node==null||typeof node==='boolean')return '';
  if(typeof node==='string'||typeof node==='number')return String(node);
  if(Array.isArray(node))return node.map(content).join('');
  return content(node.props?.children);
}
function properties(){return {visible:true,gameId:'test-round',shootout:{firstTeam:'A',keeperB:'b1',kicks:[]},draftTeams:{teams:[{index:0,playerIds:['a0','a1']},{index:1,playerIds:['b0','b1']},{index:2,playerIds:['waiting']}],leftHome:[]},rotation:{playing:[0,1],waiting:[2],loans:[],round:1},playersMap:{a0:{displayName:'גל'},a1:{displayName:'תומר'},b0:{displayName:'איתי'},b1:{displayName:'אייל'},waiting:{displayName:'ממתין'}},onExit:jest.fn(),onDecided:jest.fn()} as any;}
function draw(input:any):any {
  let tree:any;
  for(let pass=0;pass<8;pass++){
    mockChanged=false;mockCursor=0;mockEffects=[];tree=Shootout(input);
    mockEffects.forEach(effect=>effect());
    if(!mockChanged)return tree;
  }
  throw Error('render loop');
}
const picker=(tree:any)=>find(tree,'Picker')[0];
const pitch=(tree:any)=>find(tree,'Pitch')[0];
const action=(tree:any,label:string)=>find(tree,'Pressable').find(node=>node.props.accessibilityLabel===label||content(node)===label);
async function settle(){await new Promise(resolve=>setImmediate(resolve));}
function choosePeople(input:any){let tree=draw(input);picker(tree).props.onSelect('a0');tree=draw(input);picker(tree).props.onSelect('b0');return draw(input);}

beforeEach(()=>{mockWindow={height:820,width:390,fontScale:1};mockSlots=[];mockCursor=0;mockEffects=[];mockChanged=false;mockRecord.mockReset().mockResolvedValue(undefined);mockStart.mockReset().mockResolvedValue(undefined);});

test.each(['A','B'])('first-team card %s starts directly once and shows only the matching kicking roster',async side=>{
  const input={...properties(),shootout:undefined};let tree=draw(input);
  expect(pitch(tree).props.teamPreview).toBe(true);
  const first=action(tree,`${side==='A'?'האדומים':'הכחולים'} בועטים ראשונים`);
  let acknowledge!:()=>void;mockStart.mockImplementationOnce(()=>new Promise<void>(done=>{acknowledge=done;}));
  first.props.onPress();first.props.onPress();tree=draw(input);
  expect(mockStart).toHaveBeenCalledTimes(1);expect(mockStart).toHaveBeenCalledWith('test-round',side,'round-one');
  expect(action(tree,'הגרלת הבועטים הראשונים').props.disabled).toBe(true);
  acknowledge();await settle();tree=draw(input);
  expect(picker(tree).props.players.map((p:any)=>p.id)).toEqual(side==='A'?['a0','a1']:['b0','b1']);
});

test.each([4,7,11])('first-team previews show actual names and avatar data from each playing roster of %i, with an exact remainder',size=>{
  const input={...properties(),shootout:undefined};
  input.rotation.playing=[2,0];
  input.draftTeams.teams=[0,1,2].map(index=>({index,playerIds:Array.from({length:size},(_,i)=>`team${index}-${i}`)}));
  input.playersMap=Object.fromEntries(input.draftTeams.teams.flatMap((team:any)=>team.playerIds.map((id:string,i:number)=>[id,{displayName:`שם אמיתי ארוך ${id}`,avatarId:`avatar${i}`,photoUrl:`https://example.test/${id}.jpg`}])));
  const tree=draw(input),green=action(tree,'הירוקים בועטים ראשונים'),red=action(tree,'האדומים בועטים ראשונים');
  for(const [card,index] of [[green,2],[red,0]] as const){
    const avatars=find(card,'Avatar');expect(avatars).toHaveLength(2);
    expect(avatars.map(n=>n.props.user.id)).toEqual([`team${index}-0`,`team${index}-1`]);
    avatars.forEach(n=>expect(n.props.user).toMatchObject({avatarId:input.playersMap[n.props.user.id].avatarId,photoUrl:input.playersMap[n.props.user.id].photoUrl,name:input.playersMap[n.props.user.id].displayName}));
    expect(content(action(tree,`הצגת ההרכב של ${index===2?'הירוקים':'האדומים'}`))).toContain(`ועוד ${size-2} שחקנים`);expect(content(card)).toContain(`שם אמיתי ארוך team${index}-0`);
    expect(card.props.accessibilityHint).toContain(`team${index}-${size-1}`);
  }
  expect(content(tree)).not.toContain('team1-');
});

test.each([0,1,2,3])('a short %i-player preview never invents players or a negative remaining count',size=>{
  const input={...properties(),shootout:undefined};input.draftTeams.teams[0].playerIds=Array.from({length:size},(_,i)=>`a${i}`);
  const tree=draw(input),card=action(tree,'האדומים בועטים ראשונים');expect(find(card,'Avatar')).toHaveLength(Math.min(2,size));
  expect(content(action(tree,'הצגת ההרכב של האדומים'))).toContain(size===0?'ההרכב לא זמין':size===3?'ושחקן נוסף':'כל ההרכב');
});

test.each([4,7,11])('holding the roster of %i reveals only its actual players, releases without choosing, and keeps the frame',size=>{
  const input={...properties(),shootout:undefined};input.draftTeams.teams[0].playerIds=Array.from({length:size},(_,i)=>`a${i}`);
  let tree=draw(input);const bounds=(t:any)=>Object.assign({},...find(t,'View').find(n=>n.props.testID==='penalty-dialog').props.style.filter(Boolean));const initial=bounds(tree);
  const hold=action(tree,'הצגת ההרכב של האדומים');hold.props.onLongPress();tree=draw(input);
  const peek=find(tree,'View').find(n=>n.props.testID==='penalty-roster-peek');expect(peek.props.pointerEvents).toBe('none');expect(find(peek,'Avatar').map(n=>n.props.user.id)).toEqual(input.draftTeams.teams[0].playerIds);
  expect(bounds(tree)).toEqual(initial);expect(mockStart).not.toHaveBeenCalled();hold.props.onPressOut();tree=draw(input);
  expect(find(tree,'View').find(n=>n.props.testID==='penalty-roster-peek')).toBeUndefined();expect(mockStart).not.toHaveBeenCalled();
  action(tree,'האדומים בועטים ראשונים').props.onPress();expect(mockStart).toHaveBeenCalledTimes(1);
});

test('cancelling touch or hiding the dialog clears the temporary roster',()=>{
 const input={...properties(),shootout:undefined};let tree=draw(input);action(tree,'הצגת ההרכב של האדומים').props.onLongPress();tree=draw(input);action(tree,'הצגת ההרכב של האדומים').props.onTouchCancel();tree=draw(input);
 expect(find(tree,'View').some(n=>n.props.testID==='penalty-roster-peek')).toBe(false);
 action(tree,'הצגת ההרכב של האדומים').props.onLongPress();tree=draw({...input,visible:false});tree=draw(input);expect(find(tree,'View').some(n=>n.props.testID==='penalty-roster-peek')).toBe(false);
});

test('switching decision content keeps the same visible native modal and resumes participant selection',()=>{
 const input=properties();let tree=draw(input);picker(tree).props.onSelect('a0');tree=draw(input);const onDecisionClose=jest.fn();
 const decision=React.createElement('DecisionContent');tree=draw({...input,decisionContent:decision,onDecisionClose});expect(find(tree,'Modal')).toHaveLength(1);expect(find(tree,'Modal')[0].props.visible).toBe(true);expect(find(tree,'DecisionContent')).toHaveLength(1);
 find(tree,'Modal')[0].props.onRequestClose();expect(onDecisionClose).toHaveBeenCalledTimes(1);
 tree=draw(input);expect(find(tree,'Modal')[0].props.visible).toBe(true);expect(picker(tree).props.title).toBe('מי בשער?');expect(mockStart).not.toHaveBeenCalled();expect(mockRecord).not.toHaveBeenCalled();
});

test('returning through the chooser never replays the previous saved-kick celebration',async()=>{
 const input=properties();let tree=choosePeople(input);action(tree,'גול').props.onPress();await settle();tree=draw(input);expect(pitch(tree).props.status).toBe('saved');
 draw({...input,decisionContent:React.createElement('DecisionContent')});tree=draw(input);expect(pitch(tree).props.status).toBe('idle');expect(mockRecord).toHaveBeenCalledTimes(1);
});

test('a failed initial draw retries the original side without another draw or extra confirmation',async()=>{
  const random=jest.spyOn(Math,'random').mockReturnValueOnce(0.9);
  try {
    const input={...properties(),shootout:undefined};let tree=draw(input);mockStart.mockRejectedValueOnce(Error('offline'));
    action(tree,'הגרלת הבועטים הראשונים').props.onPress();await settle();tree=draw(input);
    expect(action(tree,'האדומים בועטים ראשונים').props.disabled).toBe(true);
    action(tree,'ניסיון חוזר').props.onPress();await settle();tree=draw(input);
    expect(random).toHaveBeenCalledTimes(1);expect(mockStart.mock.calls).toEqual([['test-round','B','round-one'],['test-round','B','round-one']]);
    expect(picker(tree).props.players.map((p:any)=>p.id)).toEqual(['b0','b1']);
  } finally {random.mockRestore();}
});

test.each([{width:390,height:820,fontScale:1},{width:320,height:569,fontScale:1.4}])('dialog bounds stay constant through initial selection, participants, result, log and finish: %o',async dimensions=>{
  mockWindow=dimensions;const input={...properties(),shootout:undefined};let tree=draw(input);
  const bounds=(t:any)=>Object.assign({},...find(t,'View').find(n=>n.props.testID==='penalty-dialog').props.style.filter(Boolean));
  const expected=Math.min(680,Math.floor(dimensions.height*0.92));
  const check=()=>{expect(bounds(tree).height).toBe(expected);expect(bounds(tree).maxHeight).toBe(expected);};check();
  action(tree,'האדומים בועטים ראשונים').props.onPress();await settle();tree=draw(input);check();
  picker(tree).props.onSelect('a0');tree=draw(input);check();picker(tree).props.onSelect('b0');tree=draw(input);check();
  action(tree,'גול').props.onPress();await settle();tree=draw(input);check();pitch(tree).props.onAnimationComplete();tree=draw(input);
  action(tree,'יומן בעיטות').props.onPress();tree=draw(input);check();action(tree,'חזרה לבעיטות').props.onPress();tree=draw(input);
  action(tree,'סיום פנדלים').props.onPress();tree=draw(input);check();
});

test('before the first kick returning to selection permits changing first team without a reset',async()=>{
  const onChangeDecision=jest.fn(),input={...properties(),onChangeDecision};
  let tree=choosePeople(input);const back=action(tree,'חזור לבחירת שיטת ההכרעה');
  expect(back.props.disabled).toBe(false);back.props.onPress();expect(onChangeDecision).not.toHaveBeenCalled();
  expect(mockRecord).not.toHaveBeenCalled();expect(mockStart).not.toHaveBeenCalled();
  tree=draw(input);expect(pitch(tree).props.teamPreview).toBe(true);
  action(tree,'הכחולים בועטים ראשונים').props.onPress();await settle();tree=draw(input);
  expect(mockChangeFirst).toHaveBeenCalledWith('test-round','B','round-one');
  expect(picker(tree).props.players.map((p:any)=>p.id)).toEqual(['b0','b1']);
});

test('decision return cannot abandon an unacknowledged kick, including a failed response',async()=>{
  const onChangeDecision=jest.fn(),input={...properties(),onChangeDecision};let reject!:(error:Error)=>void;
  mockRecord.mockImplementationOnce(()=>new Promise((_resolve,fail)=>{reject=fail;}));
  let tree=choosePeople(input);action(tree,'גול').props.onPress();tree=draw(input);
  let back=action(tree,'חזור לבחירת שיטת ההכרעה');expect(back.props.disabled).toBe(true);back.props.onPress();
  reject(Error('offline'));await settle();tree=draw(input);back=action(tree,'חזור לבחירת שיטת ההכרעה');
  expect(back.props.disabled).toBe(true);back.props.onPress();expect(onChangeDecision).not.toHaveBeenCalled();
});

test.each([
  {height:820,width:390,fontScale:1},
  {height:569,width:320,fontScale:1.4},
  {height:569,width:390,fontScale:1.4},
])('the complete penalty process keeps one bounded surface at $width by $height with text scale $fontScale',async dimensions=>{
  mockWindow=dimensions;const input=properties();input.shootout=undefined;
  const expectedHeight=Math.min(680,Math.floor(dimensions.height*0.92));
  const check=(tree:any)=>{
    const dialog=find(tree,'View').find(node=>node.props.testID==='penalty-dialog');
    const surface=Object.assign({},...dialog.props.style.filter(Boolean));
    expect(surface.height).toBe(expectedHeight);expect(surface.maxHeight).toBe(expectedHeight);
    const scroll=find(tree,'ScrollView')[0];
    expect(Object.assign({},...scroll.props.style.filter(Boolean))).toMatchObject({flex:1,minHeight:0});
    return tree;
  };
  let tree=check(draw(input));action(tree,'האדומים בועטים ראשונים').props.onPress();await settle();
  tree=check(draw(input));picker(tree).props.onSelect('a0');
  tree=check(draw(input));picker(tree).props.onSelect('b0');
  tree=check(draw(input));mockRecord.mockRejectedValueOnce(Error('offline'));
  action(tree,'גול').props.onPress();check(draw(input));await settle();
  tree=check(draw(input));expect(pitch(tree).props.status).toBe('error');
  action(tree,'ניסיון חוזר').props.onPress();await settle();tree=check(draw(input));
  expect(pitch(tree).props.status).toBe('saved');pitch(tree).props.onAnimationComplete();tree=check(draw(input));
  action(tree,'יומן בעיטות').props.onPress();tree=check(draw(input));
  action(tree,'תיקון הבעיטה האחרונה').props.onPress();tree=check(draw(input));
  action(tree,'חזרה ליומן').props.onPress();tree=check(draw(input));
  action(tree,'ביטול הבעיטה האחרונה').props.onPress();tree=check(draw(input));
  action(tree,'חזרה ליומן').props.onPress();tree=check(draw(input));
  action(tree,'חזרה לבעיטות').props.onPress();tree=check(draw(input));
  action(tree,'סיום פנדלים').props.onPress();check(draw(input));
  expect(mockRecord).toHaveBeenCalledTimes(2);expect(mockRecord.mock.calls[0][1]).toEqual(mockRecord.mock.calls[1][1]);
});

test('opens the kicking roster immediately; each role takes one direct selection',()=>{
  const input=properties();let tree=draw(input);
  expect(picker(tree).props.players.map((player:any)=>player.id)).toEqual(['a0','a1']);
  expect(pitch(tree).props.activeRole).toBe('primary');
  expect(pitch(tree).props.primary.player).toBeUndefined();
  picker(tree).props.onSelect('a0');tree=draw(input);
  expect(picker(tree).props.players.map((player:any)=>player.id)).toEqual(['b0','b1']);
  expect(picker(tree).props.title).toBe('מי בשער?');
  expect(pitch(tree).props.activeRole).toBe('secondary');
  expect(pitch(tree).props.primary.player.id).toBe('a0');
  expect(pitch(tree).props.secondary.player).toBeUndefined();
  picker(tree).props.onSelect('b0');tree=draw(input);
  expect(find(tree,'Picker')).toHaveLength(0);
  expect(pitch(tree).props.secondary.player.id).toBe('b0');
  expect(['גול','עצירה','החמצה'].every(label=>!!action(tree,label))).toBe(true);
  expect(content(tree)).not.toContain('אישור הבעיטה');
  expect(mockRecord).not.toHaveBeenCalled();
});

test('a sticky keeper never skips the explicit opponent selection',()=>{
  const input=properties();let tree=draw(input);picker(tree).props.onSelect('a1');tree=draw(input);
  expect(picker(tree).props.title).toBe('מי בשער?');
  expect(picker(tree).props.selectedId).toBeNull();
  expect(pitch(tree).props.secondary.player).toBeUndefined();
});

test('rejects wrong-team and waiting players even when a selection handler is called directly',()=>{
  const input=properties();let tree=draw(input);picker(tree).props.onSelect('waiting');
  expect(pitch(draw(input)).props.activeRole).toBe('primary');
  picker(draw(input)).props.onSelect('a0');tree=draw(input);picker(tree).props.onSelect('a1');picker(tree).props.onSelect('waiting');
  expect(pitch(draw(input)).props.activeRole).toBe('secondary');
  expect(mockRecord).not.toHaveBeenCalled();
});

test.each(['גול','עצירה','החמצה'])('%s starts one write immediately; saved animation requires acknowledgement',async title=>{
  const input=properties();let resolve!:()=>void;mockRecord.mockImplementationOnce(()=>new Promise<void>(done=>{resolve=done;}));
  let tree=choosePeople(input);action(tree,title).props.onPress();action(tree,title).props.onPress();tree=draw(input);
  expect(mockRecord).toHaveBeenCalledTimes(1);
  expect(mockRecord.mock.calls[0][1]).toMatchObject({team:'A',kickerId:'a0',keeperId:'b0',expectedKickCount:0,expectedRoundId:'round-one',outcome:({'גול':'goal','עצירה':'save','החמצה':'miss'} as any)[title]});
  expect(pitch(tree).props.status).toBe('saving');
  resolve();await settle();tree=draw(input);
  expect(pitch(tree).props.status).toBe('saved');
  expect(pitch(tree).props.primary.player.id).toBe('a0');
  expect(pitch(tree).props.secondary.player.id).toBe('b0');
  expect(picker(tree).props.players.map((player:any)=>player.id)).toEqual(['b0','b1']);
  expect(picker(tree).props.disabled).toBe(false);
  picker(tree).props.onSelect('b1');tree=draw(input);
  expect(pitch(tree).props.status).toBe('idle');
  expect(pitch(tree).props.primary.player.id).toBe('b1');
  expect(pitch(tree).props.primary.color).toBe('#3B82F6');
  expect(pitch(tree).props.secondary.color).toBe('#EF4444');
  expect(pitch(tree).props.secondary.player).toBeUndefined();
  expect(picker(tree).props.players.map((player:any)=>player.id)).toEqual(['a0','a1']);
});

test('failure retains roles and exact outcome/id for retry and never celebrates',async()=>{
  const input=properties();mockRecord.mockRejectedValueOnce(Error('offline')).mockResolvedValue(undefined);
  let tree=choosePeople(input);action(tree,'עצירה').props.onPress();await settle();tree=draw(input);
  expect(pitch(tree).props.status).toBe('error');
  expect(pitch(tree).props.primary.player.id).toBe('a0');expect(pitch(tree).props.secondary.player.id).toBe('b0');
  action(tree,'ניסיון חוזר').props.onPress();await settle();tree=draw(input);
  expect(mockRecord).toHaveBeenCalledTimes(2);expect(mockRecord.mock.calls[0][1]).toEqual(mockRecord.mock.calls[1][1]);
  expect(pitch(tree).props.status).toBe('saved');expect(pitch(tree).props.outcome).toBe('save');
});

test('changing a role is optional and does not record a partial kick',()=>{
  const input=properties();let tree=choosePeople(input);pitch(tree).props.primary.onEdit();tree=draw(input);
  expect(picker(tree).props.players.map((player:any)=>player.id)).toEqual(['a0','a1']);
  picker(tree).props.onSelect('a1');tree=draw(input);
  expect(picker(tree)).toBeUndefined();
  expect(pitch(tree).props.secondary.player.id).toBe('b0');
  pitch(tree).props.secondary.onEdit();tree=draw(input);picker(tree).props.onSelect('b1');tree=draw(input);
  expect(pitch(tree).props.primary.player.id).toBe('a1');expect(pitch(tree).props.secondary.player.id).toBe('b1');
  expect(mockRecord).not.toHaveBeenCalled();
});

test.each([{height:820,width:390,fontScale:1},{height:569,width:320,fontScale:1.4}])('undo confirmation stays outside the scrolling content at %o',dimensions=>{
 mockWindow=dimensions;const input=properties();input.shootout.kicks=[{id:'one',team:'A',kickerId:'a0',keeperId:'b0',scored:true,outcome:'goal',at:1}];
 let tree=draw(input);action(tree,'יומן בעיטות').props.onPress();tree=draw(input);
 action(tree,'ביטול הבעיטה האחרונה').props.onPress();tree=draw(input);
 const confirm=find(tree,'Pressable').find(node=>node.props.testID==='penalty-undo-confirm');
 expect(confirm).toBeDefined();expect(confirm.props.disabled).toBe(false);
 expect(Object.assign({},...confirm.props.style.filter(Boolean)).flexShrink).toBe(0);
 expect(find(find(tree,'ScrollView')[0],'Pressable').some(node=>node.props.testID==='penalty-undo-confirm')).toBe(false);
});

test('closing externally while a write settles preserves retry without an old success',async()=>{
  const input=properties();let resolve!:()=>void;mockRecord.mockImplementationOnce(()=>new Promise<void>(done=>{resolve=done;}));
  const tree=choosePeople(input);action(tree,'גול').props.onPress();draw({...input,visible:false});resolve();await settle();
  const reopened=draw(input);expect(pitch(reopened).props.status).toBe('error');expect(content(reopened)).toContain('ניסיון חוזר');
  action(reopened,'ניסיון חוזר').props.onPress();await settle();expect(mockRecord.mock.calls[0][1]).toEqual(mockRecord.mock.calls[1][1]);
});


test('changing game context discards the old animation and ignores its late acknowledgement',async()=>{
  const input=properties();let resolve!:()=>void;mockRecord.mockImplementationOnce(()=>new Promise<void>(done=>{resolve=done;}));
  const tree=choosePeople(input);action(tree,'גול').props.onPress();const next={...input,gameId:'another-round'};
  expect(pitch(draw(next)).props.status).toBe('idle');resolve();await settle();
  expect(pitch(draw(next)).props.status).toBe('idle');expect(pitch(draw(next)).props.primary.player).toBeUndefined();
});

test('the other first side has the opposite rosters, roles and colours from opening',()=>{
  const input=properties();input.shootout.firstTeam='B';let tree=draw(input);
  expect(picker(tree).props.players.map((player:any)=>player.id)).toEqual(['b0','b1']);picker(tree).props.onSelect('b1');tree=draw(input);
  expect(pitch(tree).props.primary.teamLabel).toBe('הכחולים');expect(pitch(tree).props.secondary.teamLabel).toBe('האדומים');
  expect(picker(tree).props.players.map((player:any)=>player.id)).toEqual(['a0','a1']);picker(tree).props.onSelect('a1');tree=draw(input);
  expect(pitch(tree).props.secondary.player.id).toBe('a1');expect(mockRecord).not.toHaveBeenCalled();
});


test('a lost write response followed by a database snapshot and retry never doubles the local score or turn',async()=>{
  const input=properties();mockRecord.mockRejectedValueOnce(Error('response lost')).mockResolvedValue(undefined);
  let tree=choosePeople(input);action(tree,'גול').props.onPress();await settle();
  const pending=mockRecord.mock.calls[0][1];input.shootout.kicks=[{...pending,at:1}];tree=draw(input);
  expect(content(tree)).toContain('האדומים בועטים מול הכחולים');
  expect(content(tree)).not.toContain('הכחולים בועטים מול האדומים');
  expect(find(tree,'Avatar').map(node=>node.props.user.id)).toEqual(['a0','b0']);
  expect(find(tree,'Shirt').map(node=>node.props.color)).toEqual(['#EF4444','#3B82F6']);
  expect(action(tree,'גול').props.disabled).toBe(true);
  expect(action(tree,'גול').props.accessibilityState.selected).toBe(true);
  action(tree,'ניסיון חוזר').props.onPress();await settle();tree=draw(input);
  expect(content(tree)).toContain('הבעיטה הבאה: הכחולים מול האדומים');
  expect(mockRecord.mock.calls[0][1]).toEqual(mockRecord.mock.calls[1][1]);
  expect(picker(tree).props.players.map((player:any)=>player.id)).toEqual(['b0','b1']);
  expect(find(tree,'View').find(node=>node.props.accessibilityLabel?.startsWith('תוצאת הפנדלים:')).props.accessibilityLabel).toBe('תוצאת הפנדלים: האדומים 1, הכחולים 0');
});


test.each([4,7,11])('all %s eligible players are retained for each role',size=>{
  const input=properties();const attackers=Array.from({length:size},(_,index)=>'a'+index),defenders=Array.from({length:size},(_,index)=>'b'+index);
  input.draftTeams.teams[0].playerIds=attackers;input.draftTeams.teams[1].playerIds=defenders;
  let tree=draw(input);expect(picker(tree).props.players.map((player:any)=>player.id)).toEqual(attackers);
  picker(tree).props.onSelect(attackers[size-1]);tree=draw(input);
  expect(picker(tree).props.players.map((player:any)=>player.id)).toEqual(defenders);
  picker(tree).props.onSelect(defenders[size-1]);tree=draw(input);
  expect(pitch(tree).props.primary.player.id).toBe(attackers[size-1]);expect(pitch(tree).props.secondary.player.id).toBe(defenders[size-1]);
});


test('a live snapshot advancing the turn during a pending write cannot change the visible kick roles or heading',async()=>{
  const input=properties();let resolve!:()=>void;mockRecord.mockImplementationOnce(()=>new Promise<void>(done=>{resolve=done;}));
  let tree=choosePeople(input);action(tree,'החמצה').props.onPress();const pending=mockRecord.mock.calls[0][1];
  input.shootout.kicks=[{...pending,at:1}];tree=draw(input);
  expect(pitch(tree).props.status).toBe('saving');expect(content(tree)).toContain('האדומים בועטים מול הכחולים');
  expect(find(tree,'Avatar').map(node=>node.props.user.id)).toEqual(['a0','b0']);
  expect(action(tree,'החמצה').props.disabled).toBe(true);resolve();await settle();tree=draw(input);
  expect(picker(tree).props.teamLabel).toBe('הכחולים');expect(content(tree)).toContain('הבעיטה הבאה: הכחולים מול האדומים');
  picker(tree).props.onSelect('b1');tree=draw(input);
  expect(content(tree)).toContain('הכחולים בועטים מול האדומים');expect(content(tree)).not.toContain('הבעיטה הבאה:');
});


test.each([320,390])('enlarged text at width %s reserves a whole selection row and keeps every penalty action reachable',width=>{
  mockWindow={width,height:569,fontScale:1.4};const input=properties();
  const ids=Array.from({length:11},(_,index)=>'a'+index);input.draftTeams.teams[0].playerIds=ids;
  let tree=draw(input);const section=find(tree,'View').find(node=>node.props.testID==='penalty-player-selection');
  const sectionStyle=Object.assign({},...section.props.style.filter(Boolean));
  expect(sectionStyle.flexShrink).toBe(0);expect(sectionStyle.minHeight).toBeGreaterThanOrEqual(180);
  expect(pitch(tree).props.height+sectionStyle.minHeight).toBeLessThanOrEqual(mockWindow.height*0.92-160);
  expect(picker(tree).props.players.map((player:any)=>player.id)).toEqual(ids);
  picker(tree).props.onSelect('a10');tree=draw(input);picker(tree).props.onSelect('b1');tree=draw(input);
  expect(pitch(tree).props.primary.player.id).toBe('a10');expect(pitch(tree).props.secondary.player.id).toBe('b1');
  expect(['גול','עצירה','החמצה'].every(label=>action(tree,label)?.props.disabled===false)).toBe(true);
  expect(action(tree,'חזרה למשחק')).toBeDefined();
  const people=find(tree,'View').find(node=>Array.isArray(node.props.style)&&node.props.style[0]?.gap===7&&find(node,'Avatar').length===2);
  expect(Object.assign({},...people.props.style.filter(Boolean)).flexDirection).toBe('column');
  const summary=find(tree,'View').find(node=>node.props.accessibilityLabel?.startsWith('תוצאת הפנדלים:'));
  expect(Object.assign({}, ...[summary.props.style].flat().filter(Boolean)).flexWrap).toBe('wrap');
  const metadata=find(summary,'Text');expect(metadata.every(node=>node.props.maxFontSizeMultiplier===1.2)).toBe(true);
  expect(find(tree,'ScrollView')[0].props.children).toBeTruthy();
});


test.each(['גול','עצירה','החמצה'])('%s reveals the pitch once after acknowledgement, without scrolling during the two participant choices',async title=>{
  mockWindow={width:320,height:569,fontScale:1.4};const input=properties();const scrollTo=jest.fn();let resolve!:()=>void;
  mockRecord.mockImplementationOnce(()=>new Promise<void>(done=>{resolve=done;}));
  let tree=draw(input);find(tree,'ScrollView')[0].props.ref.current={scrollTo};
  picker(tree).props.onSelect('a0');tree=draw(input);picker(tree).props.onSelect('b0');tree=draw(input);
  expect(scrollTo).not.toHaveBeenCalled();action(tree,title).props.onPress();action(tree,title).props.onPress();tree=draw(input);
  expect(scrollTo).not.toHaveBeenCalled();expect(pitch(tree).props.status).toBe('saving');expect(mockRecord).toHaveBeenCalledTimes(1);
  resolve();await settle();tree=draw(input);
  expect(scrollTo).toHaveBeenCalledTimes(1);expect(scrollTo).toHaveBeenCalledWith({y:0,animated:false});expect(pitch(tree).props.status).toBe('saved');
  pitch(tree).props.onAnimationComplete();tree=draw(input);picker(tree).props.onSelect('b1');draw(input);
  expect(scrollTo).toHaveBeenCalledTimes(1);
});

test('failed kick acknowledgement keeps the scrolled position and reveals only a successful retry',async()=>{
  const input=properties(),scrollTo=jest.fn();mockRecord.mockRejectedValueOnce(Error('offline')).mockResolvedValue(undefined);
  let tree=choosePeople(input);find(tree,'ScrollView')[0].props.ref.current={scrollTo};
  action(tree,'עצירה').props.onPress();await settle();tree=draw(input);
  expect(scrollTo).not.toHaveBeenCalled();expect(pitch(tree).props.status).toBe('error');
  action(tree,'ניסיון חוזר').props.onPress();await settle();tree=draw(input);
  expect(mockRecord.mock.calls[0][1]).toEqual(mockRecord.mock.calls[1][1]);expect(scrollTo).toHaveBeenCalledTimes(1);expect(pitch(tree).props.status).toBe('saved');
});

test.each(['close','game'] as const)('a late acknowledged kick cannot scroll after %s changes the visible context',async change=>{
  const input=properties(),scrollTo=jest.fn();let resolve!:()=>void;mockRecord.mockImplementationOnce(()=>new Promise<void>(done=>{resolve=done;}));
  let tree=choosePeople(input);find(tree,'ScrollView')[0].props.ref.current={scrollTo};action(tree,'גול').props.onPress();
  const next=change==='close'?{...input,visible:false}:{...input,gameId:'new-game'};draw(next);resolve();await settle();tree=draw(next);
  expect(scrollTo).not.toHaveBeenCalled();expect(pitch(tree).props.status).not.toBe('saved');
});

test.each([{height:820,width:390,fontScale:1},{height:569,width:320,fontScale:1.4}])('finish previews without saving and pins its confirmation outside the scroll at %o',dimensions=>{
 mockWindow=dimensions;const input=properties();input.shootout.kicks=[{id:'one',team:'B',kickerId:'b0',keeperId:'a0',scored:true,outcome:'goal',at:1}];
 let tree=draw(input);action(tree,'סיום פנדלים').props.onPress();tree=draw(input);
 expect(input.onDecided).not.toHaveBeenCalled();expect(content(tree)).toContain('מספר הבעיטות אינו שווה');
 const confirm=action(tree,'אישור ומעבר למשחק הבא');expect(confirm.props.disabled).toBe(false);
 expect(action(find(tree,'ScrollView')[0],'אישור ומעבר למשחק הבא')).toBeUndefined();
 action(tree,'המשך בעיטות').props.onPress();draw(input);expect(input.onDecided).not.toHaveBeenCalled();
});
test('finish submits the leading side once, preserves the failed decision and retries it',async()=>{
 const input=properties();input.shootout.kicks=[{id:'one',team:'B',kickerId:'b0',keeperId:'a0',scored:true,outcome:'goal',at:1}];
 let reject!:(e:Error)=>void;input.onDecided.mockImplementationOnce(()=>new Promise((_r:any,fail:any)=>{reject=fail;})).mockResolvedValue(undefined);
 let tree=draw(input);action(tree,'סיום פנדלים').props.onPress();tree=draw(input);
 const confirm=action(tree,'אישור ומעבר למשחק הבא');confirm.props.onPress();confirm.props.onPress();expect(input.onDecided.mock.calls).toEqual([['B']]);
 reject(Error('offline'));await settle();tree=draw(input);expect(action(tree,'אישור ומעבר למשחק הבא').props.disabled).toBe(true);
 action(tree,'ניסיון חוזר').props.onPress();await settle();expect(input.onDecided.mock.calls).toEqual([['B'],['B']]);
});
test('a tied finish requires an explicit winner selection before the shared confirmation',()=>{
 const input=properties();input.shootout.kicks=[{id:'one',team:'A',kickerId:'a0',keeperId:'b0',scored:false,outcome:'miss',at:1}];
 let tree=draw(input);action(tree,'סיום פנדלים').props.onPress();tree=draw(input);expect(action(tree,'אישור ומעבר למשחק הבא').props.disabled).toBe(true);
 action(tree,'הכחולים').props.onPress();tree=draw(input);expect(input.onDecided).not.toHaveBeenCalled();expect(action(tree,'אישור ומעבר למשחק הבא').props.disabled).toBe(false);
 action(tree,'אישור ומעבר למשחק הבא').props.onPress();expect(input.onDecided).toHaveBeenCalledWith('B');
});
