jest.mock('@/services/errorLog',()=>({logError:jest.fn()}));
import React from 'react';

let mockChoice:'penalties'|'manual'|'bothOut'|null=null;
let mockConfirming={current:false};
let mockDimensions={height:820,width:390,fontScale:1};
jest.mock('react',()=>({...jest.requireActual('react'),useState:()=>[mockChoice,(next:typeof mockChoice)=>{mockChoice=next;}],useRef:()=>mockConfirming,useEffect:()=>{}}));
jest.mock('react-native',()=>({Pressable:'Pressable',ScrollView:'ScrollView',Text:'Text',View:'View',StyleSheet:{create:(value:unknown)=>value,hairlineWidth:1},useWindowDimensions:()=>mockDimensions}));
jest.mock('@expo/vector-icons',()=>({Ionicons:'Icon'}));
jest.mock('react-native-svg',()=>({__esModule:true,default:'Svg',Circle:'Circle',Path:'Path',Rect:'Rect'}));
jest.mock('@/components/SafeModal',()=>({SafeModal:'Modal'}));
jest.mock('@/theme',()=>({RTL_LABEL_ALIGN:'left',colors:{text:'#111',textMuted:'#666',primary:'#2563EB',surfaceMuted:'#EEE',surface:'#FFF',border:'#DDD'},spacing:{xl:20,lg:16,sm:8,md:12},typography:{h2:{fontSize:23},body:{fontSize:15}}}));
jest.mock('@/theme/overlays',()=>({overlaySurfaces:{dialog:{}},overlayTheme:{backdrop:'#0008'}}));
jest.mock('@/components/match/MatchResultPanel',()=>({MatchResultPanel:'ResultPanel'}));
jest.mock('@/components/match/TeamShirt',()=>({TeamShirtIllustration:'Shirt'}));
jest.mock('@/components/match/rotationView',()=>({teamColor:()=> '#22C55E',makeResolver:(players:any)=>(id:string)=>players[id]??{},buildRoster:(index:number,teams:any[],_rotation:unknown,resolve:(id:string)=>any)=>teams.find(team=>team.index===index)?.playerIds.map((id:string)=>({id,name:resolve(id).displayName??id,isFiller:false}))??[],teamName:(index:number)=>['הירוקים','הכחולים','האדומים','הכתומים','השחורים'][index]}));
jest.mock('@/components/match/ShootoutWizard',()=>({Shootout:'Shootout'}));
import {TieDecisionModal} from '@/components/match/Shootout';
jest.mock('@/components/match/TeamScore',()=>({TeamScore:'TeamScore'}));
import {WinnerPickerModal} from '@/components/match/WinnerPickerModal';
import {EndMatchModal} from '@/components/match/EndMatchModal';
import {he} from '@/i18n/he';

function nodes(node:any,type?:string):any[]{
 if(!node||typeof node!=='object')return [];
 if(Array.isArray(node))return node.flatMap(child=>nodes(child,type));
 return [...(!type||node.type===type?[node]:[]),...nodes(node.props?.children,type)];
}
function content(node:any):string {
 if(node==null||typeof node==='boolean')return '';
 if(typeof node==='string'||typeof node==='number')return String(node);
 if(Array.isArray(node))return node.map(content).join('');
 return content(node.props?.children);
}
const base=(count=3)=>({visible:true,busy:false,draftTeams:{teams:Array.from({length:count},(_,index)=>({index,playerIds:[]}))},rotation:{round:1,playing:[0,1],waiting:count>3?[2,3]:count===3?[2]:[],loans:[]},live:{scoreA:1,scoreB:1},onClose:jest.fn()});
const footer=(tree:any,id:string)=>nodes(tree,'View').find(node=>node.props.testID===id);
const button=(tree:any,label:string)=>nodes(tree,'Pressable').find(node=>node.props.accessibilityLabel===label||content(node)===label);

beforeEach(()=>{mockChoice=null;mockConfirming={current:false};mockDimensions={height:820,width:390,fontScale:1};});

