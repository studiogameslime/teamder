jest.mock('expo-constants',()=>({__esModule:true,default:{expoConfig:{version:'test'}}}));
jest.mock('expo-crypto',()=>({randomUUID:()=> '12345678-1234-1234-1234-123456789abc'}));
jest.mock('react-native',()=>({Platform:{OS:'android'}}));
const mockSend = jest.fn().mockResolvedValue({});
jest.mock('firebase/functions',()=>({httpsCallable:()=>mockSend}));
jest.mock('@/firebase/config',()=>({USE_MOCK_DATA:false,getFirebase:()=>({auth:{currentUser:{uid:'alice'}},functions:{}})}));
jest.mock('@/navigation/navigationRef',()=>({navigationRef:{isReady:()=>true,getCurrentRoute:()=>({name:'CommunitiesCreate',params:{groupId:'g1',password:'secret',email:'private'}})}}));
jest.mock('@/services/chatService',()=>({dmConvId:(a:string,b:string)=>[a,b].sort().join('__')}));
import { captureSupportContext, setSupportStep, useSupportChat, sendSupportDraft } from '@/services/supportChat';
beforeEach(()=>{useSupportChat.getState().resetOwner(null);setSupportStep('CommunitiesCreate');});
test('text-only support omits the image field before callable encoding',async()=>{
  await sendSupportDraft('alice',{text:'היי',image:undefined,attemptId:'support-wire-123456789',context:captureSupportContext()});
  expect(mockSend.mock.calls.at(-1)?.[0]).not.toHaveProperty('image');
  await sendSupportDraft('alice',{text:'צילום',image:'/9j/AAAA',attemptId:'support-photo-123456789',context:captureSupportContext()});
  expect(mockSend.mock.calls.at(-1)?.[0]).toHaveProperty('image','/9j/AAAA');
});
test('closing/reopening preserves source, photo and retry identity; logout clears all drafts',()=>{
  const state=useSupportChat.getState();state.open('alice');
  state.patch('alice',{text:'עזרה',image:'/9j/AAAA',attemptId:'support-retry-123456789'});
  state.close();setSupportStep('CommunitiesCreate',2);state.open('alice');
  expect(useSupportChat.getState().drafts.alice).toMatchObject({text:'עזרה',image:'/9j/AAAA',attemptId:'support-retry-123456789'});
  expect(useSupportChat.getState().drafts.alice.context.step).toBeUndefined();
  state.resetOwner(null);expect(useSupportChat.getState().drafts).toEqual({});
});
test('changing identity cannot expose another account draft; empty new requests capture current step',()=>{
  const state=useSupportChat.getState();state.open('alice');state.patch('alice',{text:'private'});state.open('bob');
  expect(useSupportChat.getState().drafts.alice).toBeUndefined();expect(useSupportChat.getState().drafts.bob.text).toBe('');
  setSupportStep('CommunitiesCreate',2);state.close();state.open('bob');expect(useSupportChat.getState().drafts.bob.context.step).toBe(2);
});
test('source upload only includes explicit route metadata and only the active form step',()=>{
  setSupportStep('GameCreate',3);expect(captureSupportContext()).toEqual({screen:'CommunitiesCreate',screenLabel:'הקמת מועדון',groupId:'g1',appVersion:'test',platform:expect.any(String)});
});

test('late cleanup from an inactive form cannot erase the current form step',()=>{
  setSupportStep('CommunitiesCreate',2);setSupportStep('GameCreate');expect(captureSupportContext().step).toBe(2);
  setSupportStep('CommunitiesCreate');expect(captureSupportContext().step).toBeUndefined();
});
