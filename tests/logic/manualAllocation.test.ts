import {moveManualPlayer,restoreManualTeams,manualDragPosition} from '@/utils/manualAllocation';

describe('manual allocation',()=>{
  test.each([false,true])('drag follows physical horizontal movement without mirroring (%s)',rtl=>{
    const bounds={x:47,y:120,width:420};
    const center=(x:number)=>{const position=manualDragPosition({x,y:360},bounds,rtl);return {x:bounds.x+(rtl?bounds.width-position.start-130:position.start)+65,y:bounds.y+position.top+24};};
    expect(center(190)).toEqual({x:190,y:360});
    expect(center(310)).toEqual({x:310,y:360});
    expect(center(90)).toEqual({x:90,y:360});
    expect(center(310).x-center(190).x).toBe(120);
  });
  test.each([[2,5],[3,5],[3,7],[4,7],[7,11]])('fills %i teams of %i without duplicates',(count,capacity)=>{
    const ids=Array.from({length:count*capacity},(_,i)=>`p${i}`);
    let teams=restoreManualTeams(null,ids,count,capacity);
    ids.forEach((id,i)=>{teams=moveManualPlayer(teams,id,Math.floor(i/capacity),capacity);});
    expect(teams.map(t=>t.length)).toEqual(Array(count).fill(capacity));
    expect(new Set(teams.flat()).size).toBe(ids.length);
  });
  it('requires explicit swap when full, including from unassigned',()=>{
    const teams=[['a','b'],['c','d']];
    expect(moveManualPlayer(teams,'a',1,2)).toBe(teams);
    expect(moveManualPlayer(teams,'a',1,2,'c')).toEqual([['b','c'],['d','a']]);
    expect(moveManualPlayer(teams,'e',1,2,'c')).toEqual([['a','b'],['d','e']]);
    expect(teams).toEqual([['a','b'],['c','d']]);
  });
  it('returns player to pool and rejects invalid targets',()=>{
    const teams=[['guest:g'],['a']];
    expect(moveManualPlayer(teams,'guest:g',-1,5)).toEqual([[],['a']]);
    expect(moveManualPlayer(teams,'a',8,5)).toBe(teams);
    expect(moveManualPlayer(teams,'a',0,5,'missing')).toBe(teams);
  });
  it('restores only active unique roster ids respecting changed settings',()=>{
    expect(restoreManualTeams([['a','a','guest:g','removed'],['b','a'],['c']],['a','b','guest:g'],2,2)).toEqual([['a','guest:g'],['b']]);
    expect(restoreManualTeams({bad:true},['a'],3,7)).toEqual([[],[],[]]);
  });
});
