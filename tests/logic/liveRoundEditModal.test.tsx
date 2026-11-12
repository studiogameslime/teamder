import React from 'react';
let slots:any[]=[],index=0;
jest.mock('react',()=>({...jest.requireActual('react'),useState:(initial:any)=>{const i=index++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,(next:any)=>{slots[i].value=typeof next==='function'?next(slots[i].value):next;}];}}));
jest.mock('react-native',()=>({View:'View',Text:'Text',TextInput:'Input',Pressable:'Pressable',ScrollView:'ScrollView',ActivityIndicator:'Spinner',StyleSheet:{create:(x:any)=>x},useWindowDimensions:()=>({width:320,height:650,fontScale:1.4})}));
jest.mock('@expo/vector-icons',()=>({Ionicons:'Icon'}));
jest.mock('@/components/SafeModal',()=>({SafeModal:'Modal'}));
jest.mock('@/components/PressableScale',()=>({PressableScale:'Pressable'}));
jest.mock('@/components/UserAvatar',()=>({UserAvatar:'Avatar'}));
jest.mock('@/components/draft/DraftScalePop',()=>({GrowIn:'GrowIn',ShrinkOut:'ShrinkOut'}));
jest.mock('@/components/draft/DraftOrderPath',()=>({DraftOrderPath:'DraftOrderPath'}));
jest.mock('@/theme',()=>({RTL_LABEL_ALIGN:'left',colors:{primary:'blue',text:'black',surfaceMuted:'white',border:'gray'},radius:{},spacing:{},typography:{},shadows:{}}));
jest.mock('@/theme/overlays',()=>({overlayTheme:{backdrop:'#0008'}}));
jest.mock('@/components/match/rotationView',()=>({teamColor:()=> 'red',teamTextColor:()=> 'red',teamPaletteEntry:()=>undefined,teamName:(i:number)=>['האדומים','הכחולים','הירוקים','הצהובים'][i]}));
jest.mock('@/components/match/TeamShirt',()=>({TeamShirtIllustration:'Shirt'}));
import {LiveRoundEditModal} from '@/components/match/LiveRoundEditModal';
import {DraftTeamCard, type DraftUserLite} from '@/components/draft/DraftTeamCard';
import {liveTeamsFixture} from '../helpers/liveTeamsWorld';
function nodes(n:any):any[]{if(!n||typeof n!=='object')return [];if(Array.isArray(n))return n.flatMap(nodes);return [n,...nodes(typeof n.type==='function'?n.type(n.props):n.props?.children)];}
function copy(n:any):string{if(n==null||typeof n==='boolean')return '';if(Array.isArray(n))return n.map(copy).join(' ');if(typeof n==='string'||typeof n==='number')return String(n);return copy(typeof n.type==='function'?n.type(n.props):n.props?.children);}
function harness(empty=false){
  slots=[];const game=liveTeamsFixture(3,5);if(empty)Object.assign(game.liveMatch!,{scoreA:0,scoreB:0,goals:[],timerAccumulatedMs:0,timerEvents:[]});
  const players:Record<string,DraftUserLite>=Object.fromEntries(game.players.map((id,i)=>[id,{id,name:`שחקן ${i+1}`,avatarId:'a13'}]));
  const props={game,players,ratings:{},canUseRating:true,loadHistory:jest.fn(async()=>[]),busy:false,stale:false,onSave:jest.fn(),onClose:jest.fn()};
  const render=()=>{index=0;return LiveRoundEditModal(props);};
  const button=()=>nodes(render()).find(n=>n.props?.testID==='live-round-next');
  const press=(label:string)=>{const n=nodes(render()).find(n=>n.props?.accessibilityLabel===label&&typeof n.props.onPress==='function');if(!n)throw new Error(label);expect(n.props.disabled).not.toBe(true);n.props.onPress();};
  const next=async()=>{expect(button().props.disabled).not.toBe(true);button().props.onPress();await Promise.resolve();await Promise.resolve();};
  return{props,render,button,press,next};
}

test('three departures produce a 5 on 5 banner and explicit current-only reset acknowledgement before any save',async()=>{
  const h=harness();for(const i of [13,14,15])h.press(`שחקן ${i}`);
  expect(copy(h.render()).replace(/\s+/g,' ')).toContain('5 על 5');expect(copy(h.render()).replace(/\s+/g,' ')).toContain('3 קבוצות בסיס, 4 שחקנים');
  expect(copy(h.render())).not.toContain('מהמשחק הבא');
  await h.next();h.press('חלוקה אקראית');await h.next();await h.next();
  expect(copy(h.render())).toContain('בדיקה לפני שמירה');expect(h.props.onSave).not.toHaveBeenCalled();
  await h.next();expect(copy(h.render())).toContain('הבישולים והפנדלים');expect(copy(h.render())).toContain('01:30');
  expect(h.button().props.disabled).toBe(true);h.press('חזרה לעריכה');expect(h.props.onSave).not.toHaveBeenCalled();
  await h.next();h.press('אישור איפוס המשחק הנוכחי בלבד');await h.next();
  expect(h.props.onSave).toHaveBeenCalledTimes(1);
  const [plan,confirmed]=h.props.onSave.mock.calls[0] as any;expect(confirmed).toBe(true);
  expect(plan.activeIds).toHaveLength(12);expect(plan.teams.map((t:any)=>t.playerIds.length)).toEqual([4,4,4]);
});

