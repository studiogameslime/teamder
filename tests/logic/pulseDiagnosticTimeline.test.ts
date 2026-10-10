import{parseJournal,copyJournal,stepTime}from'../../scripts/pulse-ui/diagnosticTimeline';
const snapshot=(entries:unknown[],total=entries.length)=>JSON.stringify({schema:1,sessionId:'test',total,omitted:total-entries.length,entries});
it('reads a saved real journal in order and preserves entity identifiers',()=>{
 const j=parseJournal(snapshot([{seq:2,ms:200,kind:'press',name:'round_tab',data:{gameId:'canonical-round',tab:'stats'}},{seq:1,ms:0,kind:'launch',name:'app_launch'}]));
 expect(j!.entries.map(e=>e.seq)).toEqual([1,2]);expect(j!.entries[1].data?.gameId).toBe('canonical-round');
 expect(copyJournal(j!)).toContain('canonical-round');
});
it('reports missing middle steps rather than making the sequence look complete',()=>{
 const j=parseJournal(snapshot([{seq:1,ms:0,kind:'launch',name:'app_launch'},{seq:12,ms:3400,kind:'err',name:'uncaught'}],12));
 expect(j!.omitted).toBe(10);expect(copyJournal(j!)).toContain('חסרות 10 פעולות');
});
it('rejects malformed, unknown and oversized journal formats',()=>{
 expect(parseJournal(undefined)).toBeNull();expect(parseJournal('broken')).toBeNull();expect(parseJournal('{"schema":2,"entries":[]}')).toBeNull();
 expect(parseJournal('a'.repeat(350001))).toBeNull();
});
it('discards invalid steps and nested values instead of rendering unsafe objects',()=>{
 const j=parseJournal(snapshot([{seq:1,ms:0,kind:'nav',name:'MatchDetails',data:{gameId:'g',nested:{token:'private'}}},{seq:2,ms:-1,kind:'err',name:'bad'},null]));
 expect(j!.entries).toHaveLength(1);expect(j!.entries[0].data).toEqual({gameId:'g'});expect(j!.omitted).toBe(2);
});
it('formats minutes and milliseconds for reproducing timing',()=>{
 expect(stepTime(61325)).toBe('1:01.325');expect(stepTime(0)).toBe('0:00.000');
});
