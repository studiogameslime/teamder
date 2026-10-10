import { personalHighlights, scoreTrend } from '../../src/utils/personalStatistics';
const rounds=Array.from({length:7},(_,i)=>({gameId:`g${i}`,at:i+1,groupId:i%2?'a':'b'}));
test('recent five rounds stay recent even when a score is missing, and zero is a real score',()=>{
 const v=personalHighlights(rounds,{g0:10,g2:0,g4:8,g6:7},{g1:{goals:4},g3:{assists:3}});
 expect(v.recentCount).toBe(5);expect(v.points.map(p=>p.gameId)).toEqual(['g2','g4','g6']);expect(v.points[0].score).toBe(0);
 expect(v.bestGoals).toBe(4);expect(v.bestAssists).toBe(3);expect(v.results).toBeNull();
});
test('invalid scores are not points and unavailable records cannot claim a maximum',()=>{
 const v=personalHighlights(rounds,{g2:NaN,g3:11,g4:-1,g5:8},{g0:{goals:99}},true);
 expect(v.points.map(p=>p.score)).toEqual([8]);expect(v.bestGoals).toBeNull();expect(v.incomplete).toBe(true);
 expect(personalHighlights([],{},{}).bestGoals).toBeNull();
});
test.each([[[7,8.5,6.5,9,7.5],'mixed'],[[7,8,9],'up'],[[9,8,7],'down'],[[7,7,7],'stable']])('trend follows every change, not just first and last', (scores,expected)=>{
 expect(scoreTrend((scores as number[]).map((score,i)=>({gameId:String(i),at:i,score})))).toBe(expected);
});

test('result totals use mini-games with consistent counters, never evenings as games',()=>{
 const v=personalHighlights(rounds,{}, {g0:{wins:2,losses:1,rounds:4},g1:{wins:1,losses:1,rounds:2},g2:{wins:9,losses:0,rounds:2},g3:{wins:1}});
 expect(v.results).toEqual({wins:3,losses:2,ties:1,games:6,rounds:2});
});
test('sparse server increments count an unbeaten round without inventing a denominator',()=>{
 expect(personalHighlights(rounds,{}, {g0:{wins:2,rounds:3},g1:{rounds:1},g2:{wins:3}}).results).toEqual({wins:2,losses:0,ties:2,games:4,rounds:2});
});
