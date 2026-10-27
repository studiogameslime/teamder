import React from 'react';
jest.mock('react-native', () => ({ View:'View',Text:'Text',TextInput:'TextInput',Pressable:'Pressable',ScrollView:'ScrollView',ImageBackground:'ImageBackground',ActivityIndicator:'Spinner',Platform:{OS:'android'},StyleSheet:{create:(x:any)=>x,absoluteFill:{position:'absolute'}} }));
jest.mock('@expo/vector-icons', () => ({Ionicons:'Icon'}));
jest.mock('expo-linear-gradient', () => ({LinearGradient:'Gradient'}));
jest.mock('@/components/SafeModal', () => ({SafeModal:'Modal'}));
jest.mock('@/components/SafeKeyboardAvoidingView', () => ({SafeKeyboardAvoidingView:'Keyboard'}));
jest.mock('@/theme', () => ({colors:{surface:'#fff',primary:'#1e40af',text:'#111',textMuted:'#666',border:'#eee'},typography:{},RTL_LABEL_ALIGN:'left'}));
jest.mock('@/theme/overlays', () => ({overlayTheme:{backdrop:'#0007'}}));
jest.mock('@/services/feedbackPromptService', () => ({FEEDBACK_PROMPT_MAX_LENGTH:300}));
jest.mock('../../assets/feedback/prompt-football-banner.png', () => 'banner');
import {FeedbackPromptDialog, type FeedbackPromptDialogProps} from '@/components/feedback/FeedbackPromptDialog';
function nodes(n:any):any[]{return !React.isValidElement<any>(n)?[]:[n,...React.Children.toArray(n.props.children).flatMap(nodes)];}
const props = (extra:Partial<FeedbackPromptDialogProps>={}) => ({message:'',busy:false,error:'',success:false,onChange:jest.fn(),onSubmit:jest.fn(),onClose:jest.fn(),...extra});
test('the only actions are send and close, empty send is disabled',()=>{
  const tree=nodes(FeedbackPromptDialog(props()));
  expect(tree.filter(n=>n.type==='Pressable').map(n=>n.props.accessibilityLabel)).toEqual(['שליחה','סגירה']);
  expect(tree.find(n=>n.props.accessibilityLabel==='שליחה').props.disabled).toBe(true);
  expect(tree.find(n=>n.type==='TextInput').props.maxLength).toBe(300);
});
test('submission blocks repeated sends but never traps the user during an offline pending write',()=>{
  const p=props({busy:true,message:'רעיון'}),tree=nodes(FeedbackPromptDialog(p));
  expect(tree.find(n=>n.props.accessibilityLabel==='שליחה').props.disabled).toBe(true);
  expect(tree.find(n=>n.props.accessibilityLabel==='סגירה').props.disabled).not.toBe(true);
  tree[0].props.onRequestClose();expect(p.onClose).toHaveBeenCalledTimes(1);
});
test('failure retains the editable text and a readable inline retry message',()=>{
  const tree=nodes(FeedbackPromptDialog(props({message:'הטיוטה שלי',error:'אפשר לנסות שוב'})));
  expect(tree.find(n=>n.type==='TextInput').props.value).toBe('הטיוטה שלי');
  expect(tree.find(n=>n.props.accessibilityRole==='alert').props.children).toBe('אפשר לנסות שוב');
  expect(tree.find(n=>n.props.accessibilityLabel==='שליחה').props.disabled).toBe(false);
});
test('only a confirmed successful write shows thanks and the return action',()=>{
  const p=props({success:true}),tree=nodes(FeedbackPromptDialog(p));
  expect(tree.some(n=>n.type==='TextInput')).toBe(false);
  tree.find(n=>n.props.accessibilityLabel==='בחזרה לאפליקציה').props.onPress();expect(p.onClose).toHaveBeenCalledTimes(1);
});