test.each([3,5])('with %s teams tie confirmation and return remain outside the scrolling result/options',count=>{
 const input={...base(count),onPenalties:jest.fn(),onManual:jest.fn(),onBothOut:jest.fn()} as any;
 const tree=TieDecisionModal(input),actions=footer(tree,'tie-decision-actions'),scroll=nodes(tree,'ScrollView')[0];
 expect(actions).toBeDefined();expect(actions.props.style.flexShrink).toBe(0);
 const scrollStyle=Object.assign({},...scroll.props.style.filter(Boolean));
 expect(scrollStyle).toMatchObject({flexGrow:1,flexShrink:1,flexBasis:0,minHeight:0});
 const surface=nodes(tree,'Pressable').find(node=>Array.isArray(node.props.style)&&Object.assign({},...node.props.style.filter(Boolean)).maxWidth===420);
 expect(Object.assign({},...surface.props.style.filter(Boolean)).height).toBeLessThanOrEqual(700);
 expect(nodes(scroll).some(node=>node===actions)).toBe(false);
 expect(nodes(scroll,'ResultPanel')).toHaveLength(1);
 expect(button(scroll,he.shDecidePenalties)).toBeDefined();expect(button(scroll,he.shDecideManual)).toBeDefined();
 expect(nodes(actions,'Pressable')).toHaveLength(2);
 const confirm=button(actions,he.shDecideConfirm);expect(confirm.props.disabled).toBe(true);
 confirm.props.onPress();expect(input.onPenalties).not.toHaveBeenCalled();
 button(actions,he.liveEndMatchReturn).props.onPress();expect(input.onClose).toHaveBeenCalledTimes(1);
 expect(nodes(actions,'Text').every(node=>node.props.maxFontSizeMultiplier===undefined)).toBe(true);
});

test.each([
 ['penalties',he.shDecidePenalties,'onPenalties'],
 ['manual',he.shDecideManual,'onManual'],
 ['bothOut',he.shDecideBothOut,'onBothOut'],
] as const)('fixed %s confirmation still runs the selected method only once',(_choice,label,callback)=>{
 const input={...base(5),onPenalties:jest.fn(),onManual:jest.fn(),onBothOut:jest.fn()} as any;
 let tree=TieDecisionModal(input);const reserved=footer(tree,'tie-decision-actions').props.style;
 button(nodes(tree,'ScrollView')[0],label).props.onPress();tree=TieDecisionModal(input);
 const actions=footer(tree,'tie-decision-actions');expect(actions.props.style).toBe(reserved);
 const confirm=button(actions,_choice==='bothOut'?he.liveEndMatchConfirm:he.shDecideConfirm);
 expect(confirm.props.disabled).toBe(false);confirm.props.onPress();confirm.props.onPress();
 expect(input[callback]).toHaveBeenCalledTimes(1);
 ['onPenalties','onManual','onBothOut'].filter(key=>key!==callback).forEach(key=>expect(input[key]).not.toHaveBeenCalled());
});

test('busy fixed tie actions remain visible and cannot confirm or close',()=>{
 mockChoice='penalties';const input={...base(3),busy:true,onPenalties:jest.fn(),onManual:jest.fn(),onBothOut:jest.fn()} as any;
 const actions=footer(TieDecisionModal(input),'tie-decision-actions');
 const confirm=button(actions,he.shDecideConfirm),close=button(actions,he.liveEndMatchReturn);
 expect(confirm.props.disabled).toBe(true);expect(close.props.disabled).toBe(true);
 confirm.props.onPress();close.props.onPress();expect(input.onPenalties).not.toHaveBeenCalled();expect(input.onClose).not.toHaveBeenCalled();
});

test('winner confirmation uses the same fixed-actions layout while the score and next teams can scroll',()=>{
 const input={...base(3),live:{scoreA:2,scoreB:1},onConfirm:jest.fn()} as any;
 const tree=EndMatchModal(input),actions=footer(tree,'end-match-actions'),scroll=nodes(tree,'ScrollView')[0];
 expect(actions.props.style.flexShrink).toBe(0);expect(Object.assign({},...scroll.props.style.filter(Boolean)).flexShrink).toBe(1);
 expect(nodes(scroll).some(node=>node===actions)).toBe(false);expect(nodes(scroll,'ResultPanel')).toHaveLength(1);
 expect(content(scroll)).toContain(he.liveEndMatchNext);
 expect(input.onConfirm).not.toHaveBeenCalled();button(actions,he.liveEndMatchReturn).props.onPress();expect(input.onClose).toHaveBeenCalledTimes(1);
 button(actions,he.liveEndMatchConfirm).props.onPress();expect(input.onConfirm).toHaveBeenCalledTimes(1);
 expect(nodes(actions,'Text').every(node=>node.props.maxFontSizeMultiplier===undefined)).toBe(true);
});


