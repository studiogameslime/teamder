import fs from 'fs';
import path from 'path';

// Execute the installed RN responder predicate itself: a lost native end must
// not consume child presses indefinitely. No renderer or timing benchmark.
const source=fs.readFileSync(path.resolve(__dirname,'../node_modules/react-native/Libraries/Components/ScrollView/ScrollView.js'),'utf8');
const body=source.match(/_isAnimating: \(\) => boolean = \(\) => \{([\s\S]*?)\n  \};/)![1];
const predicate=new Function('global','IS_ANIMATING_TOUCH_START_THRESHOLD_MS',body);
function check(now:number,overrides:Record<string,unknown>={}) {
 const recovered=jest.fn();
 const state={props:{recoverStaleMomentumAfterMs:250,onStaleMomentumRecovered:recovered},_lastMomentumScrollBeginTime:1000,_lastMomentumScrollEndTime:0,_lastScrollEventTime:1100,...overrides};
 return {animating:predicate.call(state,{performance:{now:()=>now}},16),recovered,state};
}
it('releases child presses when the native momentum-end event is lost',()=>{
 const result=check(2000);expect(result.animating).toBe(false);expect(result.recovered).toHaveBeenCalledTimes(1);
 // A second tap must not trigger recovery again.
 expect(predicate.call(result.state,{performance:{now:()=>2010}},16)).toBe(false);
 expect(result.recovered).toHaveBeenCalledTimes(1);
});
it('still captures presses during a long fling with recent frames',()=>{
 expect(check(12000,{_lastScrollEventTime:11990}).animating).toBe(true);
});
it('allows the beginning of a fling before its first scroll frame',()=>{
 expect(check(1020,{_lastScrollEventTime:500}).animating).toBe(true);
});
it('preserves the native grace period after an ordinary end',()=>{
 expect(check(1505,{_lastMomentumScrollEndTime:1500}).animating).toBe(true);
 expect(check(1600,{_lastMomentumScrollEndTime:1500}).animating).toBe(false);
});
it('leaves non-opted-in scroll views unchanged',()=>{
 expect(check(2000,{props:{}}).animating).toBe(true);
});

it('keeps the recovery boundary strict and uses the latest scroll frame',()=>{
 expect(check(1350).animating).toBe(true);
 expect(check(1351).animating).toBe(false);
 expect(check(2000,{_lastScrollEventTime:1800}).animating).toBe(true);
});
it.each([0,-1])('does not enable recovery for an invalid opt-in %s',value=>{
 expect(check(2000,{props:{recoverStaleMomentumAfterMs:value}}).animating).toBe(true);
});
it('does not recover an ordinary settled scroll or a new fling with a fresh begin',()=>{
 const settled=check(2000,{_lastMomentumScrollEndTime:1500});
 expect(settled.animating).toBe(false);expect(settled.recovered).not.toHaveBeenCalled();
 const fresh=check(2000,{_lastMomentumScrollBeginTime:1900});
 expect(fresh.animating).toBe(true);expect(fresh.recovered).not.toHaveBeenCalled();
});
it('lets the first child press through the actual installed capture handler after recovery',()=>{
 const captureBody=source.match(/_handleStartShouldSetResponderCapture: [\s\S]*?\(e: GestureResponderEvent\) => \{([\s\S]*?)\n    \};/)![1];
 const capture=new Function('e','TextInputState','__DEV__',captureBody);
 const result=check(1200);
 let now=2000;
 const state={...result.state,
  _isAnimating(){return predicate.call(this,{performance:{now:()=>now}},16);},
  _softKeyboardIsDetached:()=>false,_keyboardIsDismissible:()=>false,
 };
 // The same responder that captures a real fling must release its first child
 // touch, without a second scroll or synthetic invocation of the child's press.
 now=1200;
 expect(capture.call(state,{target:{}},{isTextInput:()=>false},false)).toBe(true);
 now=2000;
 expect(capture.call(state,{target:{}},{isTextInput:()=>false},false)).toBe(false);
 expect(result.recovered).toHaveBeenCalledTimes(1);
});
it('retains native keyboard dismissal behavior after a stale momentum recovery',()=>{
 const captureBody=source.match(/_handleStartShouldSetResponderCapture: [\s\S]*?\(e: GestureResponderEvent\) => \{([\s\S]*?)\n    \};/)![1];
 const capture=new Function('e','TextInputState','__DEV__',captureBody);
 const result=check(1200);
 const state={...result.state,
  props:{...result.state.props,keyboardShouldPersistTaps:'never'},
  _isAnimating(){return predicate.call(this,{performance:{now:()=>2000}},16);},
  _softKeyboardIsDetached:()=>false,_keyboardIsDismissible:()=>true,
 };
 expect(capture.call(state,{target:{}},{isTextInput:()=>false},false)).toBe(true);
 state.props.keyboardShouldPersistTaps='handled';
 expect(capture.call(state,{target:{}},{isTextInput:()=>false},false)).toBe(false);
});
