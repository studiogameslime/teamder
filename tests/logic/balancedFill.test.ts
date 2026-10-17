import {balanceTeams} from '@/utils/draft';
import {balanceWithFill, recommendFill, fillAverage} from '@/utils/balancedFill';
import {prepareBalancedNext, recordWinnerSkeleton, recordTieSkeleton, rosterOf, startRotationSkeleton, applyChosenFill} from '@/services/rotationEngine';

const sides = [{index:0,playerIds:['a','b','c','d']},{index:1,playerIds:['e','f','g','h']}] as [{index:number;playerIds:string[]},{index:number;playerIds:string[]}];
test('two short teams choose distinct fillers and evaluate the full lineups',()=>{
  const ratings=Object.fromEntries(['a','b','c','d','e','f','g','h','x','y','z'].map(id=>[id,4]));ratings.z=1;
  const p=recommendFill(sides,['x','y','z'],5,ratings);
  expect(p.picks.flat().sort()).toEqual(['x','y']);expect(p.gap).toBe(0);expect(p.missing).toEqual([0,0]);
});
test('5 vs 4 uses the rating of the actual fifth player',()=>{
  const full:[typeof sides[0],typeof sides[1]]=[{index:0,playerIds:['a','b','c','d','e']},{index:1,playerIds:['f','g','h','i']}];
  const ratings=Object.fromEntries([...full.flatMap(s=>s.playerIds),'best'].map(id=>[id,4]));ratings.weak=3;ratings.strong=5;
  expect(recommendFill(full,['weak','best','strong'],5,ratings).picks).toEqual([[],['best']]);
});
test('fair workload breaks equivalent balance, not a much worse gap',()=>{
  const p=recommendFill(sides,['busy','rested','third'],5,{}, {busy:{games:5,fills:3,lastRound:5},rested:{games:1,fills:0,lastRound:2},third:{games:2,fills:0,lastRound:3}},6);
  expect(p.picks.flat()).not.toContain('busy');
});
test('duplicate donors and playing players cannot be selected twice',()=>{
  const p=recommendFill(sides,['a','x','x','y'],5,{});
  expect(p.picks.flat().sort()).toEqual(['x','y']);
});
test('shortage is returned explicitly without inventing a player',()=>{
  const p=recommendFill(sides,['x'],5,{});expect(p.picks.flat()).toEqual(['x']);expect(p.missing.reduce((s,n)=>s+n,0)).toBe(1);
});
test.each([12,13,14,19,20])('%i players keep configured sizes and appear exactly once',n=>{
  const ids=Array.from({length:n},(_,i)=>`p${i}`);const count=n>=19?4:3;
  const output=balanceTeams({playerIds:ids,numTeams:count,format:'5v5',createdBy:'admin',completionMode:'balanced',ratings:Object.fromEntries(ids.map((id,i)=>[id,1+i%5])),rng:()=>0.42});
  expect(output.result.teams.flatMap(t=>t.playerIds).sort()).toEqual(ids.sort());
  expect(Math.max(...output.result.teams.map(t=>t.playerIds.length))-Math.min(...output.result.teams.map(t=>t.playerIds.length))).toBeLessThanOrEqual(1);
  if(n<15) expect(output.result.completionMode).toBe('balanced');
});
test('completed-match optimization never worsens worst-plus-mean score',()=>{
  const teams=[['a','b','c','d','e'],['f','g','h','i'],['j','k','l','m']];
  const ratings=Object.fromEntries(teams.flat().map((id,i)=>[id,1+(i*3)%5]));
  const score=(ts:string[][])=>{const gaps=[...[0,1,2]].flatMap((a)=>[0,1,2].filter(b=>b>a).map(b=>recommendFill([{index:a,playerIds:ts[a]},{index:b,playerIds:ts[b]}],ts.flatMap((ids,i)=>i!==a&&i!==b?ids:[]),5,ratings).gap));return Math.max(...gaps)*4+gaps.reduce((s,g)=>s+g,0)/gaps.length;};
  expect(score(balanceWithFill(teams,5,ratings))).toBeLessThanOrEqual(score(teams)+1e-9);
});
test.each(['win','tie'])('actual borrowed participants get usage before loans return (%s)',outcome=>{
  const teams=[...sides,{index:2,playerIds:['x','y','z','w']}];
  const start=startRotationSkeleton(teams,5,'temporary')!;
  const first=applyChosenFill(teams,[],0,['x'],'temporary');
  const second=applyChosenFill(first.teams,first.loans,1,['y'],'temporary');
  const previous={...start.rotation,loans:second.loans};
  const next=outcome==='win'?recordWinnerSkeleton(0,teams,previous,5,'temporary'):recordTieSkeleton(teams,previous,5,'temporary','veteranOut');
  const balanced=prepareBalancedNext(next,previous);
  expect(balanced.rotation.loans).toEqual([]);
  expect(balanced.rotation.fillUsage?.x).toEqual({games:1,fills:1,lastRound:1});
  expect(balanced.rotation.fillUsage?.z).toBeUndefined();
  expect(rosterOf(0,teams,previous.loans)).toContain('x');
  if(outcome==='win') expect(balanced.rotation.lastRoundWinners).toContain('x');
  expect(prepareBalancedNext(next,previous).rotation.fillUsage).toEqual(balanced.rotation.fillUsage);
  expect(teams[2].playerIds).toEqual(['x','y','z','w']);
});
test('unknown ratings use neutral baseline, no NaN or false zero',()=>{
  expect(fillAverage(['a','b'],{a:NaN,b:Infinity})).toBe(3);
});
