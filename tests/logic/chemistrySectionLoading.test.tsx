import React from 'react';
let mockStates: any[] = [], mockIndex = 0;
let mockEffects: Array<() => (() => void)> = [];
jest.mock('react', () => ({ ...jest.requireActual('react'), useCallback: (fn: unknown) => fn,
  useState: (initial: unknown) => { const index=mockIndex++; if (!(index in mockStates)) mockStates[index]=initial; return [mockStates[index], (next: any) => { mockStates[index]=typeof next==='function' ? next(mockStates[index]) : next; }]; },
  useEffect: (effect: () => (() => void)) => mockEffects.push(effect),
}));
jest.mock('react-native', () => ({ Text:'Text',View:'View',Pressable:'Pressable',StyleSheet:{create:(x:unknown)=>x} }));
jest.mock('@expo/vector-icons', () => ({ Ionicons:'Icon' }));
jest.mock('@/components/UserAvatar', () => ({ UserAvatar:'Avatar' }));
jest.mock('@/components/chemistry/PairChemistryIcon', () => ({ PairChemistryIcon:'PairIcon' }));
jest.mock('@/components/chemistry/PairCard', () => ({ PairCard:'PairCard',CHEMISTRY_EMOJI:{},CHEMISTRY_LABEL:{} }));
jest.mock('@/services/clubChemistryService', () => ({ clubChemistryService:{get:jest.fn()} }));
jest.mock('@/services/groupService', () => ({ groupService:{hydrateUsers:jest.fn().mockResolvedValue([])} }));
jest.mock('@/services/analyticsService', () => ({ logEvent:jest.fn(),AnalyticsEvent:{ScreenView:'view'} }));
jest.mock('@/theme', () => ({ colors:{textMuted:'#666',primary:'#26F'},clubAccent:{blue:'#26F'},clubCardTint:(x:string)=>x,clubShadow:{},spacing:{xs:4,sm:8,md:16},typography:{body:{},label:{}},RTL_LABEL_ALIGN:'left' }));
import { ChemistrySection, ChemistryLoadNotice } from '@/components/chemistry/ChemistrySection';
import { clubChemistryService } from '@/services/clubChemistryService';
const get=clubChemistryService.get as jest.Mock;
const empty={pairs:{},picks:[],since:null};
function render(groupId='one',pairs?:any) { mockIndex=0; return ChemistrySection({groupId,pairs}); }
const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
beforeEach(()=>{mockStates=[];mockEffects=[];mockIndex=0;get.mockReset();});
test('live failure is a retryable error, never the genuine empty copy',async()=>{
  get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(empty);
  render();const cleanup=mockEffects.pop()!();await flush();
  const error=render();expect(error.type).toBe(ChemistryLoadNotice);expect(error.props.failed).toBe(true);
  expect(get).toHaveBeenCalledWith('one',true);
  error.props.onRetry();cleanup();render();mockEffects.pop()!();await flush();
  expect(render().props.children).toContain('עוד קצת משחקים');
});
test('a previous response cannot replace the new club or survive unmount',async()=>{
  let resolve!: (value:any)=>void;get.mockReturnValueOnce(new Promise(r=>resolve=r)).mockResolvedValueOnce(empty);
  render('old');const cleanup=mockEffects.pop()!();cleanup();render('new');mockEffects.pop()!();await flush();
  resolve({...empty,since:123});await flush();expect(mockStates[0].groupId).toBe('new');
});
test('a new club hides old data synchronously before effects',async()=>{
  get.mockResolvedValue(empty);render();mockEffects.pop()!();await flush();
  expect(render().type).toBe('Text');
  const next=render('other');expect(next.type).toBe(ChemistryLoadNotice);expect(next.props.failed).toBe(false);
});
test('pending historical scope never fetches live or claims empty',async()=>{
  render('one',null);mockEffects.pop()!();await flush();
  expect(get).not.toHaveBeenCalled();expect(render('one',null).props.failed).toBe(false);
});
test('a supplied archive stays local and a genuine empty archive is empty',async()=>{
  const archive={};render('one',archive);mockEffects.pop()!();await flush();
  expect(get).not.toHaveBeenCalled();expect(render('one',archive).props.children).toContain('עוד קצת משחקים');
});
