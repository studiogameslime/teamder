import React from 'react';
jest.mock('@/components/match/InPlayPenaltyModal',()=>({InPlayPenaltyModal:'InPlayPenaltyModal'}));
import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
let mockDimensions={width:320,height:569,fontScale:1.4};
jest.mock('react',()=>({...jest.requireActual('react'),useState:(initial:any)=>[typeof initial==='function'?initial():initial,jest.fn()],useRef:(value:any)=>({current:value}),useMemo:(make:()=>unknown)=>make(),useEffect:()=>{}}));
jest.mock('react-native',()=>({Image:'Image',Pressable:'Pressable',ScrollView:'ScrollView',Text:'Text',View:'View',useWindowDimensions:()=>mockDimensions,StyleSheet:{create:(value:unknown)=>value,absoluteFillObject:{},hairlineWidth:1}}));
jest.mock('react-native-reanimated',()=>({__esModule:true,default:{View:'AnimatedView',Text:'AnimatedText'},cancelAnimation:()=>{},useAnimatedStyle:(make:()=>unknown)=>make(),useSharedValue:(value:unknown)=>({value}),withRepeat:(value:unknown)=>value,withSequence:(value:unknown)=>value,withTiming:(value:unknown)=>value}));
jest.mock('@expo/vector-icons',()=>({Ionicons:'Icon'}));
jest.mock('expo-linear-gradient',()=>({LinearGradient:'Gradient'}));
jest.mock('@/components/AppDialog',()=>({appAlert:jest.fn()}));
jest.mock('@/components/SafeModal',()=>({SafeModal:'Modal'}));
jest.mock('@/components/UserAvatar',()=>({UserAvatar:'Avatar'}));
jest.mock('@/components/Toast',()=>({toast:{error:jest.fn()}}));
jest.mock('@/components/anim/ChangeMotion',()=>({ChangeMotion:'Motion'}));
jest.mock('@/components/match/GoalEntryModal',()=>({GoalEntryModal:'GoalEntry'}));
jest.mock('@/components/match/TeamShirt',()=>({TeamShirtIllustration:'Shirt'}));
jest.mock('@/components/match/rotationView',()=>({
 makeResolver:(players:any)=>(id:string)=>players[id]??{},buildRoster:()=>[],
 teamName:(index:number)=>['הצהובים','הכחולים'][index],teamColor:(index:number)=>['#EAB308','#3B82F6'][index],teamTextColor:()=> '#334155',
}));
jest.mock('@/services/gameService',()=>({gameService:{recordGoal:jest.fn(),removeGoal:jest.fn()}}));
jest.mock('@/services/analyticsService',()=>({AnalyticsEvent:{},logEvent:jest.fn()}));
jest.mock('@/services/rotationEngine',()=>({roundCommitKey:()=> 'one'}));
jest.mock('@/theme',()=>({RTL_LABEL_ALIGN:'left',colors:{primary:'#2563EB'},spacing:{xs:4,sm:8,md:12,lg:16,xl:20},radius:{lg:18,md:12,pill:99},typography:{bodyBold:{fontSize:16},caption:{fontSize:12},body:{fontSize:14},h2:{fontSize:23}}}));
jest.mock('@/theme/overlays',()=>({overlaySurfaces:{dialog:{}},overlayTheme:{backdrop:'#0008'}}));
jest.mock('@/assets/images/live-scoreboard-pitch.png',()=> 'pitch');
import {LiveScoreboardCard} from '@/components/match/LiveScoreboardCard';
import {MatchResultPanel} from '@/components/match/MatchResultPanel';

function expand(node:any):any {
 if(!node||typeof node!=='object')return node;
 if(Array.isArray(node))return node.map(expand);
 if(typeof node.type==='function')return expand(node.type(node.props));
 return {...node,props:{...node.props,children:expand(node.props?.children)}};
}
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
const flatten=(style:any)=>Object.assign({},...(Array.isArray(style)?style:[style]).filter(Boolean));
const props=(timerText='00:00')=>({gameId:'test',live:{scoreA:3,scoreB:1,goals:[]},draftTeams:{teams:[{index:0,colorKey:'yellow',playerIds:[]},{index:1,colorKey:'blue',playerIds:[]}]},rotation:{playing:[0,1],loans:[],round:1},playersMap:{},minute:0,canEdit:true,hideGoalButtons:true,timerText,totalMinutes:8,statusLabel:'מוכן',running:false,danger:false,stoppagesText:'0 עצירות · 00:00',roundNumber:1} as any);
beforeEach(()=>{mockDimensions={width:320,height:569,fontScale:1.4};});

