jest.mock('../../pulse/src/config',()=>({MOCK_WORK:false,config:{firebase:{projectId:'test'}}}));
jest.mock('../../pulse/src/capabilities',()=>({has:{firebase:()=>true}}));
jest.mock('../../pulse/src/services/firestoreRest',()=>({getDoc:jest.fn(),patchDoc:jest.fn(),listAll:jest.fn()}));
jest.mock('../../pulse/src/services/cache',()=>({cached:(_k:string,fn:()=>unknown)=>fn(),invalidate:jest.fn()}));
jest.mock('../../pulse/src/services/teamderChatService',()=>({listAwaitingReply:jest.fn()}));
import { boardBuckets, boardSections } from '../../pulse/src/services/workBoard';
import { loadItemImages, type WorkItem } from '../../pulse/src/services/workItems';
import { markDoneByRubens } from '../../pulse/src/services/claudeWork';
import { getDoc,patchDoc } from '../../pulse/src/services/firestoreRest';
const row=(patch:Partial<WorkItem>={})=>({key:'task:1',docPath:'tasks/1',stream:'task',state:'open',createdAt:1,claudeMayAct:true,priority:'normal',...patch} as WorkItem);
beforeEach(()=>jest.clearAllMocks());
test('all open work including parked ideas remains in open tab without changing execution permission',()=>{
 const chat=row({stream:'chat',claudeMayAct:false});const idea=row({stream:'idea',claudeMayAct:false});const approved=row({stream:'idea'});const review=row({state:'claude'});
 const b=boardBuckets([chat,idea,approved,review]);expect(b.open).toEqual([chat,idea,approved]);expect(idea.claudeMayAct).toBe(false);expect(b.claude).toEqual([review]);
});
test('urgent and unresolved work lead the list without duplication, newest mode preserves all items',()=>{
 const a=row({key:'a',priority:'high'}),b=row({key:'b',createdAt:10}),c=row({key:'c',unresolved:{since:0,reason:'',nextStep:''}});
 expect(boardSections([a,b,c])[0].items).toEqual([a,c]);expect(boardSections([a,b,c]).flatMap(g=>g.items)).toHaveLength(3);expect(boardSections([a,b,c],true)[0].items[0]).toBe(b);
});
test('task attachments and linked original report are loaded only on detail demand and proof remains separate',async()=>{
 (getDoc as jest.Mock).mockImplementation(async(p:string)=>p==='tasks/1'?{images:['task-shot'],claudeImages:['proof']}:{image:'report-shot',images:['task-shot']});
 expect(await loadItemImages(row({sourceReportId:'source'}))).toEqual({images:['task-shot','report-shot'],claudeImages:['proof']});expect(getDoc).toHaveBeenCalledTimes(2);
});
test('image read failures are errors, not a false claim that no image was attached',async()=>{
 (getDoc as jest.Mock).mockRejectedValue(Error('offline'));await expect(loadItemImages(row())).rejects.toThrow('offline');
});
test('Rubens handover retains compatible fields and does not overwrite original images or close the task',async()=>{
 (patchDoc as jest.Mock).mockResolvedValue(true);
 await markDoneByRubens('tasks/1','תיקנתי את הכפתור שנחתך. עכשיו אפשר ללחוץ עליו גם במסך קטן.',['proof'],123);
 expect(patchDoc).toHaveBeenCalledWith('tasks/1',{claudeStatus:'done',claudeNote:'תיקנתי את הכפתור שנחתך. עכשיו אפשר ללחוץ עליו גם במסך קטן.',claudeImages:['proof'],claudeAt:123});
});
