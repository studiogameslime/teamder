import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import fs from 'node:fs';
const HEAD = fs.readFileSync('/Users/matan/Projects/soccer/firestore.rules','utf8');
const BASE = fs.readFileSync('./_base.rules','utf8');
let n=0;
async function trial(rules, hasSeasons, np, npend){
  const e = await initializeTestEnvironment({projectId:'p8-'+(++n), firestore:{rules,host:'127.0.0.1',port:8080}});
  await e.clearFirestore();
  const players = Array.from({length:np},(_,i)=>'u'+i).concat(['creator']);
  const pending = Array.from({length:npend},(_,i)=>'p'+i);
  await e.withSecurityRulesDisabled(async c=>{
    await setDoc(doc(c.firestore(),'groups','g1'),{ name:'club',adminIds:['creator'],creatorId:'creator',
      playerIds:players,pendingPlayerIds:pending,createdAt:1,isOpen:true,description:'d',
      ...(hasSeasons?{seasons:{enabled:true,currentNo:2,currentId:'s2',count:1,startedAt:1,cadence:{type:'date',months:6,endsAt:9}}}:{})});
  });
  let ok;
  try { await updateDoc(doc(e.authenticatedContext('creator').firestore(),'groups','g1'), {description:'x'+np}); ok=true; }
  catch { ok=false; }
  await e.cleanup();
  return ok;
}
async function cliff(rules, hasSeasons, npend){
  let lo=1, hi=520;
  while (lo<hi) { const mid=Math.floor((lo+hi+1)/2); if (await trial(rules,hasSeasons,mid,npend)) lo=mid; else hi=mid-1; }
  return lo;
}
for (const npend of [0, 100, 200]) {
  const b = await cliff(BASE, false, npend);
  const h = await cliff(HEAD, true, npend);
  console.log(`pending=${npend}  BASE(no seasons) last-working playerIds=${b}   HEAD(with seasons)=${h}`);
}
