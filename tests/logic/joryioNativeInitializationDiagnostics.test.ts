import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

// Exercise the installed SDK, rather than a fake that already exposes the new
// diagnostic. Both Metro's source and Node's published entry must agree.
test.each(['src/index.ts', 'lib/index.js'])('%s preserves native init failure and clears it after recovery', async file => {
  const native = {
    initialize: jest.fn().mockRejectedValueOnce({code:'INIT_ERROR',message:'Native storage unavailable'}).mockResolvedValue(undefined),
    getDiagnostics: jest.fn().mockResolvedValue({apiEndpoint:'test-host'}),
  };
  const context:any = {
    exports: {}, console:{warn:jest.fn()}, setTimeout, clearTimeout,
    require: (name:string) => {
      if(name !== 'react-native') throw new Error(`Unexpected import ${name}`);
      return {NativeModules:{JoryioModule:native},Platform:{OS:'android'},NativeEventEmitter:class { addListener(){return {remove(){}};} }};
    },
  };
  const source=fs.readFileSync(`node_modules/@joryio/react-native-sdk/${file}`,'utf8');
  const js=file.endsWith('.ts') ? ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText : source;
  vm.runInNewContext(js,context);
  const sdk=context.exports.default;
  await sdk.initialize('jry_sdk_android_test','https://test.invalid');
  expect(await sdk.getDiagnostics()).toEqual({apiEndpoint:null,initializationError:{code:'INIT_ERROR',message:'Native storage unavailable'}});
  expect(native.getDiagnostics).not.toHaveBeenCalled();
  await sdk.initialize('jry_sdk_android_test','https://test.invalid');
  expect(await sdk.getDiagnostics()).toEqual({apiEndpoint:'test-host'});
});
