import React from 'react';
jest.mock('@/utils/errorObservation',()=>({observeCaughtError:jest.fn()}));
let mockSlots:any[]=[],mockCursor=0;
jest.mock('react',()=>({...jest.requireActual('react'),
 useState:(initial:any)=>{const i=mockCursor++;if(!(i in mockSlots))mockSlots[i]=typeof initial==='function'?initial():initial;return[mockSlots[i],(v:any)=>mockSlots[i]=typeof v==='function'?v(mockSlots[i]):v];},
 useRef:(initial:any)=>{const i=mockCursor++;if(!(i in mockSlots))mockSlots[i]={current:initial};return mockSlots[i];},
}));
jest.mock('react-native',()=>({ActivityIndicator:'Busy',Pressable:'Button',ScrollView:'Scroll',Text:'Text',TextInput:'Input',View:'View',StyleSheet:{create:(s:any)=>s,absoluteFill:{}},useWindowDimensions:()=>({width:320,height:640,fontScale:1.4})}));
jest.mock('@expo/vector-icons',()=>({Ionicons:'Icon'}));
jest.mock('@/components/SafeModal',()=>({SafeModal:'Modal'}));
jest.mock('@/components/UserAvatar',()=>({UserAvatar:'Avatar'}));
jest.mock('@/components/match/MatchActionPitch',()=>({MatchActionPitch:'Pitch'}));
jest.mock('@/components/match/MatchPlayerPicker',()=>({MatchPlayerPicker:'Picker'}));
jest.mock('@/theme',()=>({RTL_LABEL_ALIGN:'left'}));
jest.mock('@/theme/overlays',()=>({overlaySurfaces:{sheet:{}}}));
jest.mock('@/services/serverClock',()=>({serverNow:()=>12345}));
import {InPlayPenaltyModal} from '@/components/match/InPlayPenaltyModal';
const find=(n:any,type:string):any[]=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(v=>find(v,type)):[...(n.type===type?[n]:[]),...find(n.props?.children,type)];
const content=(n:any):string=>n==null||typeof n==='boolean'?'':typeof n==='string'||typeof n==='number'?String(n):Array.isArray(n)?n.map(content).join(''):content(n.props?.children);
const button=(tree:any,label:string)=>find(tree,'Button').find(n=>content(n)===label||n.props.accessibilityLabel===label);
const props=()=>({teams:[{name:'האדומים',color:'red',ink:'red',players:[{id:'a',name:'גל'}]},{name:'הכחולים',color:'blue',ink:'blue',players:[{id:'b',name:'רון'}],keeperId:'b'}],minute:5,clockMs:272000,roundNumber:2,running:true,onTimer:jest.fn().mockResolvedValue(undefined),onSave:jest.fn().mockResolvedValue(undefined),onClose:jest.fn()} as any);
const draw=(p:any)=>{mockCursor=0;return InPlayPenaltyModal(p);};
const choose=(p:any)=>{let t=draw(p);find(t,'Picker')[0].props.onSelect('a');t=draw(p);expect(find(t,'Picker')[0].props.title).toBe('מי בשער?');find(t,'Picker')[0].props.onSelect('b');return draw(p);};
beforeEach(()=>{mockSlots=[];mockCursor=0;});

test.each(['גול','עצירה','החמצה'])('%s saves immediately after kicker and keeper selection, then exits after one animation',async label=>{
 const p=props();let t=choose(p);expect(p.onSave).not.toHaveBeenCalled();
 expect(button(t,'שמירת הפנדל')).toBeUndefined();expect(content(t)).not.toContain('מי בישל');await button(t,label).props.onPress();t=draw(p);
 expect(p.onSave).toHaveBeenCalledTimes(1);expect(p.onSave.mock.calls[0][0]).toMatchObject({team:'A',kickerId:'a',keeperId:'b',outcome:label==='גול'?'goal':label==='עצירה'?'save':'miss',minute:5,clockMs:272000});
 expect(find(t,'Pitch')[0].props.status).toBe('saved');
 expect(p.onClose).not.toHaveBeenCalled();find(t,'Pitch')[0].props.onAnimationComplete();expect(p.onClose).toHaveBeenCalledWith(false);
});
test('double tap and acknowledgement loss retain exactly the same event for retry, including hide and reopen',async()=>{
 const p=props();let reject!:(e:Error)=>void;p.onSave.mockImplementationOnce(()=>new Promise((_,fail)=>reject=fail));let t=choose(p);
 const action=button(t,'גול');const pending=action.props.onPress();action.props.onPress();expect(p.onSave).toHaveBeenCalledTimes(1);
 t=draw(p);expect(find(t,'Pitch')[0].props.status).toBe('saving');expect(p.onClose).not.toHaveBeenCalled();
 reject(Error('לא התקבל אישור'));await pending;t=draw(p);button(t,'סגירה').props.onPress();expect(p.onClose).toHaveBeenCalledWith(true);
 const first=p.onSave.mock.calls[0][0];p.clockMs=300000;p.visible=false;draw(p);p.visible=true;t=draw(p);expect(content(t)).toContain('04:32');await button(t,'ניסיון שמירה חוזר').props.onPress();
 expect(p.onSave.mock.calls[1][0]).toEqual(first);
});
test('changing teams uses the matching roster, clears the kicker, and never carries over a keeper from the other side',()=>{
 const p=props();let t=choose(p);button(t,'שינוי הבועט').props.onPress();t=draw(p);button(t,'הכחולים').props.onPress();t=draw(p);
 expect(find(t,'Picker')[0].props.players.map((v:any)=>v.id)).toEqual(['b']);expect(find(t,'Picker')[0].props.selectedId).toBe('');expect(find(t,'Pitch')[0].props.secondary.player).toBeUndefined();
 find(t,'Picker')[0].props.onSelect('b');t=draw(p);expect(find(t,'Picker')[0].props.players.map((v:any)=>v.id)).toEqual(['a']);
});
test('clock control never saves an event and closing an untouched draft is harmless',async()=>{
 const p=props();let t=draw(p);await button(t,'השהיה').props.onPress();t=draw(p);expect(p.onTimer).toHaveBeenCalledTimes(1);expect(p.onSave).not.toHaveBeenCalled();
 button(t,'סגירה').props.onPress();expect(p.onClose).toHaveBeenCalledWith(false);
});

