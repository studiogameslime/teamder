import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
const source=fs.readFileSync('src/components/stats/PersonalScoreChart.tsx','utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const moduleValue={exports:{} as any};
vm.runInNewContext(js,{module:moduleValue,exports:moduleValue.exports,require:(name:string)=>name==='react-native'?{StyleSheet:{create:(value:any)=>value}}:{}});
const layout=moduleValue.exports.personalScoreChartLayout;
test('normal five-score chart keeps its compact height and enough label space',()=>{
 const value=layout(330,1,5);
 expect(value.height).toBe(128);expect(value.textFallback).toBe(false);
 expect((value.right-value.left)/4).toBeGreaterThanOrEqual(48);
});
test('moderate font enlargement grows the canvas and label margins, never stretches the viewport',()=>{
 const normal=layout(420,1,5),large=layout(420,1.3,5);
 expect(large.scale).toBe(1.3);expect(large.height).toBeGreaterThan(normal.height);
 expect(large.left).toBeGreaterThan(normal.left);expect(large.dateY).toBeGreaterThan(large.baseline);
 expect(large.textFallback).toBe(false);
 expect(source).toContain('height={layout.height} viewBox={`0 0 ${width} ${layout.height}`}');
 expect(source).toContain('fontSize={12*layout.scale}');
});
test('large fonts or insufficient horizontal space use native wrapping text rather than squeezed labels',()=>{
 expect(layout(330,2,5).textFallback).toBe(true);
 expect(layout(180,1.3,5).textFallback).toBe(true);
 expect(layout(330,1.3,1).textFallback).toBe(false);
 expect(source).toContain('<Text style={s.listScore}>');
});