test.each(['00:00','108:59'])('small enlarged scoreboard retains the complete %s clock and full team identities',timer=>{
 const tree=expand(LiveScoreboardCard(props(timer)));
 const clock=nodes(tree,'AnimatedText').find(node=>content(node)===timer);
 expect(clock).toBeDefined();expect(clock.props.accessibilityLabel).toBe(timer);expect(clock.props.adjustsFontSizeToFit).toBe(true);
 expect(clock.props.numberOfLines).toBe(1);expect(clock.props.minimumFontScale).toBeLessThan(1);expect(flatten(clock.props.style).fontSize).toBe(28);
 for(const label of ['הצהובים','הכחולים']){
  const name=nodes(tree,'Text').find(node=>content(node)===label);expect(name).toBeDefined();
  expect(name.props.numberOfLines).toBe(1);expect(name.props.adjustsFontSizeToFit).toBe(true);
 }
 expect(nodes(tree,'Shirt').map(node=>node.props.color)).toEqual(['#EAB308','#3B82F6']);
 expect(nodes(tree,'AnimatedText').filter(node=>typeof node.props.children==='number').map(node=>node.props.children)).toEqual([3,1]);
 expect(nodes(tree,'Text').find(node=>content(node)==='0 עצירות · 00:00').props.numberOfLines).toBe(2);
});

test('regular screens retain the larger scoreboard clock and team shirts',()=>{
 mockDimensions={width:430,height:900,fontScale:1};const tree=expand(LiveScoreboardCard(props()));
 const clock=nodes(tree,'AnimatedText').find(node=>content(node)==='00:00');expect(flatten(clock.props.style).fontSize).toBe(38);
 expect(nodes(tree,'Shirt').map(node=>node.props.width)).toEqual([42,42]);
});

test('compact result panels cannot capture scroll gestures and retain score, names and the winner',()=>{
 const input=props();const tree=MatchResultPanel({...input,caption:'הצהובים ניצחו',trophy:true,compact:true});
 expect(tree.props.pointerEvents).toBe('none');expect(nodes(tree,'Pressable')).toHaveLength(0);
 expect(content(tree)).toContain('הצהובים');expect(content(tree)).toContain('הכחולים');expect(content(tree)).toContain('הצהובים ניצחו');
 expect(nodes(tree,'Text').filter(node=>typeof node.props.children==='number').map(node=>node.props.children)).toEqual([3,1]);
});

