import {createManualDraft} from '@/utils/manualAllocation';
import {resolveSplitTeams} from '@/utils/draftTeamsView';
test('manual replacement displays the newly saved split even with an older rotation',()=>{
 const teams=[['b','c'],['a','d']];
 const draft=createManualDraft(teams,'admin',10);
 expect(resolveSplitTeams(draft,{baseTeams:[{index:0,playerIds:['a','b']},{index:1,playerIds:['c','d']}]}).map(t=>t.playerIds)).toEqual(teams);
 expect(draft.published).toBe(false);
 expect(resolveSplitTeams({...draft,published:true} as typeof draft).map(t=>t.playerIds)).toEqual(teams);
});
test('new original roster remains frozen when working teams subsequently change',()=>{
 const draft=createManualDraft([['a','b'],['c','d']],'admin',10);
 draft.teams[0].playerIds.pop();
 expect(resolveSplitTeams(draft)[0].playerIds).toEqual(['a','b']);
});
