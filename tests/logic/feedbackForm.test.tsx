import React from 'react';
let mockStates: any[] = [], mockRefs: any[] = [], mockIndex = 0, mockRefIndex = 0;
let mockRoute: any = { key: 'feedback', name: 'Feedback', params: { type: 'bug' } };
const mockNav = { goBack: jest.fn(), isFocused: () => true };
jest.mock('react', () => ({ ...jest.requireActual('react'), useEffect: jest.fn(),
  useState: (initial: any) => { const i=mockIndex++; if (!(i in mockStates)) mockStates[i]=typeof initial==='function'?initial():initial; return [mockStates[i], (next: any) => { mockStates[i]=typeof next==='function'?next(mockStates[i]):next; }]; },
  useRef: (initial: any) => { const i=mockRefIndex++; if (!(i in mockRefs)) mockRefs[i]={current:initial}; return mockRefs[i]; },
}));
jest.mock('react-native', () => ({ View:'View',Text:'Text',Pressable:'Pressable',TextInput:'TextInput',Image:'Image',ScrollView:'ScrollView',ActivityIndicator:'Loader',Platform:{OS:'android'},Keyboard:{dismiss:jest.fn()},StyleSheet:{create:(x:any)=>x} }));
jest.mock('react-native-safe-area-context', () => ({SafeAreaView:'SafeAreaView'}));
jest.mock('@react-navigation/native', () => ({useRoute:()=>mockRoute,useNavigation:()=>mockNav}));
jest.mock('@expo/vector-icons', () => ({Ionicons:'Icon'}));
jest.mock('react-native-svg', () => ({__esModule:true,default:'Svg',Circle:'Circle',Line:'Line',Rect:'Rect'}));
jest.mock('@/components/SafeKeyboardAvoidingView', () => ({SafeKeyboardAvoidingView:'KeyboardView'}));
jest.mock('@/components/ScreenshotAnnotator', () => ({ScreenshotAnnotator:'Annotator'}));
jest.mock('@/components/summary/SeasonSummaryIcon', () => ({SeasonSummaryIcon:'Icon'}));
jest.mock('@/components/Toast', () => ({toast:{success:jest.fn(),error:jest.fn()}}));
jest.mock('@/services/feedbackService', () => ({captureFeedbackDiagnostics:jest.fn(()=>({screen:'MatchDetails',owner:'owner',journal:'frozen',trail:'before form'})),submitFeedback:jest.fn()}));
jest.mock('@/services/feedbackImage', () => ({FEEDBACK_IMAGE_LIMIT:700000,pickFeedbackImage:jest.fn(),prepareFeedbackImage:jest.fn()}));
jest.mock('@/services/analyticsService', () => ({logEvent:jest.fn(),AnalyticsEvent:{FeedbackSubmitted:'submitted'}}));
jest.mock('@/theme', () => ({colors:{text:'#123',textMuted:'#678',surface:'#fff'},RTL_LABEL_ALIGN:'left'}));
jest.mock('../../assets/feedback/bubble-football.png', () => 'hero');
import { FeedbackScreen } from '@/screens/FeedbackScreen';
import { submitFeedback } from '@/services/feedbackService';
import { pickFeedbackImage } from '@/services/feedbackImage';
function nodes(n:any):any[] { return !n||typeof n!=='object'?[]:[n,...React.Children.toArray(n.props?.children).flatMap(nodes)]; }
function text(n:any):string { return typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):n?.props?text(n.props.children):''; }
function render(){mockIndex=0;mockRefIndex=0;const root:any=FeedbackScreen();return nodes(root.type(root.props));}
function input(tree:any[]){return tree.find(n=>n.type==='TextInput').props;}
function send(tree:any[]){return tree.find(n=>n.type==='Pressable'&&n.props.accessibilityLabel?.startsWith('שלח ')).props;}
function tab(tree:any[],label:string){return tree.find(n=>n.props.accessibilityRole==='tab'&&text(n)===label).props;}
beforeEach(()=>{mockStates=[];mockRefs=[];mockRoute={key:'feedback',name:'Feedback',params:{type:'bug'}};jest.clearAllMocks();(submitFeedback as jest.Mock).mockResolvedValue(undefined);});
test('both dedicated entries retain visible tabs and select the requested type',()=>{
  expect(tab(render(),'דיווח על תקלה').accessibilityState.selected).toBe(true);
  mockStates=[];mockRefs=[];mockRoute.params.type='suggestion';
  const tree=render();expect(tab(tree,'הצעה לשיפור').accessibilityState.selected).toBe(true);
  expect(send(tree).disabled).toBe(true);
});
test('switching tabs preserves text and attachment and submits correct classification with frozen source',async()=>{
  let tree=render();input(tree).onChangeText('רעיון לבדיקה');
  (pickFeedbackImage as jest.Mock).mockResolvedValueOnce('jpeg-data');
  await tree.find(n=>n.type==='Pressable'&&text(n)==='צרף צילום מסך').props.onPress();
  tree=render();tab(tree,'הצעה לשיפור').onPress();tree=render();
  expect(input(tree).value).toBe('רעיון לבדיקה');
  expect(tree.find(n=>n.type==='Annotator').props.image).toBe('jpeg-data');
  await send(tree).onPress();
  expect(submitFeedback).toHaveBeenCalledWith('suggestion','רעיון לבדיקה','MatchDetails','jpeg-data','feature',expect.objectContaining({journal:'frozen',owner:'owner'}));
});
test('rapid repeated submission sends once and failure keeps the draft',async()=>{
  let reject!: (error: Error)=>void;
  (submitFeedback as jest.Mock).mockImplementationOnce(()=>new Promise((_,fail)=>{reject=fail;}));
  input(render()).onChangeText('תקלה שלא נשלחה');const submit=send(render()).onPress;
  const pending=submit();await submit();expect(submitFeedback).toHaveBeenCalledTimes(1);
  reject(new Error('offline'));await pending;
  const tree=render();expect(input(tree).value).toBe('תקלה שלא נשלחה');expect(send(tree).disabled).toBe(false);
});
test('reporting a player remains a bug and reserves space for the existing report context',()=>{
  mockRoute.params={type:'bug',playerId:'player-1',playerName:'שחקן'};
  const tree=render();expect(tab(tree,'הצעה לשיפור').disabled).toBe(true);
  expect(input(tree).maxLength).toBeLessThan(2000);
});
