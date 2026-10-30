import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';
import path from 'path';
import { execFileSync } from 'child_process';
import { isMissingLinkHandler } from '@/utils/expectedIntegrationError';

function navigationFixture(platform: string, game: Record<string, unknown>) {
 const source=ts.createSourceFile('match.tsx',fs.readFileSync('src/screens/games/MatchDetailsScreen.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let expression='';
 function walk(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='openWaze')expression=node.initializer!.getText(source);ts.forEachChild(node,walk);}
 walk(source);if(!expression)throw Error('openWaze missing');
 const openURL=jest.fn().mockRejectedValueOnce(Error('Unable to open URL: waze')).mockRejectedValueOnce(Error('Unable to open URL: google')).mockResolvedValue(undefined);
 const failNavigation=jest.fn(),observeCaughtError=jest.fn();
 const open=vm.runInNewContext(ts.transpileModule(`(${expression})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{
  game,Platform:{OS:platform},Linking:{openURL},failNavigation,observeCaughtError,isMissingLinkHandler,encodeURIComponent,toast:{info:jest.fn()},he:{},
 });
 const run=async()=>{open();for(let i=0;i<20;i++)await Promise.resolve();};
 return{run,openURL,failNavigation,observeCaughtError};
}
test.each(['ios','android'])('%s navigation uses a supported native fallback for exact coordinates',async platform=>{
 const f=navigationFixture(platform,{fieldLat:31.847914911373266,fieldLng:34.83890917472567});await f.run();
 expect(f.openURL).toHaveBeenCalledTimes(3);
 expect(f.openURL.mock.calls[2][0]).toBe(platform==='ios'?'https://maps.apple.com/?daddr=31.847914911373266,34.83890917472567&dirflg=d':'geo:31.847914911373266,34.83890917472567?q=31.847914911373266,34.83890917472567');
 expect(f.failNavigation).not.toHaveBeenCalled();expect(f.observeCaughtError).not.toHaveBeenCalled();
});
test('legacy address navigation encodes the full destination in Apple Maps and never tries geo on iOS',async()=>{
 const f=navigationFixture('ios',{fieldAddress:'רחוב הכדור 5',city:'רחובות',fieldName:'מגרש'});await f.run();
 expect(f.openURL.mock.calls[2][0]).toBe('https://maps.apple.com/?daddr='+encodeURIComponent('רחוב הכדור 5, רחובות')+'&dirflg=d');
 expect(f.openURL.mock.calls.some(([url])=>url.startsWith('geo:'))).toBe(false);
});
test('a complete navigation failure retains the existing copy-destination fallback',async()=>{
 const f=navigationFixture('ios',{fieldLat:31,fieldLng:34});const failure=Error('Unable to open URL: apple');f.openURL.mockRejectedValue(failure);
 await f.run();expect(f.failNavigation).toHaveBeenCalledWith(failure,'31,34');expect(f.openURL).toHaveBeenCalledTimes(3);
});
test('an installed Waze handles navigation without extra attempts',async()=>{
 const f=navigationFixture('ios',{fieldLat:31,fieldLng:34});f.openURL.mockReset().mockResolvedValue(undefined);await f.run();
 expect(f.openURL).toHaveBeenCalledTimes(1);expect(f.failNavigation).not.toHaveBeenCalled();
});
test('the actual Apple autolinker registers the local WatchBridge Swift module and pod',()=>{
 const result=JSON.parse(execFileSync(process.execPath,['node_modules/expo-modules-autolinking/bin/expo-modules-autolinking.js','resolve','--platform','apple','--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 const bridge=result.modules.find((m:any)=>m.packageName==='watch-bridge');
 expect(bridge).toMatchObject({modules:['WatchBridgeModule'],swiftModuleNames:['WatchBridge']});
 expect(bridge.pods).toHaveLength(1);expect(bridge.pods[0].podName).toBe('WatchBridge');
 expect(fs.existsSync(path.join(bridge.pods[0].podspecDir,'WatchBridgeModule.swift'))).toBe(true);
});
