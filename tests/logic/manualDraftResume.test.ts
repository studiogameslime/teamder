import { hasManualDraft } from '@/utils/manualAllocation';
test.each([null, '', '{', '{}', '{"teams":null}', '{"teams":[1]}', '{"teams":[[null]]}'])('invalid local draft does not expose resume: %s', raw => {
 expect(hasManualDraft(raw)).toBe(false);
});
test.each([{teams:[["p1"],[],[]]},{teams:[[],[]]}])('partial and empty saved drafts remain resumable', ({teams}) => {
 expect(hasManualDraft(JSON.stringify({teams}))).toBe(true);
});

import { manualDraftRevision } from '@/utils/manualAllocation';
import fs from 'fs';
import path from 'path';
test('new server split supersedes a legacy local draft', () => {
 const raw=JSON.stringify({teams:[['p1'],[]]});
 expect(hasManualDraft(raw,'')).toBe(true);
 expect(hasManualDraft(raw,manualDraftRevision({createdAt:2,teams:[['p1'],['p2']]}))).toBe(false);
});
test('local work is resumed only against the split it was based on', () => {
 const original=manualDraftRevision({createdAt:2,teams:[['p1'],['p2']]});
 const raw=JSON.stringify({teams:[['p2'],[]],baseDraftRevision:original});
 expect(hasManualDraft(raw,original)).toBe(true);
 expect(hasManualDraft(raw,manualDraftRevision({createdAt:3,teams:[['p2'],['p1']]}))).toBe(false);
 expect(hasManualDraft(raw,'')).toBe(false);
});
test('editing teams without changing creation time invalidates old local work', () => {
 expect(manualDraftRevision({createdAt:2,teams:[['a'],['b']]})).not.toBe(manualDraftRevision({createdAt:2,teams:[['b'],['a']]}));
});
test('manual save allows active rounds while keeping terminal guards and original history', () => {
 const source=fs.readFileSync(path.join(process.cwd(),'src/components/draft/ManualAllocation.tsx'),'utf8');
 expect(source).toContain("if(fresh.status==='finished'||fresh.status==='cancelled')throw Error('ROUND_CLOSED')");
 expect(source).not.toContain('fresh.liveMatch?.startedAt||fresh.rotation?.baseTeams?.length');
 expect(source).toContain('createManualDraft(teams,userId,Date.now(),fresh.draftTeams?.teams)');
});
