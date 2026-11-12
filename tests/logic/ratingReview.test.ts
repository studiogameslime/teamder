import fs from 'fs';
import {reviewPlayer} from '../../src/utils/ratingReview';
import {reviewNights,reviewNow} from '../fixtures/ratingReview';
const run=(n=reviewNights(),rating:number|null=3.5,revision=0,since=0)=>reviewPlayer('a',rating,revision,since,n,reviewNow);
test('server model is identical to client contract',()=>expect(fs.readFileSync('functions/src/ratingReviewCore.ts','utf8')).toBe(fs.readFileSync('src/utils/ratingReview.ts','utf8')));
test.each([false,true])('consistent evidence and varied teammates can support a small review step (%s)',down=>{
  const r=run(reviewNights(8,down));expect(r.status).toBe(down?'down':'up');expect(r.proposed).toBe(down?3.4:3.6);expect(r.eligible).toBe(8);expect(r.points).toHaveLength(5);
});
test('conflicting evidence never changes rating',()=>{const n=reviewNights();n.forEach(x=>x.scores.a=6);expect(run(n).status).toBe('conflict');expect(run(n).proposed).toBeNull();});
test.each([0,3,5])('requires six new eligible appearances (%s)',count=>expect(run(reviewNights(count)).proposed).toBeNull());
test('old reviews and edited ratings cannot reuse earlier evidence',()=>{
  expect(run(reviewNights(),3.5,1).eligible).toBe(0);
  expect(run(reviewNights(),3.6).eligible).toBe(0);
  expect(run(reviewNights(),3.5,0,reviewNow-4*86400000).eligible).toBe(3);
});
test('missing historical ratings never become neutral assumptions',()=>{const n=reviewNights();n.forEach(x=>delete x.snapshot!.ratings[x.matches[0].teamB[0]]);expect(run(n).eligible).toBe(0);expect(run(n).reasons).toContain('match-coverage');});
test('six usable nights cannot cherry-pick a poorly covered ten-night window',()=>{const n=reviewNights(10);n.slice(6).forEach(x=>x.snapshot=null);expect(run(n).status).toBe('missing');expect(run(n).proposed).toBeNull();});
test('late captures, malformed rosters, duplicate matches and partial histories are not evidence',()=>{
  for(const corrupt of [(n:any)=>n.snapshot.at++,(n:any)=>n.matches[0].teamB.push('a'),(n:any)=>n.matches.push(n.matches[0]),(n:any)=>n.complete=false]){
    const n=reviewNights();n.forEach(corrupt);expect(run(n).eligible).toBe(0);
  }
});
test('keepers are not compared with outfield players and missing roles are explicit',()=>{
  const n=reviewNights();n.forEach(x=>x.snapshot!.roles.a='gk');expect(run(n).reasons).toContain('personal-comparison');
  n.forEach(x=>delete x.snapshot!.roles.a);expect(run(n).reasons).toContain('role');
});
test('three genuine peers are required; self and nonparticipants do not count',()=>{
  const n=reviewNights();n.forEach(x=>{Object.keys(x.scores).filter(id=>id!=='a').slice(0,3).forEach(id=>delete x.scores[id]);x.scores.phantom=1;});expect(run(n).eligible).toBe(0);
});
test('shootouts and unmatched team sizes cannot produce apparent skill',()=>{
  const n=reviewNights();n.forEach(x=>x.matches.forEach(m=>m.penalties=[{}]));expect(run(n).eligible).toBe(0);
  const other=reviewNights();other.forEach(x=>x.matches.forEach(m=>m.teamA=m.teamA.slice(1)));expect(run(other).appearances).toBe(0);
});
test('stable partners alone are not enough to attribute improvement',()=>{
  const n=reviewNights();n.forEach(x=>{x.matches.forEach(m=>m.teamA=['a','same1','same2']);for(const id of ['same1','same2']){x.snapshot!.ratings[id]=3.5;x.snapshot!.roles[id]='mid';x.scores[id]=7.5;}});
  expect(run(n).status).toBe('watch');expect(run(n).reasons).toContain('teammates');
});
test('one exceptional evening cannot tip a persistent recommendation',()=>{
  const n=reviewNights();n.forEach((x,i)=>x.scores.a=i===0?10:8.2);expect(run(n).status).toBe('watch');expect(run(n).reasons).toContain('unstable');
});
test('equal weight for evenings even when one has many more matches',()=>{
  const n=reviewNights();const before=run(n);n[0].matches=Array.from({length:90},(_,i)=>({...n[0].matches[0],roundId:`long${i}`}));expect(run(n).teamDelta).toBe(before.teamDelta);
});
test('unrated and bounds do not silently clear ratings',()=>{
  expect(run(reviewNights(),null).status).toBe('unrated');const n=reviewNights();n.forEach(x=>Object.keys(x.snapshot!.ratings).forEach(id=>x.snapshot!.ratings[id]=5));expect(run(n,5).proposed).toBeNull();
});
test('caps window, deduplicates nights and ignores future data',()=>{
  const n=reviewNights(15);expect(run([...n,n[0]]).appearances).toBe(10);n.forEach(x=>x.at=reviewNow+1);expect(run(n).appearances).toBe(0);
});
