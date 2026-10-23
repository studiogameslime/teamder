jest.mock('../../pulse/src/capabilities',()=>({has:{firebase:()=>true}}));
jest.mock('../../pulse/src/config',()=>({MOCK_WORK:false}));
jest.mock('../../pulse/src/services/cache',()=>({cached:(_key:string,fn:()=>unknown)=>fn(),invalidate:jest.fn()}));
jest.mock('../../pulse/src/services/firestoreRest',()=>({listAll:jest.fn(),getDoc:jest.fn(),patchDoc:jest.fn()}));
jest.mock('../../pulse/src/services/teamderChatService',()=>({listAwaitingReply:jest.fn(async()=>[])}));
import { listAll } from '../../pulse/src/services/firestoreRest';
import { listWork, KIND_ORDER } from '../../pulse/src/services/workItems';
import { groupWorkSections } from '../../pulse/src/services/unresolvedWork';

test('unresolved reports, tasks and errors survive projections, remain open, and leave the section only after a verified handover or closure',async()=>{
 const fetch=listAll as jest.Mock;
 fetch.mockImplementation(async collection=>['tasks','feedback','errors'].includes(collection)?[{id:collection,title:'בדיקה',message:'בדיקה',unresolved:true,unresolvedAt:10,unresolvedReason:'לא שוחזר במכשיר',unresolvedNextStep:'בדיקה בגרסה עדכנית',reviewReason:'נדרש שחזור במכשיר המדווח',status:'new'}]:[]);
 const rows=await listWork(true);expect(rows).toHaveLength(3);
 expect(rows.every(r=>r.state==='open'&&r.unresolved?.nextStep==='בדיקה בגרסה עדכנית')).toBe(true);
 expect(rows.every(r=>r.reviewReason==='נדרש שחזור במכשיר המדווח')).toBe(true);
 for(const [collection,,fields] of fetch.mock.calls)if(['tasks','feedback','errors'].includes(collection))expect(fields).toContain('reviewReason');
 for(const [, , fields] of fetch.mock.calls)expect(fields).toEqual(expect.arrayContaining(['unresolved','unresolvedAt','unresolvedReason','unresolvedNextStep']));
 expect(groupWorkSections(rows,KIND_ORDER)).toEqual([{kind:'unresolved',items:rows}]);
 const handedOver={...rows[0],state:'claude' as const};const closed={...rows[1],state:'done' as const};
 expect(groupWorkSections([handedOver,closed,rows[2]],KIND_ORDER).find(g=>g.kind==='unresolved')?.items).toEqual([rows[2]]);
});