test('empty current game uses normal confirmation without a reset checkbox',async()=>{
  const h=harness(true);await h.next();await h.next();await h.next();await h.next();
  expect(h.props.onSave).toHaveBeenCalledWith(expect.any(Object),false);
  expect(copy(h.render())).not.toContain('ברור לי שהמשחק');
});

test.each(['קפטנים בסדר רגיל','קפטנים בסדר נחש','חלוקה ידנית'])('%s stays local and enforces complete allocation',async label=>{
  const h=harness();for(const i of [13,14,15])h.press(`שחקן ${i}`);await h.next();h.press(label);await h.next();
  expect(h.button().props.disabled).toBe(true);
  if(label==='חלוקה ידנית'){
    for(let team=0;team<3;team++){
      const heading=nodes(h.render()).filter(n=>n.type==='Pressable'&&n.props.accessibilityLabel?.endsWith('לשיבוץ'))[team];heading.props.onPress();
      for(let player=team*4+1;player<=team*4+4;player++)h.press(`שיבוץ שחקן ${player}`);
    }
  }else for(let i=1;i<=12;i++)h.press(`שיבוץ שחקן ${i}`);
  expect(h.button().props.disabled).toBe(false);await h.next();expect(copy(h.render())).toContain('בדיקה לפני שמירה');
  expect(h.props.onSave).not.toHaveBeenCalled();
});

test.each(['stale','busy'])('%s blocks the final confirmation',async flag=>{
  const h=harness();await h.next();await h.next();await h.next();await h.next();h.press('אישור איפוס המשחק הנוכחי בלבד');
  (h.props as any)[flag]=true;expect(h.button().props.disabled).toBe(true);expect(h.props.onSave).not.toHaveBeenCalled();
});

test('rating method uses current registered guests and history, without saving while generating',async()=>{
  const h=harness();for(const i of [13,14,15])h.press(`שחקן ${i}`);await h.next();h.press('לפי דירוג');await h.next();
  expect(h.props.loadHistory).toHaveBeenCalledTimes(1);expect(h.props.onSave).not.toHaveBeenCalled();expect(copy(h.render())).toContain('הקבוצות להמשך');
});

test('player photos and avatars follow their identities through selection, team swaps and review',async()=>{
  const h=harness();
  const id=h.props.game.players[0];h.props.players[id].photoUrl='https://example.invalid/player.jpg';
  const avatar=nodes(h.render()).find(n=>n.type==='Avatar'&&n.props.user.id===id);
  expect(avatar.props.user).toMatchObject({id,avatarId:'a13',photoUrl:'https://example.invalid/player.jpg'});
  for(const i of [13,14,15])h.press(`שחקן ${i}`);
  await h.next();h.press('חלוקה אקראית');await h.next();
  const cards=nodes(h.render()).filter(n=>n.type===DraftTeamCard);
  const first=cards[0].props.captain,second=cards[1].props.captain;
  h.press(`בחירת ${first.name} להחלפה`);
  expect(nodes(h.render()).find(n=>n.type==='Pressable'&&n.props.accessibilityLabel===`בחירת ${first.name} להחלפה`).props.accessibilityState.selected).toBe(true);
  h.press(`בחירת ${second.name} להחלפה`);
  const swapped=nodes(h.render()).filter(n=>n.type===DraftTeamCard);
  expect(swapped[0].props.captain.id).toBe(second.id);expect(swapped[1].props.captain.id).toBe(first.id);
  await h.next();
  const reviewed=nodes(h.render()).find(n=>n.type==='Avatar'&&n.props.user.id===id);
  expect(reviewed.props.user).toEqual(h.props.players[id]);
  expect(h.props.onSave).not.toHaveBeenCalled();
});

test('registered guests keep their roster ids and avatar fallback in the player picker',()=>{
  const h=harness();h.props.game.guests=[{id:'visitor',name:'אורח לדוגמה',addedBy:h.props.game.players[0],createdAt:1}];
  h.props.players['guest:visitor']={id:'guest:visitor',name:'אורח לדוגמה'};
  expect(nodes(h.render()).find(n=>n.type==='Avatar'&&n.props.user.id==='guest:visitor').props.user).toEqual({id:'guest:visitor',name:'אורח לדוגמה'});
  h.press('אורח לדוגמה');
  expect(nodes(h.render()).find(n=>n.type==='Pressable'&&n.props.accessibilityLabel==='אורח לדוגמה').props.accessibilityState.checked).toBe(false);
});
