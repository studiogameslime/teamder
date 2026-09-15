import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, collection, query, where, getDocs } from 'firebase/firestore';
import fs from 'node:fs';
const rules = fs.readFileSync('/Users/matan/Projects/soccer/firestore.rules','utf8');
const e = await initializeTestEnvironment({projectId:'p9', firestore:{rules,host:'127.0.0.1',port:8080}});
await e.clearFirestore();
const GID='club1', M='member';
await e.withSecurityRulesDisabled(async c=>{
  const db=c.firestore();
  await setDoc(doc(db,'groups',GID),{name:'club',adminIds:['admin'],creatorId:'admin',playerIds:[M,'admin'],pendingPlayerIds:[],createdAt:1});
  for (let i=1;i<=40;i++){
    await setDoc(doc(db,'seasonCards',`${GID}__s${i}`),{groupId:GID,seasonId:'s'+i,no:i,totals:{},players:5,winners:[]});
    await setDoc(doc(db,'seasonSummary',`${GID}__s${i}`),{groupId:GID,seasonId:'s'+i,no:i,totals:{},players:{[M]:{rounds:3}}});
  }
});
const db = e.authenticatedContext(M).firestore();
for (const n of [5,10,20,40]) {
  try {
    const s = await getDocs(query(collection(db,'seasonCards'), where('groupId','==',GID)));
    console.log(`cards list (all ${s.size}) → OK`);
    break;
  } catch(err){ console.log('cards list → DENY', String(err.message).slice(0,150)); break; }
}
try { const s = await getDocs(query(collection(db,'seasonSummary'), where('groupId','==',GID))); console.log(`summary list (${s.size}) → OK`); }
catch(err){ console.log('summary list → DENY', String(err.message).slice(0,150)); }
await e.cleanup();
