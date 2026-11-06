jest.mock('firebase/storage',()=>({ref:jest.fn(()=>({})),uploadBytes:jest.fn(),getDownloadURL:jest.fn(),deleteObject:jest.fn()}));
jest.mock('@/firebase/config',()=>({getFirebase:()=>({storage:{},functions:{}}),USE_MOCK_DATA:false}));
jest.mock('@/services/errorLog',()=>({logError:jest.fn()}));
jest.mock('@/services/diagnosticCallable',()=>({httpsCallable:jest.fn()}));
jest.mock('expo-image-picker',()=>({requestMediaLibraryPermissionsAsync:jest.fn(),launchImageLibraryAsync:jest.fn(),MediaTypeOptions:{Images:'images'}}));
jest.mock('expo-image-manipulator',()=>({manipulateAsync:jest.fn(),SaveFormat:{JPEG:'jpeg'}}));
import * as Picker from 'expo-image-picker';
import * as Manipulator from 'expo-image-manipulator';
import {uploadBytes,getDownloadURL} from 'firebase/storage';
import {httpsCallable} from '@/services/diagnosticCallable';
import {pickAndUploadAvatar,pickAndUploadGroupCover} from '@/services/photoService';
const originalFetch=global.fetch;
beforeEach(()=>{
  jest.clearAllMocks();(global as any).__DEV__=false;
  jest.mocked(Picker.requestMediaLibraryPermissionsAsync).mockResolvedValue({status:'granted'} as any);
  jest.mocked(Picker.launchImageLibraryAsync).mockResolvedValue({canceled:false,assets:[{uri:'file://local'}]} as any);
  jest.mocked(Manipulator.manipulateAsync).mockResolvedValue({uri:'file://prepared',base64:'image'} as any);
  global.fetch=jest.fn(async()=>({blob:async()=>({})})) as any;
  jest.mocked(uploadBytes).mockResolvedValue({} as any);jest.mocked(getDownloadURL).mockResolvedValue('https://example.test/image');
  jest.mocked(httpsCallable).mockReturnValue(jest.fn(async()=>({data:{url:'https://example.test/cover'}})) as any);
});
afterAll(()=>{global.fetch=originalFetch;});
test('avatar stages follow actual operations and remain uploading until Storage confirms completion',async()=>{
  const phases:string[]=[];let finish!:(v:any)=>void;jest.mocked(uploadBytes).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=pickAndUploadAvatar('owner',phase=>phases.push(phase));for(let i=0;i<15;i++)await Promise.resolve();
  expect(phases).toEqual(['permission','picking','preparing','uploading']);expect(getDownloadURL).not.toHaveBeenCalled();
  finish({});await expect(pending).resolves.toEqual({ok:true,url:'https://example.test/image'});expect(phases).toEqual(['permission','picking','preparing','uploading','resolving']);
});
test.each(['permission','cancelled','prepare','upload','url'])('an interrupted %s never reports a later successful stage',async failure=>{
  const phases:string[]=[];
  if(failure==='permission')jest.mocked(Picker.requestMediaLibraryPermissionsAsync).mockResolvedValueOnce({status:'denied'} as any);
  if(failure==='cancelled')jest.mocked(Picker.launchImageLibraryAsync).mockResolvedValueOnce({canceled:true} as any);
  if(failure==='prepare')jest.mocked(Manipulator.manipulateAsync).mockRejectedValueOnce(Error('prepare'));
  if(failure==='upload')jest.mocked(uploadBytes).mockRejectedValueOnce(Error('offline'));
  if(failure==='url')jest.mocked(getDownloadURL).mockRejectedValueOnce(Error('offline'));
  const result=await pickAndUploadAvatar('owner',p=>phases.push(p));expect(result.ok).toBe(false);
  if(failure==='permission')expect(phases).toEqual(['permission']);
  if(failure==='cancelled')expect(phases).toEqual(['permission','picking']);
  if(failure==='prepare')expect(phases).toEqual(['permission','picking','preparing']);
  if(failure==='upload')expect(phases).toEqual(['permission','picking','preparing','uploading']);
  expect(phases).not.toContain('saved');
});
test('club covers expose upload while the callable works, without inventing a separate URL request or percentage',async()=>{
  const phases:string[]=[];expect(await pickAndUploadGroupCover('club',p=>phases.push(p))).toEqual({ok:true,url:'https://example.test/cover'});
  expect(phases).toEqual(['permission','picking','preparing','uploading']);expect(uploadBytes).not.toHaveBeenCalled();
});
