import { bindDiagnosticOwner, diagnosticAttachment, diagnosticData, diagnosticRoute, diagnosticSnapshot, recordDiagnostic, resetDiagnosticJournal } from '@/services/diagnosticJournal';
import { crumbTap, clearTrail, formatTrail } from '@/services/breadcrumbs';

beforeEach(()=>resetDiagnosticJournal());
it('keeps startup and a long path, not just the old 50-step tail',()=>{
 for(let i=0;i<200;i++)recordDiagnostic('press','open_round',{gameId:`game-${i}`});
 const snap=JSON.parse(diagnosticAttachment());
 expect(snap.entries[0].kind).toBe('launch');
 expect(snap.entries).toHaveLength(201);expect(snap.omitted).toBe(0);
 expect(snap.entries[1].data.gameId).toBe('game-0');
 expect(snap.entries[200].data.gameId).toBe('game-199');
});
it('distinguishes two rounds with the same route name',()=>{
 diagnosticRoute('MatchDetails',{gameId:'first'});diagnosticRoute('MatchDetails',{gameId:'second'});
 expect(diagnosticSnapshot().entries.slice(-2).map(e=>e.data?.gameId)).toEqual(['first','second']);
});
it('never copies free text, credentials, links, or nested route objects',()=>{
 expect(diagnosticData({gameId:'canonical-id',tab:'stats',password:'secret',token:'secret',message:'hello',email:'person@host',url:'https://host',params:{gameId:'hidden'},status:'https://host?token=secret'})).toEqual({gameId:'canonical-id',tab:'stats'});
 diagnosticRoute('person@host',{gameId:'x'});recordDiagnostic('press','a password with spaces');
 expect(JSON.stringify(diagnosticSnapshot())).not.toContain('person@host');
 expect(diagnosticSnapshot().entries.at(-1)?.name).toBe('control');
});
it('takes an immutable snapshot at the failure, not at delayed delivery',()=>{
 diagnosticRoute('CommunityDetails',{groupId:'club'});recordDiagnostic('err','joinGame');
 const before=diagnosticAttachment();diagnosticRoute('Profile');
 expect(JSON.parse(before).entries.at(-1).name).toBe('joinGame');
 const copy=diagnosticSnapshot();copy.entries[1].data!.groupId='mutated';
 expect(diagnosticSnapshot().entries[1].data!.groupId).toBe('club');
});
it('keeps raw rapid taps even when the legacy display deduplicates',()=>{
 clearTrail();crumbTap(10,10);crumbTap(11,11);
 expect(formatTrail().split('\n')).toHaveLength(1);
 expect(diagnosticSnapshot().entries.filter(e=>e.kind==='tap')).toHaveLength(2);
});
it('preserves the first and last steps and declares gaps at both storage and attachment limits',()=>{
 for(let i=0;i<6000;i++)recordDiagnostic('press','control',{index:i,gameId:'x'.repeat(100)});
 const local=diagnosticSnapshot();expect(local.entries).toHaveLength(5000);expect(local.omitted).toBe(1001);
 const json=diagnosticAttachment();expect(json.length).toBeLessThanOrEqual(60000);
 const snap=JSON.parse(json);expect(snap.entries[0].kind).toBe('launch');
 expect(snap.entries.at(-1).data.index).toBe(5999);
 expect(snap.omitted).toBe(snap.total-snap.entries.length);
});
it('preserves initial launch on first auth hydration and resets on account changes',()=>{
 jest.resetModules();const journal=require('@/services/diagnosticJournal');
 journal.recordDiagnostic('press','before_auth');expect(journal.bindDiagnosticOwner('A')).toBe(false);
 expect(journal.diagnosticAttachment()).toContain('before_auth');
 journal.diagnosticRoute('MatchDetails',{gameId:'private-A'});expect(journal.bindDiagnosticOwner('B')).toBe(true);
 expect(journal.diagnosticAttachment()).not.toContain('private-A');
});
