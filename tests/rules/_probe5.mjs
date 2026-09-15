import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import fs from 'node:fs';
const rules = fs.readFileSync('/Users/matan/Projects/soccer/firestore.rules', 'utf8');
const e = await initializeTestEnvironment({ projectId: 'p5',
  firestore: { rules, host: '127.0.0.1', port: 8080 } });
await e.clearFirestore();

const GID='club1', MEMBER='member', OUT='outsider', LEFT='departed';
await e.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  await setDoc(doc(db,'groups',GID), { name:'club', adminIds:['admin'], creatorId:'admin',
    playerIds:[MEMBER,'admin'], pendingPlayerIds:[], createdAt:1 });
  await setDoc(doc(db,'seasonCards',`${GID}__s1`), { groupId:GID, seasonId:'s1', no:1,
    totals:{rounds:10}, players:12, winners:[] });
  // archive whose players map is present-but-NULL
  await setDoc(doc(db,'seasonSummary',`${GID}__snull`), { groupId:GID, seasonId:'snull', no:9,
    totals:{}, players:null });
  // archive with NO players key at all
  await setDoc(doc(db,'seasonSummary',`${GID}__snokey`), { groupId:GID, seasonId:'snokey', no:8, totals:{} });
  // archive with no groupId field (legacy shape)
  await setDoc(doc(db,'seasonSummary',`${GID}__nogid`), { seasonId:'nogid', no:7, totals:{},
    players:{ [LEFT]: {rounds:3} } });
});

const as = (u) => e.authenticatedContext(u).firestore();
const t = async (label, fn) => {
  try { const r = await fn(); console.log('OK   ', label, r ?? ''); }
  catch (err) { console.log('DENY ', label, String(err.message).replace(/\s+/g,' ').slice(0,140)); }
};

console.log('--- seasonCards ---');
await t('member get card', () => getDoc(doc(as(MEMBER),'seasonCards',`${GID}__s1`)).then(s=>s.exists()));
await t('member list cards', () => getDocs(query(collection(as(MEMBER),'seasonCards'), where('groupId','==',GID))).then(s=>s.size));
await t('outsider get card', () => getDoc(doc(as(OUT),'seasonCards',`${GID}__s1`)).then(s=>s.exists()));
await t('departed participant list cards', () => getDocs(query(collection(as(LEFT),'seasonCards'), where('groupId','==',GID))).then(s=>s.size));
await t('member WRITES a card', () => setDoc(doc(as(MEMBER),'seasonCards',`${GID}__s2`), {groupId:GID}));

console.log('--- seasonSummary players null / missing ---');
await t('MEMBER get archive with players:null', () => getDoc(doc(as(MEMBER),'seasonSummary',`${GID}__snull`)).then(s=>s.exists()));
await t('departed get archive with players:null', () => getDoc(doc(as(LEFT),'seasonSummary',`${GID}__snull`)).then(s=>s.exists()));
await t('MEMBER get archive with no players key', () => getDoc(doc(as(MEMBER),'seasonSummary',`${GID}__snokey`)).then(s=>s.exists()));
await t('MEMBER LIST club archives (incl. players:null doc)', () => getDocs(query(collection(as(MEMBER),'seasonSummary'), where('groupId','==',GID))).then(s=>s.size));
await t('departed get archive with NO groupId field', () => getDoc(doc(as(LEFT),'seasonSummary',`${GID}__nogid`)).then(s=>s.exists()));
await t('outsider get archive with NO groupId field', () => getDoc(doc(as(OUT),'seasonSummary',`${GID}__nogid`)).then(s=>s.exists()));

console.log('--- groups CREATE with a planted seasons block ---');
await t('attacker creates group carrying seasons', () => setDoc(doc(as('att'),'groups','planted'), {
  name:'mine', adminIds:['att'], playerIds:['att'], pendingPlayerIds:[], createdAt:1,
  seasons:{ enabled:true, currentNo:99, currentId:'s99', count:1000000000, startedAt:0,
            cadence:{type:'rounds', targetRounds:1} } }));
await t('read it back', () => getDoc(doc(as('att'),'groups','planted')).then(s=>JSON.stringify(s.data()?.seasons)));

await e.cleanup();
