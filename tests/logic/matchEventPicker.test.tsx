import React from 'react';
jest.mock('react',()=>({...jest.requireActual('react'),useRef:(value:any)=>({current:value}),useEffect:(effect:()=>void)=>effect()}));
jest.mock('react-native',()=>({Platform:{OS:'android'},Pressable:'Button',ScrollView:'Scroll',Text:'Text',View:'View',StyleSheet:{create:(s:any)=>s,absoluteFill:{}},useWindowDimensions:()=>({width:320,height:640,fontScale:1.4})}));
jest.mock('@expo/vector-icons',()=>({Ionicons:'Icon'}));
jest.mock('react-native-svg',()=>({__esModule:true,default:'Svg',Circle:'Circle',Path:'Path'}));
jest.mock('@/utils/haptics',()=>({lightHaptic:jest.fn()}));
jest.mock('@/components/SafeModal',()=>({SafeModal:'Modal'}));
jest.mock('@/components/match/TeamShirt',()=>({TeamShirtIllustration:'Shirt'}));
jest.mock('@/theme',()=>({RTL_LABEL_ALIGN:'left'}));
jest.mock('@/theme/overlays',()=>({overlaySurfaces:{sheet:{}}}));
import {Platform} from 'react-native';
import {MatchEventPicker} from '@/components/match/MatchEventPicker';

const find=(n:any,type:string):any[]=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(v=>find(v,type)):[...(n.type===type?[n]:[]),...find(n.props?.children,type)];
const setup=()=>{
  const onClose=jest.fn(),onSelect=jest.fn();
  const tree=MatchEventPicker({visible:true,teams:[{name:'הירוקים',color:'#16A34A'},{name:'הלבנים',color:'#FFFFFF'}],onClose,onSelect});
  const press=(label:string)=>find(tree,'Button').find(n=>n.props.accessibilityLabel===label).props.onPress();
  return {tree,onClose,onSelect,press};
};
beforeEach(()=>{Platform.OS='android';});
test.each([['גול לירוקים','A'],['גול ללבנים','B'],['פנדל','penalty']])('opens the current %s entry flow without saving an event', (label,choice)=>{
  const s=setup();expect(s.onSelect).not.toHaveBeenCalled();
  s.press(label);expect(s.onClose).toHaveBeenCalledTimes(1);expect(s.onSelect).toHaveBeenCalledTimes(1);expect(s.onSelect).toHaveBeenCalledWith(choice);
  s.tree.props.onDismiss();expect(s.onSelect).toHaveBeenCalledTimes(1);
});
test.each(['סגירה','סגירת בחירת אירוע'])('dismiss via %s does not select or create anything',label=>{
  const s=setup();s.press(label);s.tree.props.onDismiss();expect(s.onClose).toHaveBeenCalled();expect(s.onSelect).not.toHaveBeenCalled();
});
test('back dismisses without opening an entry flow',()=>{
  const s=setup();s.tree.props.onRequestClose();s.tree.props.onDismiss();expect(s.onClose).toHaveBeenCalledTimes(1);expect(s.onSelect).not.toHaveBeenCalled();
});
test('Android ignores a second tap while the picker closes',()=>{
  const s=setup();s.press('גול לירוקים');s.press('פנדל');
  expect(s.onClose).toHaveBeenCalledTimes(1);expect(s.onSelect).toHaveBeenCalledTimes(1);expect(s.onSelect).toHaveBeenCalledWith('A');
});
test('iOS dismisses selector before opening the entry modal and ignores repeated selection',()=>{
  Platform.OS='ios';const s=setup();s.press('גול ללבנים');s.press('פנדל');
  expect(s.onSelect).not.toHaveBeenCalled();expect(s.onClose).toHaveBeenCalledTimes(1);
  s.tree.props.onDismiss();expect(s.onSelect).toHaveBeenCalledWith('B');expect(s.onSelect).toHaveBeenCalledTimes(1);
});
