import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import React from 'react';

test('editable fields override paragraph alignment without replacing native editing behavior or refs', () => {
  const source = ts.transpileModule(fs.readFileSync('pulse/src/components/RtlTextInput.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} as any };
  vm.runInNewContext(source, { module, exports: module.exports, require: (name: string) => {
    if (name === 'react') return React;
    if (name === 'react-native') return { TextInput: 'NativeTextInput' };
    if (name === '../theme') return { RTL_INPUT_ALIGN: 'right' };
    throw Error(name);
  } });
  const ref = { current: null }, onChangeText = jest.fn();
  const originalStyle = { textAlign: 'left', color: '#fff' };
  const element = module.exports.RtlTextInput.render({ style: originalStyle, onChangeText, secureTextEntry: true, keyboardType: 'email-address' }, ref);
  expect(element.type).toBe('NativeTextInput');
  expect(element.props.style).toEqual([originalStyle, { textAlign: 'right' }]);
  expect(element.props.ref).toBe(ref);
  expect(element.props.onChangeText).toBe(onChangeText);
  expect(element.props.secureTextEntry).toBe(true);
  expect(element.props.keyboardType).toBe('email-address');
  expect(originalStyle).toEqual({ textAlign: 'left', color: '#fff' });
});
