import React from 'react';

let mockSelected:'penalties'|'manual'|'bothOut'|'endEvening'|'draw'|null=null;
let mockStaySide:'A'|'B'|null=null;
let mockStateCall=0;
let mockConfirming={current:false};
let mockEffects:Array<()=>void>=[];
jest.mock('react',()=>({...jest.requireActual('react'),useState:()=>mockStateCall++%2===0?[mockSelected,(next:typeof mockSelected)=>{mockSelected=next;}]:[mockStaySide,(next:typeof mockStaySide)=>{mockStaySide=next;}],useRef:()=>mockConfirming,useEffect:(effect:()=>void)=>{mockEffects.push(effect);}}));
jest.mock('react-native',()=>({Pressable:'Pressable',ScrollView:'ScrollView',Text:'Text',View:'View',StyleSheet:{create:(value:unknown)=>value},useWindowDimensions:()=>({height:820,width:390,fontScale:1})}));
jest.mock('@expo/vector-icons',()=>({Ionicons:'Icon'}));
jest.mock('react-native-svg',()=>({__esModule:true,default:'Svg',Circle:'Circle',Path:'Path',Rect:'Rect'}));
jest.mock('@/components/SafeModal',()=>({SafeModal:'Modal'}));
jest.mock('@/theme',()=>({RTL_LABEL_ALIGN:'left',colors:{text:'#111',textMuted:'#666',primary:'#2563EB',surfaceMuted:'#EEE',border:'#DDD'}}));
jest.mock('@/theme/overlays',()=>({overlaySurfaces:{dialog:{}},overlayTheme:{backdrop:'#0008'}}));
jest.mock('@/components/match/MatchResultPanel',()=>({MatchResultPanel:'ResultPanel'}));
jest.mock('@/components/match/TeamShirt',()=>({TeamShirtIllustration:'Shirt'}));
jest.mock('@/components/match/rotationView',()=>({teamColor:()=> '#AAA',teamName:(index:number)=>String(index)}));
jest.mock('@/components/match/ShootoutWizard',()=>({Shootout:'Shootout'}));
import {TieDecisionModal} from '@/components/match/Shootout';
import {he} from '@/i18n/he';

function buttons(node:any):any[]{
 if(!node || typeof node!=='object')return [];
 if(Array.isArray(node))return node.flatMap(buttons);
 return [...(node.type==='Pressable'?[node]:[]),...buttons(node.props?.children)];
}
function props(count=4){return {visible:true,draftTeams:{teams:Array.from({length:count},(_,index)=>({index}))},rotation:{playing:[0,1],waiting:count>3?[2,3]:count===3?[2]:[],round:1},live:{scoreA:2,scoreB:2},onClose:jest.fn(),onManual:jest.fn(),onPenalties:jest.fn(),onBothOut:jest.fn()} as any;}
beforeEach(()=>{mockSelected=null;mockStaySide=null;mockStateCall=0;mockConfirming={current:false};mockEffects=[];});
test('embedded decision content has no second native modal and shares the penalty frame height',()=>{
 const tree:any=TieDecisionModal({...props(),embedded:true});expect(tree.type).toBe('Pressable');
 const card=buttons(tree).find(n=>n.props.testID==='tie-decision-dialog');expect(Object.assign({},...card.props.style.filter(Boolean))).toMatchObject({height:680,maxHeight:680});
});
const choices=[['penalties','onPenalties',he.shDecidePenalties],['manual','onManual',he.shDecideManual],['bothOut','onBothOut',he.shDecideBothOut]] as const;
const callbacks=(input:any)=>[input.onPenalties,input.onManual,input.onBothOut];

test('the chooser starts with a visible disabled confirmation and no selected option',()=>{
 const input=props(),actions=buttons(TieDecisionModal(input));
 expect(actions.filter(button=>button.props.accessibilityState?.selected)).toHaveLength(0);
 const confirm=actions.find(button=>button.props.accessibilityLabel===he.shDecideConfirm);
 expect(confirm.props.disabled).toBe(true);expect(confirm.props.accessibilityState.disabled).toBe(true);
 confirm.props.onPress();callbacks(input).forEach(action=>expect(action).not.toHaveBeenCalled());
});

