import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import React from 'react';

function fixture(width=411,fontScale=1){
 let state:any;const hook:any=(select:any)=>select(state);hook.getState=()=>state;
 const create=(init:any)=>{state=init((patch:any)=>Object.assign(state,patch));return hook;};
 const exports:any={};const deps:any={react:{...React,default:React},'react-native':{View:'View',Text:'Text',Pressable:'Pressable',ScrollView:'ScrollView',StyleSheet:{create:(v:any)=>v},useWindowDimensions:()=>({width,height:850,fontScale})},
  '@expo/vector-icons':{Ionicons:'Icon'},zustand:{create},'@/components/SafeModal':{SafeModal:'Modal'},'@/components/Button':{Button:'Button'},'@/components/anim/SpringSheet':{SpringSheet:'Sheet'},
  '@/theme/overlays':{overlaySurfaces:{dialog:{}}},'@/theme':{RTL_LABEL_ALIGN:'left',colors:{primary:'blue',danger:'red',text:'black',textMuted:'gray'},spacing:{sm:8,md:12,lg:16,xl:20},typography:{h3:{},body:{}}},'@/i18n/he':{he:{infoTipGotIt:'הבנתי'}}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/AppDialog.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText,{exports,require:(id:string)=>deps[id]??{}});
 return exports;
}
const nodes=(n:any):any[]=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
test.each([[411,1,false],[320,1,true],[411,1.4,true]] as const)('compact live confirmation at width %s and font %s keeps themed actions reachable (stacked %s)',(width,fontScale,stacked)=>{
 const f=fixture(width,fontScale),confirm=jest.fn();f.appAlert('הלך הביתה?','הסבר',[{text:'בטל',style:'cancel'},{text:'הלך הביתה',style:'destructive',onPress:confirm}],{football:true,icon:'exit-outline'});
 const tree=f.AppDialogHost(),all=nodes(tree),icon=all.find(n=>n.type==='Icon');expect(icon.props).toMatchObject({name:'exit-outline',size:22});
 const buttons=all.filter(n=>n.type==='Button');expect(buttons.map(n=>n.props.variant)).toEqual(['secondary','primary']);expect(buttons[1].props.style).toEqual({backgroundColor:'red',borderColor:'red'});
 expect(buttons.every(n=>n.props.fullWidth)).toBe(true);expect(buttons[1].props.size).toBe('md');
 const footer=all.find(n=>Array.isArray(n.props?.style)&&n.props.style[0]?.justifyContent==='flex-end');expect(!!footer.props.style[1]).toBe(stacked);
 buttons[1].props.onPress();expect(confirm).toHaveBeenCalledTimes(1);expect(f.AppDialogHost().props.visible).toBe(false);
});
test('cancel closes the live dialog without invoking its destructive action',()=>{
 const f=fixture(),confirm=jest.fn();f.appAlert('לאפס?','הסבר',[{text:'בטל',style:'cancel'},{text:'אפס',style:'destructive',onPress:confirm}],{football:true,icon:'refresh-outline'});
 nodes(f.AppDialogHost()).find(n=>n.type==='Button'&&n.props.title==='בטל').props.onPress();expect(confirm).not.toHaveBeenCalled();expect(f.AppDialogHost().props.visible).toBe(false);
});
test('actual live handlers request the same home icon as the player menu and a matching styled reset dialog',()=>{
 const screen=fs.readFileSync('src/screens/AdvancedLiveMatchScreen.tsx','utf8');expect(screen).toContain("{ football: true, icon: 'exit-outline' }");expect(screen).toContain("{ football: true, icon: 'refresh-outline' }");
 expect(fs.readFileSync('src/components/match/RotationPanel.tsx','utf8')).toContain("icon: 'exit-outline'");
});
