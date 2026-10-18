import React from 'react';
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

jest.mock('react-native',()=>({Image:'Image',ImageBackground:'Background',Pressable:'Pressable',Text:'Text',View:'View',StyleSheet:{create:(s:any)=>s,hairlineWidth:1}}));
jest.mock('@expo/vector-icons',()=>({Ionicons:'Icon'}));
jest.mock('expo-linear-gradient',()=>({LinearGradient:'Gradient'}));
jest.mock('@/components/UserAvatar',()=>({UserAvatar:'Avatar'}));
jest.mock('@/components/match/LiveCountdown',()=>({LiveCountdown:'Countdown'}));
jest.mock('@/data/roundCover',()=>({resolveRoundCover:()=>1}));
jest.mock('@/data/coverImages',()=>({getCoverSource:()=>undefined}));
jest.mock('@/theme',()=>({colors:{text:'#111',primary:'#2463EB'},RTL_LABEL_ALIGN:'left'}));
jest.mock('@/services/weatherService',()=>({getForecastFor:jest.fn()}));
import {useRoundForecast} from '@/hooks/useRoundForecast';
import {getForecastFor} from '@/services/weatherService';
import {MatchStadiumHero} from '@/components/match/MatchStadiumHero';
import {RoundGameFacts,RoundPeopleCard} from '@/components/match/RoundInfoDetails';
const read=getForecastFor as jest.Mock,runtime=(require('react') as any).__runtime;
const nodes=(n:any):any[]=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(React.Children.toArray(n.props?.children))];
const copy=(n:any):string=>typeof n==='string'||typeof n==='number'?String(n):Array.isArray(n)?n.map(copy).join(' '):n&&typeof n==='object'?copy(React.Children.toArray(n.props?.children)):'';
const render=<T,>(fn:()=>T)=>{runtime.begin();const value=fn();runtime.effects();return value;};
const tick=()=>new Promise(setImmediate);
const game:any={id:'one',startsAt:Date.now()+3600000,fieldLat:32,fieldLng:34,city:'תל אביב'};
const forecast={tempC:24,rainProb:30,weatherCode:2};
beforeEach(()=>{runtime.reset();jest.clearAllMocks();read.mockResolvedValue(forecast);});
test('forecast uses the round kickoff, coordinates and city rather than the current weather',async()=>{
 expect(render(()=>useRoundForecast(game,{lat:1,lng:2,city:'מועדון'}))).toBeNull();await tick();
 expect(render(()=>useRoundForecast(game))).toEqual(forecast);
 expect(read).toHaveBeenCalledWith({lat:32,lng:34,city:'תל אביב',startsAt:game.startsAt});
});
test('a round without coordinates can use its club location; an unresolved location never invents a forecast',async()=>{
 const noLocation={id:'none',startsAt:game.startsAt} as any;render(()=>useRoundForecast(noLocation,{city:'ירושלים'}));await tick();
 expect(render(()=>useRoundForecast(noLocation,{city:'ירושלים'}))).toEqual(forecast);
 expect(render(()=>useRoundForecast({...noLocation,id:'unknown'}))).toBeNull();expect(read).toHaveBeenCalledTimes(1);
});
test('switching rounds immediately hides the previous forecast and ignores its late response',async()=>{
 let resolve!:(v:any)=>void;read.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));render(()=>useRoundForecast(game));
 const next={...game,id:'two',fieldLat:35};render(()=>useRoundForecast(next));await tick();
 expect(render(()=>useRoundForecast(next))).toEqual(forecast);resolve({...forecast,tempC:-9});await tick();
 expect(render(()=>useRoundForecast(next))).toEqual(forecast);
});
test('a missing or failed forecast remains absent; closing the screen cancels late results',async()=>{
 read.mockRejectedValueOnce(Error('offline'));render(()=>useRoundForecast(game));await tick();expect(render(()=>useRoundForecast(game))).toBeNull();
 runtime.reset();let resolve!:(v:any)=>void;read.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));render(()=>useRoundForecast(game));runtime.reset();resolve(forecast);await tick();
 expect(render(()=>useRoundForecast(null))).toBeNull();
});
test('the hero preserves menu, back, share, chat, unread count, season and countdown contracts',()=>{
 const actions=Array.from({length:4},()=>jest.fn());
 const tree=render(()=>MatchStadiumHero({roundId:'one',title:'מחזור עם שם ארוך',startsAt:game.startsAt,onBackPress:actions[0],onMenuPress:actions[1],onSharePress:actions[2],onChatPress:actions[3],chatUnread:4,seasonLabel:'עונה 2',statusLabel:'נרשמת למחזור'}));
 expect(copy(tree)).toContain('עונה 2');expect(copy(tree)).toContain('מחזור עם שם ארוך');expect(nodes(tree).some(n=>n.type==='Countdown')).toBe(true);
 const buttons=nodes(tree).filter(n=>n.props.onPress&&n.props.icon);buttons.forEach(n=>n.props.onPress());expect(actions.every(a=>a.mock.calls.length===1)).toBe(true);expect(buttons.some(n=>n.props.count===4)).toBe(true);
});
test('zero degrees is real weather; reservations are occupied places rather than invented registrations',()=>{
 const tree=render(()=>MatchStadiumHero({roundId:'one',onBackPress:()=>{},startsAt:game.startsAt,countdownHidden:true,occupancy:{registered:15,capacity:15,reserved:true},weather:{tempC:0,description:'גשם',icon:'rainy-outline',rainProb:70}}));
 expect(copy(tree)).toContain('0°');expect(copy(tree)).toContain('70%');expect(copy(tree)).toContain('מקומות תפוסים');expect(copy(tree)).not.toContain('רשומים');expect(nodes(tree).some(n=>n.type==='Countdown')).toBe(false);
});
test('missing hero data and omitted game properties render no fake values',()=>{
 const tree=render(()=>MatchStadiumHero({roundId:'one',onBackPress:()=>{}}));expect(nodes(tree).some(n=>n.props.accessibilityLabel?.startsWith('תחזית'))).toBe(false);
 expect(RoundGameFacts({game:{}})).toBeNull();expect(copy(RoundGameFacts({game:{format:'5v5',fieldType:'synthetic',matchDurationMinutes:15}}))).toContain('15 דקות');
});
test('the club and organizer remain independent actions with real identity; standalone rounds omit the club',()=>{
 const onClub=jest.fn(),onOrganizer=jest.fn(),organizer={id:'owner',name:'שם ארוך של מארגן',avatarId:'a05',photoUrl:'https://example.test/owner.jpg'};
 const tree=RoundPeopleCard({club:{name:'מועדון'},organizer,onClub,onOrganizer});const rows=nodes(tree).filter(n=>n.props.onPress);rows.forEach(n=>n.props.onPress());expect(onClub).toHaveBeenCalledTimes(1);expect(onOrganizer).toHaveBeenCalledTimes(1);
 const own=RoundPeopleCard({organizer,onOrganizer});expect(nodes(own).some(n=>n.props.label==='מועדון')).toBe(false);expect(nodes(own).find(n=>n.type==='Avatar').props.user).toEqual(organizer);
 expect(RoundPeopleCard({})).toBeNull();
});
test('creation date is a separate third row after the organizer, without a navigation action',()=>{
 const tree=RoundPeopleCard({club:{name:'המועדון'},organizer:{id:'one',name:'המארגן'},createdAt:new Date(2026,9,17).getTime()});
 const rows=nodes(tree).filter(n=>n.props.label);
 expect(rows.map(n=>n.props.label)).toEqual(['מועדון','יוצר המחזור','נוצר בתאריך']);expect(rows[2].props.onPress).toBeUndefined();expect(rows[2].props.name).toBe('17.10.26');
});
test('the started indication precedes the occupancy chip in the hero footer',()=>{
 const tree=render(()=>MatchStadiumHero({roundId:'one',onBackPress:()=>{},showStarted:true,occupancy:{registered:15,capacity:15}}));
 expect(copy(tree).indexOf('המחזור התחיל')).toBeLessThan(copy(tree).indexOf('15 מתוך 15 רשומים'));
});
