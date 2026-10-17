import React from 'react';
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
function extractedControls(kind:'goals'|'controls',context:any){
 const file=screenSource();let stylesCode='',jsx='';
 const visit=(node:ts.Node)=>{
  if(ts.isVariableDeclaration(node)&&node.name.getText(file)==='styles')stylesCode=node.initializer!.getText(file);
  if(ts.isJsxElement(node)&&node.openingElement.tagName.getText(file)==='View'){
   const source=node.getText(file),opening=node.openingElement.getText(file);
   if(kind==='goals'&&opening==='<'+'View style={styles.row}>'&&source.includes('styles.quickGoal'))jsx=source;
   if(kind==='controls'&&opening.includes('styles.controlRow')&&source.includes('styles.quickControl'))jsx=source;
  }
  ts.forEachChild(node,visit);
 };visit(file);if(!jsx||!stylesCode)throw Error('control source missing');
 const js=ts.transpileModule(`const styles=${stylesCode};exports.result=(${jsx});`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const exports:any={};vm.runInNewContext(js,{exports,require,View:'View',Pressable:'Pressable',Text:'Text',Ionicons:'Icon',ActivityIndicator:'Busy',RTL_LABEL_ALIGN:'left',StyleSheet:{create:(value:unknown)=>value},spacing:{xs:4,sm:8,md:12,lg:16,xl:20,xxl:24},typography:{},colors:{},overlaySurfaces:{dialog:{},sheet:{}},overlayTheme:{},...context});return exports.result;
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

test('goal controls retain team colours, white-team black ink and direct side selection with flexible labels',()=>{
 const request=jest.fn();const tree=extractedControls('goals',{compactControls:true,canEnterGoals:true,rotation:{playing:[0,1]},draftTeams:{teams:[{index:0,colorKey:'yellow'},{index:1,colorKey:'white'}]},teamName:(index:number)=>index===0?'הצהובים':'הלבנים',teamColor:(index:number)=>index===0?'#EAB308':'#E5E7EB',setGoalRequest:request,Date});
 const actions=nodes(tree,'Pressable');expect(actions.map(action=>action.props.accessibilityLabel)).toEqual(['גול לצהובים','גול ללבנים']);
 expect(actions.map(action=>flatten(action.props.style).backgroundColor)).toEqual(['#EAB308','#E5E7EB']);
 expect(nodes(tree,'Text').map(label=>flatten(label.props.style).color)).toEqual(['#FFFFFF','#000000']);
  nodes(tree,'Text').forEach(label=>{expect(label.props.numberOfLines).toBe(1);expect(label.props.minimumFontScale).toBe(0.75);expect(label.props.adjustsFontSizeToFit).toBe(true);expect(flatten(label.props.style).flexShrink).toBe(1);expect(flatten(label.props.style).flex).toBeUndefined();});
 actions.forEach(action=>action.props.onPress());expect(request.mock.calls.map(call=>call[0].side)).toEqual(['A','B']);
});