function screenSource(){const source=fs.readFileSync('src/screens/AdvancedLiveMatchScreen.tsx','utf8');return ts.createSourceFile('AdvancedLiveMatchScreen.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);}
test.each([
 [0,8,1,0,'00:00'],
 [479999,8,8,479999,'07:59'],
 [480000,8,9,480000,'08:00'],
 [630000,8,11,630000,'08:00'],
 [630000,0,11,630000,'10:30'],
])('live event time at %i ms with %i minute limit keeps full elapsed time', (timerMs,totalMinutes,minute,clockMs,timerText)=>{
 const file=screenSource();let attributes:ts.JsxAttributes|undefined;
 const visit=(node:ts.Node)=>{if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(file)==='LiveScoreboardCard')attributes=node.attributes;ts.forEachChild(node,visit);};visit(file);
 if(!attributes)throw Error('Live scoreboard missing');
 const values:any={};const totalMs=totalMinutes*60000;
 for(const name of ['minute','clockMs','timerText']){
  const attribute=attributes.properties.find(prop=>ts.isJsxAttribute(prop)&&prop.name.getText(file)===name) as ts.JsxAttribute;
  const expression=(attribute.initializer as ts.JsxExpression).expression!.getText(file);
  values[name]=vm.runInNewContext(expression,{Math,timerMs,totalMs,clockMs:totalMs>0?Math.min(timerMs,totalMs):timerMs,formatTime:(ms:number)=>`${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`});
 }
 expect(values).toEqual({minute,clockMs,timerText});
});
function extractedControls(kind:'event'|'picker'|'controls',context:any){
 const file=screenSource();let stylesCode='',jsx='';
 const visit=(node:ts.Node)=>{
  if(ts.isVariableDeclaration(node)&&node.name.getText(file)==='styles')stylesCode=node.initializer!.getText(file);
  if(ts.isJsxElement(node)&&node.openingElement.tagName.getText(file)==='View'){
   const source=node.getText(file),opening=node.openingElement.getText(file);
   if(kind==='controls'&&opening.includes('styles.controlRow')&&source.includes('styles.quickControl'))jsx=source;
  }
  if(kind==='event'&&ts.isJsxElement(node)&&node.openingElement.tagName.getText(file)==='Pressable'&&node.openingElement.getText(file).includes('accessibilityLabel="הוסף אירוע"'))jsx=node.getText(file);
  if(kind==='picker'&&ts.isJsxSelfClosingElement(node)&&node.tagName.getText(file)==='MatchEventPicker')jsx=node.getText(file);
  ts.forEachChild(node,visit);
 };visit(file);if(!jsx||!stylesCode)throw Error('control source missing');
 const js=ts.transpileModule(`const styles=${stylesCode};exports.result=(${jsx});`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const exports:any={};vm.runInNewContext(js,{exports,require,View:'View',Pressable:'Pressable',Text:'Text',MatchEventPicker:'Picker',Ionicons:'Icon',ActivityIndicator:'Busy',RTL_LABEL_ALIGN:'left',StyleSheet:{create:(value:unknown)=>value},spacing:{xs:4,sm:8,md:12,lg:16,xl:20,xxl:24},typography:{},colors:{},overlaySurfaces:{dialog:{},sheet:{}},overlayTheme:{},...context});return exports.result;
}

test('small live controls keep the clock on one line and other labels flexible with actions wired',()=>{
 const start=jest.fn(),pause=jest.fn(),resume=jest.fn(),swap=jest.fn(),end=jest.fn();
 const tree=extractedControls('controls',{compactControls:true,roundBusy:false,timerRunning:false,timerStarted:false,onTimerStart:start,onTimerPause:pause,onTimerResume:resume,setSwapOpen:swap,confirmEndRound:end});
 const actions=nodes(tree,'Pressable');expect(actions).toHaveLength(3);
 actions.forEach(action=>expect(flatten(action.props.style).minHeight).toBeGreaterThanOrEqual(56));
 const labels=nodes(tree,'Text');expect(labels.map(content)).toEqual(['התחל זמן','חילוף','סיום משחק']);
 labels.forEach((label,index)=>{expect(label.props.numberOfLines).toBe(index===0?1:2);expect(label.props.minimumFontScale).toBe(index===0?0.65:0.85);expect(label.props.adjustsFontSizeToFit).toBe(true);expect(flatten(label.props.style).minWidth).toBe(0);});
 actions.forEach(action=>action.props.onPress());expect(start).toHaveBeenCalledTimes(1);expect(swap).toHaveBeenCalledWith(true);expect(end).toHaveBeenCalledTimes(1);expect(pause).not.toHaveBeenCalled();expect(resume).not.toHaveBeenCalled();
});

test('one event control opens the picker, keeps the plus after the label for RTL and respects permission',()=>{
 const open=jest.fn();
 const tree=extractedControls('event',{canEnterGoals:true,eventContext:'round-a',setEventPicker:open});
 expect(nodes(tree,'Pressable')).toHaveLength(1);expect(content(tree)).toBe('הוסף אירוע');
 expect(tree.props.children.map((n:any)=>n.type)).toEqual(['Text','Icon']);
 tree.props.onPress();expect(open).toHaveBeenCalledWith({context:'round-a',visible:true});
 const denied=extractedControls('event',{canEnterGoals:false,eventContext:'round-a',setEventPicker:open});
 expect(denied.props.disabled).toBe(true);expect(denied.props.accessibilityState.disabled).toBe(true);
});

test('picker routes each choice to the existing flow and rejects old round context or lost permission',()=>{
 const goal=jest.fn(),penalty=jest.fn();
 const context={canEnterGoals:true,eventContext:'round-a',eventPicker:{context:'round-a',visible:true},rotation:{playing:[2,0]},draftTeams:{teams:[]},teamName:(i:number)=>i===2?'הירוקים':'האדומים',teamColor:()=> '#FF0000',setGoalRequest:goal,setPenaltyRequest:penalty,setEventPicker:jest.fn(),Date};
 const picker=extractedControls('picker',context);
 expect(picker.props.teams.map((t:any)=>t.name)).toEqual(['הירוקים','האדומים']);
 picker.props.onSelect('A');picker.props.onSelect('B');picker.props.onSelect('penalty');
 expect(goal.mock.calls.map(call=>call[0].side)).toEqual(['A','B']);expect(penalty).toHaveBeenCalledTimes(1);
 goal.mockClear();penalty.mockClear();
 for(const overrides of [{canEnterGoals:false},{eventContext:'round-b'}]){
  const blocked=extractedControls('picker',{...context,...overrides});expect(blocked.props.visible).toBe(false);
  blocked.props.onSelect('A');blocked.props.onSelect('penalty');
 }
 expect(goal).not.toHaveBeenCalled();expect(penalty).not.toHaveBeenCalled();
});