test.each(['tie','winner'] as const)('small enlarged %s dialogs bound the scrolling viewport above fixed actions',kind=>{
 mockDimensions={height:569,width:320,fontScale:1.4};
 const input={...base(5),live:{scoreA:kind==='tie'?1:2,scoreB:1},onPenalties:jest.fn(),onManual:jest.fn(),onBothOut:jest.fn(),onConfirm:jest.fn()} as any;
 const tree=kind==='tie'?TieDecisionModal(input):EndMatchModal(input),scroll=nodes(tree,'ScrollView')[0];
 const scrollStyle=Object.assign({},...scroll.props.style.filter(Boolean));
 expect(scrollStyle).toMatchObject({flexGrow:1,flexShrink:1,flexBasis:0,minHeight:0});
 const surface=nodes(tree).find(node=>Array.isArray(node.props.style)&&Object.assign({},...node.props.style.filter(Boolean)).maxWidth===420);
 const surfaceStyle=Object.assign({},...surface.props.style.filter(Boolean));
 expect(surfaceStyle.height).toBeLessThan(mockDimensions.height-32);expect(surfaceStyle.maxHeight).toBe(surfaceStyle.height);
 expect(surfaceStyle.height).toBeGreaterThan(300);
 const actions=footer(tree,kind==='tie'?'tie-decision-actions':'end-match-actions');
 expect(nodes(scroll).some(node=>node===actions)).toBe(false);expect(actions.props.style.flexShrink).toBe(0);
 if(kind==='tie'){button(scroll,he.shDecideManual).props.onPress();const ready=TieDecisionModal(input);button(footer(ready,'tie-decision-actions'),he.shDecideConfirm).props.onPress();expect(input.onManual).toHaveBeenCalledTimes(1);}
 else {button(actions,he.liveEndMatchConfirm).props.onPress();expect(input.onConfirm).toHaveBeenCalledTimes(1);}
});


test.each([4,7,11])('manual winner picker retains both %s-player rosters inside a bounded scroll area with visible actions',size=>{
 mockDimensions={height:569,width:320,fontScale:1.4};
 const input={...base(3),playersMap:{},onPick:jest.fn()} as any;
 input.draftTeams.teams[0].playerIds=Array.from({length:size},(_,index)=>'a'+index);input.draftTeams.teams[1].playerIds=Array.from({length:size},(_,index)=>'b'+index);
 let tree=WinnerPickerModal(input),scroll=nodes(tree,'ScrollView')[0],actions=footer(tree,'winner-picker-actions');
 expect(scroll.props.style).toMatchObject({flexGrow:1,flexShrink:1,flexBasis:0,minHeight:0});
 expect(actions.props.style.flexShrink).toBe(0);expect(nodes(scroll).some(node=>node===actions)).toBe(false);
 expect(nodes(tree,'TeamScore').map(node=>node.props.roster.length)).toEqual([size,size]);
 const surface=nodes(tree,'Pressable').find(node=>Array.isArray(node.props.style)&&Object.assign({},...node.props.style.filter(Boolean)).maxWidth===380);
 expect(Object.assign({},...surface.props.style.filter(Boolean)).height).toBe(489);
 expect(button(actions,he.winnerPickConfirm).props.disabled).toBe(true);button(actions,he.winnerPickConfirm).props.onPress();expect(input.onPick).not.toHaveBeenCalled();
 button(scroll,'הכחולים').props.onPress();tree=WinnerPickerModal(input);actions=footer(tree,'winner-picker-actions');
 expect(button(tree,'הכחולים').props.accessibilityState.selected).toBe(true);expect(input.onPick).not.toHaveBeenCalled();
 expect(button(actions,he.winnerPickConfirm).props.disabled).toBe(false);button(actions,he.winnerPickConfirm).props.onPress();
 expect(input.onPick).toHaveBeenCalledWith(1);expect(input.onClose).toHaveBeenCalledTimes(1);
});

test('manual winner cancellation leaves the round untouched even after selecting a team',()=>{
 const input={...base(3),playersMap:{},onPick:jest.fn()} as any;
 let tree=WinnerPickerModal(input);button(tree,'הירוקים').props.onPress();tree=WinnerPickerModal(input);
 button(footer(tree,'winner-picker-actions'),he.winnerPickCancel).props.onPress();expect(input.onPick).not.toHaveBeenCalled();expect(input.onClose).toHaveBeenCalledTimes(1);
});


test('end-match scrolling has no competing Pressable ancestor and requests a compact decorative result on small screens',()=>{
 mockDimensions={height:569,width:320,fontScale:1.4};
 const input={...base(3),live:{scoreA:3,scoreB:1},onConfirm:jest.fn()} as any;
 const tree=EndMatchModal(input),scroll=nodes(tree,'ScrollView')[0];
 expect(nodes(tree,'Pressable').filter(node=>nodes(node).includes(scroll))).toHaveLength(0);
 expect(nodes(tree,'ResultPanel')[0].props.compact).toBe(true);
 expect(footer(tree,'end-match-actions')).toBeDefined();
 expect(content(scroll)).toContain(he.liveEndMatchNext);
});
