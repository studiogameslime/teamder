import React from 'react';
const mockAlert = jest.fn();
const mockTrigger = jest.fn().mockResolvedValue('triggered');
jest.mock('react-native', () => ({ View:'View', Text:'Text', StyleSheet:{ create:(s:unknown)=>s } }));
jest.mock('@/components/Button', () => ({ Button:'Button' }));
jest.mock('@/components/AppDialog', () => ({ appAlert:(...args:unknown[])=>mockAlert(...args) }));
jest.mock('@/services/crashlyticsTestService', () => ({ triggerCrashlyticsTest:(...args:unknown[])=>mockTrigger(...args) }));
jest.mock('@/theme', () => ({ colors:{}, radius:{}, spacing:{}, typography:{}, RTL_LABEL_ALIGN:'left' }));
import { CrashTestCard } from '@/components/home/CrashTestCard';
function pressCard() {
  const tree=CrashTestCard({userId:'tester'});
  const button=React.Children.toArray(tree.props.children).find((node:any)=>node.type==='Button') as React.ReactElement<any>;
  button.props.onPress();
  return mockAlert.mock.calls[0][2];
}
beforeEach(()=>{mockAlert.mockClear();mockTrigger.mockClear();});
test('the first tap only asks for confirmation; cancel never triggers a crash',()=>{
  const buttons=pressCard();
  expect(mockTrigger).not.toHaveBeenCalled();
  const cancel=buttons.find((b:any)=>b.style==='cancel');
  cancel.onPress?.();
  expect(mockTrigger).not.toHaveBeenCalled();
});
test('the destructive confirmation uses the account displayed by the home screen',async()=>{
  const buttons=pressCard();
  buttons.find((b:any)=>b.style==='destructive').onPress();
  await Promise.resolve();
  expect(mockTrigger).toHaveBeenCalledWith('tester');
});