test('timer double tap before render performs one write and blocks saving until acknowledgement',async()=>{
 const p=props();p.running=false;let resolve!:()=>void;
 p.onTimer.mockImplementation(()=>new Promise<void>(yes=>resolve=yes));
 let t=choose(p);const timer=button(t,'המשך');const pending=timer.props.onPress();timer.props.onPress();
 await button(t,'גול').props.onPress();expect(p.onTimer).toHaveBeenCalledTimes(1);expect(p.onSave).not.toHaveBeenCalled();
 t=draw(p);expect(button(t,'מעדכנים...').props.disabled).toBe(true);
 resolve();await pending;p.running=true;p.clockMs=274000;t=draw(p);
 expect(content(t)).toContain('04:34');expect(button(t,'השהיה').props.disabled).toBe(false);
 await button(t,'גול').props.onPress();expect(p.onSave.mock.calls[0][0].clockMs).toBe(274000);
});

test('timer rejection is visible inside the sheet and a successful retry clears the error',async()=>{
 const p=props();p.running=false;p.onTimer.mockRejectedValueOnce(Error('network'));
 let t=draw(p);await button(t,'המשך').props.onPress();t=draw(p);
 expect(content(t)).toContain('עדכון השעון נכשל');expect(p.onSave).not.toHaveBeenCalled();
 await button(t,'המשך').props.onPress();t=draw(p);expect(content(t)).not.toContain('עדכון השעון נכשל');
 expect(p.onTimer).toHaveBeenCalledTimes(2);
});

test('shows the exact live clock, follows ticks, and captures it once when saving',async()=>{
 const p=props();let t=choose(p);expect(content(t)).toContain('04:32');expect(find(t,'Input')).toHaveLength(0);
 p.clockMs=273998;t=draw(p);expect(content(t)).toContain('04:33');await button(t,'גול').props.onPress();
 expect(p.onSave.mock.calls[0][0]).toMatchObject({clockMs:273000,minute:5});
});
test('editing preserves the event clock while the current game clock advances',async()=>{
 const p=props();p.clockMs=480000;p.initial={id:'existing',team:'A',kickerId:'a',keeperId:'b',outcome:'goal',minute:5,clockMs:272000,at:123};
 let t=draw(p);expect(content(t)).toContain('04:32');expect(content(t)).not.toContain('08:00');
 await button(t,'גול').props.onPress();expect(p.onSave.mock.calls[0][0]).toMatchObject({clockMs:272000,at:123});
});

test('overtime penalty shows and saves the full playing clock',async()=>{
 const p=props();p.clockMs=630000;let t=choose(p);
 expect(content(t)).toContain('10:30');
 await button(t,'גול').props.onPress();
 expect(p.onSave.mock.calls[0][0]).toMatchObject({clockMs:630000,minute:11});
});
test('a legacy event without an exact clock does not invent seconds from its minute',async()=>{
 const p=props();p.initial={id:'legacy',team:'A',kickerId:'a',keeperId:'b',outcome:'goal',minute:5,at:123};
 const t=draw(p);expect(content(t)).toContain('לא תועד');await button(t,'גול').props.onPress();
 expect(p.onSave.mock.calls[0][0].clockMs).toBeUndefined();
});
test('an unknown keeper is an explicit selection and stale roster rejection permits a fresh attempt',async()=>{
 const p=props();let t=draw(p);find(t,'Picker')[0].props.onSelect('a');t=draw(p);expect(find(t,'Picker')[0].props.selectedId).toBeNull();
 button(t,'השוער לא ידוע').props.onPress();t=draw(p);p.onSave.mockRejectedValueOnce(Object.assign(Error('ההרכב השתנה'),{code:'LIVE_ROSTER_CHANGED'}));
 await button(t,'החמצה').props.onPress();t=draw(p);expect(find(t,'Picker')[0].props.title).toBe('מי בועט?');
 expect(p.onSave.mock.calls[0][0].keeperId).toBeNull();t=choose(p);await button(t,'גול').props.onPress();
 expect(p.onSave.mock.calls[1][0].id).not.toBe(p.onSave.mock.calls[0][0].id);
});
