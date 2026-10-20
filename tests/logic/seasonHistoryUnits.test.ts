jest.mock('firebase/firestore', () => ({ collection: jest.fn(), query: jest.fn(), where: jest.fn(), doc: jest.fn(), getDoc: jest.fn(), getDocs: jest.fn() }));
jest.mock('@/firebase/config', () => ({ USE_MOCK_DATA: false, getFirebase: () => ({db:{}}) }));
jest.mock('@/data/mockData', () => ({mockPlayers:[]}));
jest.mock('@/services/errorLog', () => ({logError:jest.fn()}));
import {getDocs} from 'firebase/firestore';
import {seasonHistoryService} from '@/services/seasonHistoryService';

test.each([false,true])('the real season card reader preserves units and winner ids; new policy: %s', async modern => {
  const winner={key:'topWinner',names:['אותו שם'],value:modern?66.67:1,...(modern?{valueUnit:'percent',winnerIds:['winner-id']}:{})};
  (getDocs as jest.Mock).mockResolvedValue({forEach:(fn:any)=>fn({data:()=>({seasonId:'s1',no:1,completedRounds:13,winners:[winner],...(modern?{awardsVersion:2}:{})})})});
  const result=await seasonHistoryService.list('g');
  expect(result).not.toBe('error');
  if(result==='error') throw new Error('Unexpected read failure');
  expect(result[0].winners).toEqual([winner]);
  expect(result[0].awardsVersion).toBe(modern?2:undefined);
});
