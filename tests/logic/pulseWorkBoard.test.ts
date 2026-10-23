jest.mock('../../pulse/src/config',()=>({MOCK_WORK:false,config:{firebase:{projectId:'test'}}}));
jest.mock('../../pulse/src/capabilities',()=>({has:{firebase:()=>true}}));
jest.mock('../../pulse/src/services/firestoreRest',()=>({getDoc:jest.fn(),patchDoc:jest.fn(),listAll:jest.fn()}));
jest.mock('../../pulse/src/services/cache',()=>({cached:(_k:string,fn:()=>unknown)=>fn(),invalidate:jest.fn()}));
jest.mock('../../pulse/src/services/teamderChatService',()=>({listAwaitingReply:jest.fn()}));
import { boardBuckets, boardSections } from '../../pulse/src/services/workBoard';
import { loadItemImages, type WorkItem } from '../../pulse/src/services/workItems';
import { markDoneByRubens } from '../../pulse/src/services/claudeWork';
import { getDoc,patchDoc } from '../../pulse/src/services/firestoreRest';
import { workCategory } from '../../pulse/src/services/unresolvedWork';
const row=(patch:Partial<WorkItem>={})=>({key:'task:1',docPath:'tasks/1',stream:'task',kind:'bug',state:'open',createdAt:1,claudeMayAct:true,priority:'normal',...patch} as WorkItem);
beforeEach(()=>jest.clearAllMocks());

test('unresolved category groups only unresolved open bugs, reports and errors once, newest first, after ordinary bugs',()=>{
 const unresolved={since:1,reason:'לא שוחזר',nextStep:'בדיקת מכשיר'};
 const items=[row({key:'error',kind:'error',createdAt:2,unresolved}),row({key:'report',kind:'report',createdAt:3,unresolved}),row({key:'bug',createdAt:1,unresolved}),row({key:'ordinary'}),row({key:'idea',kind:'idea',unresolved})];
 const groups=boardSections(items);
 expect(groups.map(g=>g.key)).toEqual(['bug','unresolved','idea']);
 expect(groups[1].title).toBe('באגים לא פתורים');
 expect(groups[1].items.map(i=>i.key)).toEqual(['report','error','bug']);
 expect(groups.flatMap(g=>g.items)).toHaveLength(items.length);
 expect(items.map(workCategory)).toEqual(['unresolved','unresolved','unresolved','bug','idea']);
 for(const state of ['claude','done'] as const)expect(workCategory({...items[0],state})).toBe('error');
});
test('all open work including parked ideas remains in open tab without changing execution permission',()=>{
 const chat=row({stream:'chat',claudeMayAct:false});const idea=row({stream:'idea',claudeMayAct:false});const approved=row({stream:'idea'});const review=row({state:'claude'});
 const b=boardBuckets([chat,idea,approved,review]);expect(b.open).toEqual([chat,idea,approved]);expect(idea.claudeMayAct).toBe(false);expect(b.claude).toEqual([review]);
});
test('newest creation time leads even when older work is urgent or unresolved, without mutating the input',()=>{
 const a=row({key:'a',priority:'high'}),b=row({key:'b',createdAt:10}),c=row({key:'c',unresolved:{since:0,reason:'',nextStep:''}});
 const input=[a,b,c];
 expect(boardSections(input)[0].items).toEqual([b,a]);
 expect(boardSections(input).flatMap(g=>g.items)).toHaveLength(3);
 expect(input).toEqual([a,b,c]);
});

test.each(['open','claude','done'] as const)('categories retain the owner order and every item belongs to its own group in %s',state=>{
 const kinds=['chat','idea','ui','feature','bug','report','error'] as const;
 const items=kinds.map((kind,index)=>row({key:kind,kind,state,createdAt:index,priority:kind==='ui'?'high':'normal'}));
 {
  const groups=boardSections(items);
  expect(groups.map(group=>group.key)).toEqual(['error','report','bug','feature','ui','idea','chat']);
  expect(groups.flatMap(group=>group.items)).toHaveLength(items.length);
  for(const group of groups) expect(group.items.every(item=>item.kind===group.key)).toBe(true);
 }
 expect(boardSections(items.filter(item=>item.kind==='ui')).map(group=>group.key)).toEqual(['ui']);
 expect(boardSections([])).toEqual([]);
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
