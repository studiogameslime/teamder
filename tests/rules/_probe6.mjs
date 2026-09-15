import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc, deleteField, getDoc } from 'firebase/firestore';
import fs from 'node:fs';
const rules = fs.readFileSync('/Users/matan/Projects/soccer/firestore.rules', 'utf8');
const e = await initializeTestEnvironment({ projectId: 'p6', firestore: { rules, host: '127.0.0.1', port: 8080 } });
await e.clearFirestore();
const GID='club1', MEMBER='member', OUT='outsider';
await e.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  await setDoc(doc(db,'groups',GID), { name:'club', adminIds:['admin'], creatorId:'admin',
    playerIds:[MEMBER,'admin'], pendingPlayerIds:[], createdAt:1, isOpen:true,
    seasons:{enabled:true,currentNo:2,currentId:'s2',count:1,startedAt:1} });
  await setDoc(doc(db,'seasonSummary',`${GID}__s1`), { groupId:GID, seasonId:'s1', players:{[MEMBER]:{rounds:5}}, totals:{} });
  await setDoc(doc(db,'seasonCards',`${GID}__s1`), { groupId:GID, seasonId:'s1', winners:[] });
  await setDoc(doc(db,'users',MEMBER,'seasonTitles',`${GID}__s1__topScorer`), { titleKey:'topScorer', value:3 });
});
const as=(u)=>e.authenticatedContext(u).firestore();
const t=async(l,f)=>{try{const r=await f();console.log('OK   ',l,r??'')}catch(err){console.log('DENY ',l,String(err.message).replace(/\s+/g,' ').slice(0,110))}};

await t('admin DELETES an archive', ()=>deleteDoc(doc(as('admin'),'seasonSummary',`${GID}__s1`)));
await t('admin DELETES a card', ()=>deleteDoc(doc(as('admin'),'seasonCards',`${GID}__s1`)));
await t('member DELETES their own title', ()=>deleteDoc(doc(as(MEMBER),'users',MEMBER,'seasonTitles',`${GID}__s1__topScorer`)));
await t('outsider DELETES someone else title', ()=>deleteDoc(doc(as(OUT),'users',MEMBER,'seasonTitles',`${GID}__s1__topScorer`)));
await t('admin deleteField(seasons)', ()=>updateDoc(doc(as('admin'),'groups',GID), { seasons: deleteField() }));
await t('admin nested seasons.count only', ()=>updateDoc(doc(as('admin'),'groups',GID), { 'seasons.count': 99 }));
await t('member smuggles seasons via self-join branch', ()=>updateDoc(doc(as(OUT),'groups',GID),
  { playerIds:[MEMBER,'admin',OUT], updatedAt:2, seasons:{enabled:false} }));
await t('member smuggles seasons via self-leave branch', ()=>updateDoc(doc(as(MEMBER),'groups',GID),
  { playerIds:['admin'], updatedAt:2, seasons:{enabled:false} }));
await t('anon (unauthenticated) get archive', async()=>{
  const db=e.unauthenticatedContext().firestore();
  return getDoc(doc(db,'seasonSummary',`${GID}__s1`)).then(s=>s.exists());
});
await t('anon get title', async()=>{
  const db=e.unauthenticatedContext().firestore();
  return getDoc(doc(db,'users',MEMBER,'seasonTitles',`${GID}__s1__topScorer`)).then(s=>s.exists());
});
await e.cleanup();
