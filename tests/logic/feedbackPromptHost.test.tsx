import React from 'react';
let mockStates:any[]=[],mockRefs:any[]=[],mockEffects:any[]=[],mockNext:any[]=[],mockI=0,mockR=0,mockE=0;
let mockUser:any={id:'owner'},mockMaintenance=false;
jest.mock('react',()=>({...jest.requireActual('react'),
  useState:(initial:any)=>{const i=mockI++;if(!(i in mockStates))mockStates[i]=initial;return [mockStates[i],(v:any)=>{mockStates[i]=typeof v==='function'?v(mockStates[i]):v;}];},
  useRef:(value:any)=>mockRefs[mockR++]??(mockRefs[mockR-1]={current:value}),
  useEffect:(fn:any,deps:any[])=>{const i=mockE++,old=mockEffects[i];if(!old||deps.some((d,j)=>d!==old.deps[j]))mockNext.push(()=>{old?.cleanup?.();mockEffects[i]={deps,cleanup:fn()};});},
}));
jest.mock('@/components/feedback/FeedbackPromptDialog',()=>({FeedbackPromptDialog:'Dialog'}));
jest.mock('@/store/userStore',()=>({useUserStore:Object.assign((fn:any)=>fn({currentUser:mockUser}),{getState:()=>({currentUser:mockUser})})}));
jest.mock('@/services/remoteConfigService',()=>({useRemoteConfig(){},rcBool:()=>mockMaintenance}));
jest.mock('@/services/feedbackPromptService',()=>({shouldShowFeedbackPrompt:jest.fn(),markFeedbackPromptHandled:jest.fn(),feedbackPromptContext:jest.fn(()=>({owner:'owner'})),submitFeedbackPrompt:jest.fn()}));
import {FeedbackPromptHost} from '@/components/feedback/FeedbackPromptHost';
import {shouldShowFeedbackPrompt,markFeedbackPromptHandled,submitFeedbackPrompt} from '@/services/feedbackPromptService';
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
let report:jest.Mock;
function render(active=true):any {
  mockI=mockR=mockE=0;mockNext=[];
  const root:any=FeedbackPromptHost({active,onVisibilityChange:report});
  const result=root?root.type(root.props):null;mockNext.forEach(fn=>fn());return result;
}
beforeEach(()=>{jest.useFakeTimers();jest.clearAllMocks();mockStates=[];mockRefs=[];mockEffects=[];mockUser={id:'owner'};mockMaintenance=false;report=jest.fn();(shouldShowFeedbackPrompt as jest.Mock).mockResolvedValue(true);(markFeedbackPromptHandled as jest.Mock).mockResolvedValue(undefined);(submitFeedbackPrompt as jest.Mock).mockResolvedValue(undefined);});
afterEach(()=>jest.useRealTimers());
test('guests, maintenance and inactive readiness do not start eligibility reads',async()=>{
  mockUser.isGuest=true;expect(render()).toBeNull();mockUser.isGuest=false;mockMaintenance=true;render();jest.runOnlyPendingTimers();await flush();expect(shouldShowFeedbackPrompt).not.toHaveBeenCalled();
});
test('deactivation while eligibility is in flight cannot open or consume the prompt',async()=>{
  let done!:(v:boolean)=>void;(shouldShowFeedbackPrompt as jest.Mock).mockReturnValue(new Promise(r=>{done=r;}));
  render();jest.advanceTimersByTime(2500);render(false);done(true);await flush();
  expect(render(false)).toBeNull();expect(markFeedbackPromptHandled).not.toHaveBeenCalled();
});
test('confirmed open reports visibility, dismiss marks only the captured account',async()=>{
  render();jest.advanceTimersByTime(2500);await flush();const dialog=render();expect(dialog).not.toBeNull();expect(report).toHaveBeenLastCalledWith(true);
  dialog.props.onClose();expect(render()).toBeNull();expect(markFeedbackPromptHandled).toHaveBeenCalledWith('owner');
});
test('rapid submit is sent once and failure retains draft for retry',async()=>{
  render();jest.advanceTimersByTime(2500);await flush();render().props.onChange('הצעה');
  let fail!:(e:Error)=>void;(submitFeedbackPrompt as jest.Mock).mockReturnValueOnce(new Promise((_,r)=>{fail=r;}));
  const dialog=render();dialog.props.onSubmit();dialog.props.onSubmit();
  expect(submitFeedbackPrompt).toHaveBeenCalledTimes(1);expect(render().props.busy).toBe(true);
  fail(new Error('offline'));await flush();const retry=render();expect(retry.props.message).toBe('הצעה');expect(retry.props.error).toContain('לא נשלחה');expect(retry.props.busy).toBe(false);expect(markFeedbackPromptHandled).not.toHaveBeenCalled();
  retry.props.onSubmit();await flush();expect(render().props.success).toBe(true);expect(markFeedbackPromptHandled).toHaveBeenCalledWith('owner');
});
test('late success after unmount records the old owner without publishing into another session',async()=>{
  render();jest.advanceTimersByTime(2500);await flush();render().props.onChange('הצעה');let done!:()=>void;(submitFeedbackPrompt as jest.Mock).mockReturnValueOnce(new Promise<void>(r=>{done=r;}));render().props.onSubmit();
  mockEffects.forEach(e=>e.cleanup?.());mockUser={id:'other'};done();await flush();expect(markFeedbackPromptHandled).toHaveBeenCalledWith('owner');expect(mockStates[3]).toBe(false);
});
test('closing an indefinitely pending write releases the app and does not schedule another prompt',async()=>{
  render();jest.advanceTimersByTime(2500);await flush();render().props.onChange('הצעה');
  (submitFeedbackPrompt as jest.Mock).mockReturnValueOnce(new Promise(()=>{}));
  const dialog=render();dialog.props.onSubmit();dialog.props.onClose();expect(render()).toBeNull();expect(report).toHaveBeenLastCalledWith(false);
  expect(markFeedbackPromptHandled).toHaveBeenCalledWith('owner');jest.advanceTimersByTime(10000);expect(render()).toBeNull();expect(submitFeedbackPrompt).toHaveBeenCalledTimes(1);
});
