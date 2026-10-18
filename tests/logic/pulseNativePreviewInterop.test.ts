import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import React from 'react';

const tool='scripts/audits/compile-native-preview.cjs';
function compiler(source:string) {
  const result:any={exports:{}};
  vm.runInNewContext(source,{module:result,exports:result.exports,require:(name:string)=>{
    if(name==='fs')return fs;if(name==='typescript')return ts;throw Error(name);
  }});
  return result.exports.compileNativePreview;
}
function render(compile:(file:string)=>string) {
  // Metro returns React's CommonJS exports, which intentionally have no .default.
  const react:any={...React,useState:(value:any)=>[value,()=>{}],useRef:(value:any)=>({current:value}),useCallback:(fn:any)=>fn,useEffect:()=>{}};
  delete react.default;delete react.__esModule;
  const theme={exports:{}};
  vm.runInNewContext(compile('pulse/src/theme.ts'),{module:theme,exports:theme.exports});
  const native:any={StyleSheet:{create:(value:any)=>value},Platform:{OS:'android'},Keyboard:{dismiss:jest.fn()},Alert:{alert:jest.fn()}};
  for(const name of ['ActivityIndicator','AppState','Image','KeyboardAvoidingView','Modal','Pressable','ScrollView','Text','TextInput','View'])native[name]=name;
  const result:any={exports:{}};
  vm.runInNewContext(compile('pulse/src/components/TeamderChatSheet.tsx'),{module:result,exports:result.exports,require:(name:string)=>{
    if(name==='react')return react;
    if(name==='react-native')return native;
    if(name==='react-native-safe-area-context')return {useSafeAreaInsets:()=>({top:0,bottom:0,left:0,right:0})};
    if(name==='@expo/vector-icons')return {Ionicons:'Icon'};
    if(name==='../theme')return theme.exports;
    if(name==='../services/teamderChatService')return {MAX_TEXT:1000,THREAD_WINDOW:100,REPORTS_LIMIT:40};
    throw Error(name);
  }});
  return result.exports.TeamderChatSheet({visible:true,userId:'demo-support',userName:'משתמש הדגמה',onClose:jest.fn()});
}

test('the former native preview compiler reproduces the exact undefined React.createElement crash',()=>{
  const before=fs.readFileSync(tool,'utf8').replace('esModuleInterop: true,','');
  expect(()=>render(compiler(before))).toThrow(/createElement/);
});

test('the actual preview compiler renders the real Pulse sheet with Metro CommonJS React exports',()=>{
  const tree=render(compiler(fs.readFileSync(tool,'utf8')));
  expect(tree.type).toBe('Modal');expect(tree.props.visible).toBe(true);
  const text=(n:any):string=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(' '):n&&typeof n==='object'?text(n.props?.children):'';
  expect(text(tree)).toContain('משתמש הדגמה');
  expect(text(tree)).toContain('נשלח בשם');
});