test.each(choices)('selecting %s only marks it; confirmation runs exactly that action once',(choice,callback,label)=>{
 const input=props();let actions=buttons(TieDecisionModal(input));
 expect(actions.find(button=>button.props.accessibilityLabel===he.liveEndMatchConfirm)).toBeUndefined();
 actions.find(button=>button.props.accessibilityLabel===label).props.onPress();
 callbacks(input).forEach(action=>expect(action).not.toHaveBeenCalled());
 actions=buttons(TieDecisionModal(input));
 expect(actions.find(button=>button.props.accessibilityLabel===label).props.accessibilityState.selected).toBe(true);
 const confirm=actions.find(button=>button.props.accessibilityLabel===(choice==='bothOut'?he.liveEndMatchConfirm:he.shDecideConfirm));
 expect(confirm.props.disabled).toBe(false);expect(confirm.props.accessibilityState.disabled).toBe(false);
 confirm.props.onPress();confirm.props.onPress();
 expect(input[callback]).toHaveBeenCalledTimes(1);
 callbacks(input).filter(action=>action!==input[callback]).forEach(action=>expect(action).not.toHaveBeenCalled());
});
test.each([2,3])('with %s teams neither both-out nor its confirmation is available',count=>{
 mockSelected='bothOut';const input=props(count),actions=buttons(TieDecisionModal(input));
 expect(actions.find(button=>button.props.accessibilityLabel===he.shDecideBothOut)).toBeUndefined();
 expect(actions.find(button=>button.props.accessibilityLabel===he.liveEndMatchConfirm)).toBeUndefined();
 const confirm=actions.find(button=>button.props.accessibilityLabel===he.shDecideConfirm);
 expect(confirm.props.disabled).toBe(true);confirm.props.onPress();callbacks(input).forEach(action=>expect(action).not.toHaveBeenCalled());
});
test.each(choices)('busy %s confirmation cannot run even if its handler is called',(choice,_callback,label)=>{
 mockSelected=choice;const input=props();input.busy=true;
 const actions=buttons(TieDecisionModal(input));
 const confirm=actions.find(button=>button.props.accessibilityLabel===(choice==='bothOut'?he.liveEndMatchConfirm:he.shDecideConfirm));
 expect(confirm.props.disabled).toBe(true);confirm.props.onPress();
 actions.find(button=>button.props.accessibilityLabel===label).props.onPress();
 callbacks(input).forEach(action=>expect(action).not.toHaveBeenCalled());
});

test('changing the selected method before confirmation runs only the final choice',()=>{
 const input=props();let actions=buttons(TieDecisionModal(input));
 actions.find(button=>button.props.accessibilityLabel===he.shDecidePenalties).props.onPress();
 actions=buttons(TieDecisionModal(input));
 actions.find(button=>button.props.accessibilityLabel===he.shDecideManual).props.onPress();
 callbacks(input).forEach(action=>expect(action).not.toHaveBeenCalled());
 actions=buttons(TieDecisionModal(input));
 expect(actions.find(button=>button.props.accessibilityLabel===he.shDecidePenalties).props.accessibilityState.selected).toBe(false);
 actions.find(button=>button.props.accessibilityLabel===he.shDecideConfirm).props.onPress();
 expect(input.onManual).toHaveBeenCalledTimes(1);expect(input.onPenalties).not.toHaveBeenCalled();
});

test('closing without confirmation does not resolve or enter another screen',()=>{
 mockSelected='manual';const input=props();
 buttons(TieDecisionModal(input)).find(button=>button.props.accessibilityLabel===he.liveEndMatchReturn).props.onPress();
 expect(input.onClose).toHaveBeenCalledTimes(1);callbacks(input).forEach(action=>expect(action).not.toHaveBeenCalled());
});

test('a new modal context clears the selection and the duplicate-confirm guard',()=>{
 mockSelected='manual';mockConfirming.current=true;
 TieDecisionModal({...props(),visible:false});mockEffects.at(-1)!();
 expect(mockSelected).toBeNull();expect(mockConfirming.current).toBe(false);
 expect(buttons(TieDecisionModal(props())).find(button=>button.props.accessibilityLabel===he.shDecideConfirm).props.disabled).toBe(true);
});

test.each([2,3,4])('the last tied game with %s teams can open evening completion after explicit confirmation', count => {
 const input={...props(count),onEndEvening:jest.fn()};
 buttons(TieDecisionModal(input)).find(b=>b.props.accessibilityLabel==='זה המשחק האחרון, סיום המחזור').props.onPress();
 expect(input.onEndEvening).not.toHaveBeenCalled();
 const confirm=buttons(TieDecisionModal(input)).find(b=>b.props.accessibilityLabel===he.shDecideConfirm);
 confirm.props.onPress();confirm.props.onPress();
 expect(input.onEndEvening).toHaveBeenCalledTimes(1);
 callbacks(input).forEach(action=>expect(action).not.toHaveBeenCalled());
});

test('an unfinished shootout cannot be silently discarded by evening completion',()=>{
 const input={...props(),live:{scoreA:1,scoreB:1,shootout:{kicks:[{id:'kick'}]}},onEndEvening:jest.fn()};
 mockSelected='endEvening';
 const actions=buttons(TieDecisionModal(input));
 expect(actions.find(b=>b.props.accessibilityLabel==='זה המשחק האחרון, סיום המחזור')).toBeUndefined();
 actions.find(b=>b.props.accessibilityLabel===he.shDecideConfirm).props.onPress();
 expect(input.onEndEvening).not.toHaveBeenCalled();
});

function copy(node:any):string {
 if(node==null || typeof node==='boolean')return '';
 if(typeof node!=='object')return String(node);
 return (Array.isArray(node)?node.map(copy).join(' '):copy(node.props?.children)).replace(/\s+/g,' ');
}
test.each(['A','B'] as const)('a three-team draw requires an explicit staying side, previews %s and confirms once',side=>{
 const input={...props(3),onDraw:jest.fn()};
 let tree=TieDecisionModal(input);
 buttons(tree).find(b=>b.props.accessibilityLabel==='סיום בתיקו').props.onPress();
 tree=TieDecisionModal(input);
 expect(mockStaySide).toBeNull();
 expect(copy(tree)).toContain('מי נשארים למשחק הבא?');
 const disabled=buttons(tree).find(b=>b.props.accessibilityLabel==='שמירת תיקו והמשך');
 expect(disabled.props.disabled).toBe(true);disabled.props.onPress();expect(input.onDraw).not.toHaveBeenCalled();
 buttons(tree).find(b=>b.props.accessibilityLabel===`${side==='A'?0:1} נשארים`).props.onPress();
 tree=TieDecisionModal(input);
 expect(copy(tree)).toContain(`${side==='A'?1:0} יוצאים למנוחה`);
 expect(copy(tree)).toContain('2 נכנסים');
 expect(copy(tree)).toContain(side==='A'?'המשחק הבא: 0 מול 2':'המשחק הבא: 2 מול 1');
 const confirm=buttons(tree).find(b=>b.props.accessibilityLabel==='שמירת תיקו והמשך');
 expect(confirm.props.disabled).toBe(false);confirm.props.onPress();confirm.props.onPress();
 expect(input.onDraw).toHaveBeenCalledTimes(1);expect(input.onDraw).toHaveBeenCalledWith(side);
 callbacks(input).forEach(action=>expect(action).not.toHaveBeenCalled());
});
test('two-team draw keeps the two teams and needs no staying-side choice',()=>{
 const input={...props(2),onDraw:jest.fn()};
 buttons(TieDecisionModal(input)).find(b=>b.props.accessibilityLabel==='סיום בתיקו').props.onPress();
 const tree=TieDecisionModal(input);expect(copy(tree)).not.toContain('מי נשארים למשחק הבא?');
 expect(copy(tree)).toContain('המשחק הבא: 0 מול 1');
 buttons(tree).find(b=>b.props.accessibilityLabel==='שמירת תיקו והמשך').props.onPress();
 expect(input.onDraw).toHaveBeenCalledWith(null);
});
test('staying choice can be changed before saving and is cleared with the game context',()=>{
 const input={...props(3),onDraw:jest.fn()};mockSelected='draw';mockStaySide='A';
 buttons(TieDecisionModal(input)).find(b=>b.props.accessibilityLabel==='1 נשארים').props.onPress();
 expect(copy(TieDecisionModal(input))).toContain('0 יוצאים למנוחה');
 mockEffects.at(-1)!();expect(mockStaySide).toBeNull();expect(mockSelected).toBeNull();
 expect(input.onDraw).not.toHaveBeenCalled();
});
test.each([4,5])('draw staying choices are not offered to %s teams',count=>{
 expect(copy(TieDecisionModal({...props(count),onDraw:jest.fn()}))).not.toContain('סיום בתיקו');
});
